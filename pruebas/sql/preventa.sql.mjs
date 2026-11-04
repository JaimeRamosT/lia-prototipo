// Prueba la migración de la preventa con Yape (docs/preventa.md) en PGlite, sobre la de cuentas y planes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const M = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const BASE = `
create schema if not exists auth; create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const db = new PGlite();
const una = async q => (await db.query(q)).rows[0];
const falla = async q => { try { await db.query(q); return null; } catch (e) { return e; } };
const hoy = async () => (await una(`select public.hoy_lima() d`)).d;
const mas = (d, meses) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + meses); return x.toISOString().slice(0, 10); };
const iso = d => new Date(d).toISOString().slice(0, 10);

test('preparar la base', async () => {
  await db.exec(BASE);
  await db.exec(fs.readFileSync(M + '20261026005847_cuentas_y_suscripciones.sql', 'utf8'));
  const sql = fs.readFileSync(M + '20261104140000_preventa.sql', 'utf8');
  await db.exec(sql);
  await db.exec(sql);   // se puede aplicar dos veces
  await db.exec(`insert into auth.users values ('${A}', 'Ana@Correo.pe')`);
});

test('registrar_preventa activa Pro real por el periodo y anota el pago con su operación', async () => {
  const s = await una(`select * from public.registrar_preventa(' ana@correo.pe ', 'ciclo', 34.90, ' 12345678 ')`);
  assert.deepEqual([s.plan, s.periodo, s.medio, s.demo, s.renovacion_automatica], ['pro', 'ciclo', 'yape', false, false]);
  assert.equal(iso(s.hasta), mas(await hoy(), 4));
  const p = await una(`select * from public.pagos where user_id = '${A}'`);
  assert.deepEqual([p.periodo, p.medio, Number(p.monto), p.demo, p.referencia], ['ciclo', 'yape', 34.9, false, '12345678']);
});

test('la misma operación no se registra dos veces', async () => {
  const e = await falla(`select * from public.registrar_preventa('ana@correo.pe', 'ciclo', 34.90, '12345678')`);
  assert.match(e && e.message, /ya se registró/);
  assert.equal(Number((await una(`select count(*) n from public.pagos`)).n), 1);
});

test('otra operación siendo Pro suma el periodo al final', async () => {
  const antes = (await una(`select hasta from public.suscripciones where user_id = '${A}'`)).hasta;
  const s = await una(`select * from public.registrar_preventa('ana@correo.pe', 'mes', 9.90, '87654321')`);
  assert.equal(iso(s.hasta), mas(antes, 1));
});

test('monto, plan, operación o correo que no cuadran: error y nada anotado', async () => {
  for (const [q, msj] of [
    [`'ana@correo.pe', 'mes', 5, '1111'`, /no coincide con el precio/],
    [`'ana@correo.pe', 'anual', 99, '1112'`, /Plan no válido/],
    [`'ana@correo.pe', 'mes', 9.90, ''`, /número de operación/],
    [`'nadie@correo.pe', 'mes', 9.90, '1113'`, /No hay ninguna cuenta/],
  ]) assert.match((await falla(`select * from public.registrar_preventa(${q})`) || {}).message || '', msj);
  assert.equal(Number((await una(`select count(*) n from public.pagos`)).n), 2);
});

test('la app ni el servidor pueden llamar registrar_preventa ni quitar_pro', async () => {
  for (const rol of ['anon', 'authenticated', 'service_role']) {
    await db.exec(`set role ${rol}`);
    const e1 = await falla(`select public.registrar_preventa('ana@correo.pe', 'mes', 9.90, '2222')`);
    const e2 = await falla(`select public.quitar_pro('ana@correo.pe')`);
    await db.exec('reset role');
    assert.ok(e1 && /permission denied/.test(e1.message), rol);
    assert.ok(e2 && /permission denied/.test(e2.message), rol);
  }
});

test('quitar_pro vuelve a Gratis sin borrar el historial', async () => {
  const s = await una(`select * from public.quitar_pro('ana@correo.pe')`);
  assert.deepEqual([s.plan, s.periodo, s.medio, s.hasta], ['gratis', null, null, null]);
  assert.equal(Number((await una(`select count(*) n from public.pagos`)).n), 2);
});

test('con la lista de cuentas de prueba vacía, el pago de prueba sigue abierto; con correos, solo para ellos', async () => {
  const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  await db.exec(`insert into auth.users values ('${B}', 'beto@correo.pe')`);
  await db.exec(`grant usage on schema public to authenticated`);
  const simular = async uid => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
    try { return await falla(`select * from public.simular_pago('mes', 'yape')`); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); } };
  assert.equal(await simular(B), null, 'lista vacía: abierto para todos, como hasta hoy');
  await db.exec(`insert into public.cuentas_prueba (correo) values ('ANA@correo.pe')`);
  const e = await simular(B);
  assert.match(e && e.message, /pago_de_prueba_cerrado/, 'con la preventa abierta, Beto no simula');
  assert.equal(await simular(A), null, 'Ana, en la lista, sí');
  await db.exec('set role authenticated');
  const leer = await falla(`select * from public.cuentas_prueba`);
  await db.exec('reset role');
  assert.ok(leer, 'la app no lee la lista');
});
