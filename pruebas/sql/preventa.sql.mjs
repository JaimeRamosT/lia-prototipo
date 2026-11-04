// Prueba la migración de la preventa con Yape (docs/preventa.md) en PGlite, sobre la de cuentas y planes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const M = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
// Como en Supabase: las tablas y funciones nuevas del esquema public nacen con permisos para los tres roles, así que
// cada migración tiene que quitarlos a propósito.
const BASE = `
create schema if not exists auth; create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const D = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const db = new PGlite();
const una = async q => (await db.query(q)).rows[0];
const falla = async q => { try { await db.query(q); return null; } catch (e) { return e; } };
const hoy = async () => (await una(`select public.hoy_lima() d`)).d;
const mas = (d, meses) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + meses); return x.toISOString().slice(0, 10); };
const iso = d => new Date(d).toISOString().slice(0, 10);
const pagos = async () => Number((await una(`select count(*) n from public.pagos`)).n);
// Llama algo como la persona con sesión iniciada (rol authenticated y su id en el JWT).
const como = async (uid, q) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await falla(q); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const plan = async uid => una(`select * from public.suscripciones where user_id = '${uid}'`);

test('preparar la base', async () => {
  await db.exec(BASE);
  await db.exec(fs.readFileSync(M + '20261026005847_cuentas_y_suscripciones.sql', 'utf8'));
  const sql = fs.readFileSync(M + '20261104140000_preventa.sql', 'utf8');
  await db.exec(sql);
  await db.exec(sql);   // se puede aplicar dos veces
  await db.exec(`insert into auth.users (id, email, email_confirmed_at) values
    ('${A}', 'Ana@Correo.pe', now()), ('${B}', 'beto@correo.pe', now()), ('${C}', 'caro@correo.pe', null), ('${D}', 'dani@correo.pe', now())`);
});

test('registrar_preventa activa Pro real por el periodo y anota el pago con su operación', async () => {
  const s = await una(`select * from public.registrar_preventa(' ana@correo.pe ', 'ciclo', 34.90, ' 12345678 ')`);
  assert.deepEqual([s.plan, s.periodo, s.medio, s.demo, s.renovacion_automatica], ['pro', 'ciclo', 'yape', false, false]);
  assert.equal(iso(s.hasta), mas(await hoy(), 4));
  const p = await una(`select * from public.pagos where user_id = '${A}'`);
  assert.deepEqual([p.periodo, p.medio, Number(p.monto), p.demo, p.referencia], ['ciclo', 'yape', 34.9, false, '12345678']);
});

test('la misma operación no se registra dos veces, aunque se escriba distinto', async () => {
  const e = await falla(`select * from public.registrar_preventa('ana@correo.pe', 'ciclo', 34.90, '12345678')`);
  assert.match(e && e.message, /ya se registró/);
  await db.exec(`select * from public.registrar_preventa('ana@correo.pe', 'mes', 9.90, 'ab-1234')`);
  assert.equal((await una(`select referencia from public.pagos where referencia ilike 'ab-1234'`)).referencia, 'AB-1234', 'se guarda en mayúsculas');
  const e2 = await falla(`select * from public.registrar_preventa('ana@correo.pe', 'mes', 9.90, ' Ab-1234 ')`);
  assert.match(e2 && e2.message, /ya se registró/, 'misma operación con espacio o en minúsculas');
  assert.equal(await pagos(), 2);
});

test('otra operación siendo Pro suma el periodo al final', async () => {
  const antes = (await plan(A)).hasta;
  const s = await una(`select * from public.registrar_preventa('ana@correo.pe', 'mes', 9.90, '87654321')`);
  assert.equal(iso(s.hasta), mas(antes, 1));
});

test('monto, plan, operación o correo que no cuadran: error y nada anotado', async () => {
  for (const [q, msj] of [
    [`'ana@correo.pe', 'mes', 5, '1111'`, /no coincide con el precio/],
    [`'ana@correo.pe', 'anual', 99, '1112'`, /Plan no válido/],
    [`'ana@correo.pe', 'mes', 9.90, ''`, /número de operación/],
    [`'ana@correo.pe', 'mes', 9.90, '12'`, /número de operación/],
    [`'ana@correo.pe', 'mes', 9.90, '1234;--'`, /número de operación/],
    [`'nadie@correo.pe', 'mes', 9.90, '1113'`, /No hay ninguna cuenta/],
  ]) assert.match((await falla(`select * from public.registrar_preventa(${q})`) || {}).message || '', msj);
  assert.equal(await pagos(), 3);
});

test('la app ni el servidor pueden llamar registrar_preventa, quitar_pro ni prueba_permitida, ni leer cuentas_prueba', async () => {
  for (const rol of ['anon', 'authenticated', 'service_role']) {
    await db.exec(`set role ${rol}`);
    const e = [
      await falla(`select public.registrar_preventa('ana@correo.pe', 'mes', 9.90, '2222')`),
      await falla(`select public.quitar_pro('ana@correo.pe')`),
      await falla(`select public.prueba_permitida('${A}')`),
      await falla(`select * from public.cuentas_prueba`),
      await falla(`insert into public.cuentas_prueba (correo) values ('yo@correo.pe')`),
    ];
    await db.exec('reset role');
    e.forEach((x, i) => assert.ok(x && /permission denied/.test(x.message), `${rol} #${i}`));
  }
});

test('quitar_pro vuelve a Gratis sin borrar el historial, también en una cuenta sin plan todavía', async () => {
  const s = await una(`select * from public.quitar_pro('ana@correo.pe')`);
  assert.deepEqual([s.plan, s.periodo, s.medio, s.hasta], ['gratis', null, null, null]);
  assert.equal(await pagos(), 3);
  const d = await una(`select * from public.quitar_pro('dani@correo.pe')`);
  assert.equal(d && d.plan, 'gratis', 'devuelve la fila aunque no existiera');
});

test('con la lista vacía, el pago de prueba sigue abierto; con correos, solo para los confirmados de la lista', async () => {
  assert.equal(await como(B, `select * from public.simular_pago('mes', 'tarjeta')`), null, 'lista vacía: abierto para todos, como hasta hoy');
  assert.equal((await plan(B)).renovacion_automatica, true);
  await db.exec(`insert into public.cuentas_prueba (correo) values ('ANA@correo.pe '), ('caro@correo.pe')`);
  const e = await como(B, `select * from public.simular_pago('mes', 'yape')`);
  assert.match(e && e.message, /pago_de_prueba_cerrado/, 'con la preventa abierta, Beto no simula');
  assert.equal(await como(A, `select * from public.simular_pago('mes', 'tarjeta')`), null, 'Ana, en la lista, sí');
  const c = await como(C, `select * from public.simular_pago('mes', 'yape')`);
  assert.match(c && c.message, /pago_de_prueba_cerrado/, 'Caro está en la lista, pero no confirmó su correo');
});

test('con la preventa abierta, un Pro de prueba vencido ya no se renueva gratis (salvo en las cuentas de prueba)', async () => {
  const antes = await pagos();
  await db.exec(`update public.suscripciones set hasta = public.hoy_lima() - 1 where user_id in ('${A}', '${B}')`);
  assert.equal(await como(B, `select * from public.mi_suscripcion()`), null);
  const b = await plan(B);
  assert.deepEqual([b.plan, b.hasta, b.renovacion_automatica], ['gratis', null, false], 'Beto vuelve a Gratis');
  assert.equal(await como(A, `select * from public.mi_suscripcion()`), null);
  const a = await plan(A);
  assert.equal(a.plan, 'pro', 'Ana, cuenta de prueba, se renueva como antes');
  assert.ok(iso(a.hasta) > iso(await hoy()));
  assert.equal(await pagos(), antes + 1, 'solo el pago (demo) de la renovación de Ana');
  // Sin lista, todo vuelve a ser como antes.
  await db.exec(`delete from public.cuentas_prueba`);
  assert.equal(await como(B, `select * from public.simular_pago('mes', 'yape')`), null);
});
