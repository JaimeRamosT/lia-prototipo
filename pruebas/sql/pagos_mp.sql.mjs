// Prueba la migración del cobro con Mercado Pago (docs/pagos.md) en PGlite, sobre cuentas y planes y la preventa.
// Lo llama solo lia-pagos (service_role): la app no crea, lee ni aprueba pagos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const M = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
// Como en Supabase: lo nuevo del esquema public nace con permisos para los tres roles.
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
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const db = new PGlite();
const una = async (q, p) => (await db.query(q, p)).rows[0];
const falla = async q => { try { await db.query(q); return null; } catch (e) { return e; } };
const hoy = async () => (await una(`select public.hoy_lima() d`)).d;
const mas = (d, meses) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + meses); return x.toISOString().slice(0, 10); };
const iso = d => new Date(d).toISOString().slice(0, 10);
const plan = uid => una(`select * from public.suscripciones where user_id = '${uid}'`);
const pagos = async uid => Number((await una(`select count(*) n from public.pagos where user_id = '${uid}'`)).n);
// Como lia-pagos: rol service_role.
const servidor = async q => { await db.exec('set role service_role'); try { return (await db.query(q)).rows[0]; } finally { await db.exec('reset role'); } };
const crear = (uid, per) => servidor(`select * from public.crear_pago_mp('${uid}', '${per}')`);
const registrar = (id, pago, estado, monto, moneda = 'PEN', medio = 'yape') =>
  servidor(`select public.registrar_pago_mp('${id}', '${pago}', '${estado}', ${monto}, '${moneda}', '${medio}') r`).then(x => x.r);

test('preparar la base', async () => {
  await db.exec(BASE);
  for (const f of ['20261026005847_cuentas_y_suscripciones.sql', '20261104140000_preventa.sql']) await db.exec(fs.readFileSync(M + f, 'utf8'));
  const sql = fs.readFileSync(M + '20261104150000_pagos_mp.sql', 'utf8');
  await db.exec(sql);
  await db.exec(sql);   // se puede aplicar dos veces
  await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${A}', 'ana@correo.pe', now()), ('${B}', 'beto@correo.pe', now())`);
});

test('crear_pago_mp anota un pago pendiente con el precio del servidor', async () => {
  const p = await crear(A, 'ciclo');
  assert.deepEqual([p.user_id, p.periodo, Number(p.monto), p.estado, p.mp_pago], [A, 'ciclo', 34.9, 'pendiente', null]);
  assert.match(p.id, /^[0-9a-f-]{36}$/);
  const e = await servidor(`select public.crear_pago_mp('${A}', 'anual')`).then(() => null, x => x);
  assert.match(e && e.message, /Plan no válido/);
});

test('un pago aprobado, en soles y del monto exacto, activa Pro real una sola vez', async () => {
  const p = await crear(A, 'ciclo');
  assert.equal(await registrar(p.id, '1001', 'approved', 34.90), 'aprobado');
  const s = await plan(A);
  assert.deepEqual([s.plan, s.periodo, s.medio, s.demo, s.renovacion_automatica], ['pro', 'ciclo', 'yape', false, false]);
  assert.equal(iso(s.hasta), mas(await hoy(), 4));
  const pg = await una(`select * from public.pagos where referencia = 'mp:1001'`);
  assert.deepEqual([pg.user_id, pg.medio, Number(pg.monto), pg.demo], [A, 'yape', 34.9, false]);
  // El mismo aviso otra vez (o el aviso y la revisión de la app): nada cambia.
  assert.equal(await registrar(p.id, '1001', 'approved', 34.90), 'aprobado');
  assert.equal(iso((await plan(A)).hasta), mas(await hoy(), 4));
  assert.equal(await pagos(A), 1);
});

test('siendo Pro, otro pago aprobado suma su periodo al final', async () => {
  const antes = (await plan(A)).hasta;
  const p = await crear(A, 'mes');
  assert.equal(await registrar(p.id, '1002', 'approved', 9.90, 'PEN', 'tarjeta'), 'aprobado');
  const s = await plan(A);
  assert.equal(iso(s.hasta), mas(antes, 1));
  assert.equal(s.medio, 'tarjeta');
});

test('monto distinto u otra moneda: no activa Pro y queda anotado', async () => {
  const p = await crear(B, 'mes');
  assert.equal(await registrar(p.id, '2001', 'approved', 1.00), 'monto_distinto');
  const q = await crear(B, 'mes');
  assert.equal(await registrar(q.id, '2002', 'approved', 9.90, 'USD'), 'monto_distinto');
  assert.equal((await plan(B))?.plan ?? 'gratis', 'gratis');
  assert.equal(await pagos(B), 0);
  assert.equal((await una(`select estado from public.pagos_mp where id = '${p.id}'`)).estado, 'monto_distinto');
});

test('rechazado o en proceso no activa; si después se aprueba otro intento, sí', async () => {
  const p = await crear(B, 'mes');
  assert.equal(await registrar(p.id, '3001', 'rejected', 9.90), 'rechazado');
  assert.equal(await registrar(p.id, '3002', 'in_process', 9.90), 'en_proceso');
  assert.equal((await plan(B))?.plan ?? 'gratis', 'gratis');
  assert.equal(await registrar(p.id, '3003', 'approved', 9.90, 'PEN', 'mercadopago'), 'aprobado');
  const s = await plan(B);
  assert.deepEqual([s.plan, s.medio], ['pro', 'mercadopago']);
  // Un aviso viejo de rechazo que llega tarde no deshace lo aprobado.
  assert.equal(await registrar(p.id, '3001', 'rejected', 9.90), 'aprobado');  // un rechazo tardío de otro intento
  assert.equal((await plan(B)).plan, 'pro');
});

test('un mensual real pagado con tarjeta no puede activar la renovación automática (sería Pro gratis cada mes)', async () => {
  const p = await crear(A, 'mes');
  await db.exec(`update public.suscripciones set hasta = public.hoy_lima() - 1 where user_id = '${A}'`);
  await db.exec(`select public.quitar_pro('ana@correo.pe')`);
  assert.equal(await registrar(p.id, '1500', 'approved', 9.90, 'PEN', 'tarjeta'), 'aprobado');
  const como = async q => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${A}', false);`);
    try { await db.query(q); return null; } catch (e) { return e; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); } };
  const e = await como(`select * from public.cambiar_renovacion(true)`);
  assert.match(e && e.message, /no se renueva solo/);
  assert.equal(await como(`select * from public.cambiar_renovacion(false)`), null, 'apagarla sí se puede');
  assert.equal((await plan(A)).renovacion_automatica, false);
});

test('un pago de Mercado Pago no sirve para dos pagos pendientes', async () => {
  const p = await crear(B, 'mes');
  assert.equal(await registrar(p.id, '3003', 'approved', 9.90), 'repetido');
  assert.equal(await pagos(B), 1);
});

test('ya aprobado: un segundo pago aprobado es «duplicado» y una devolución es «devuelto», sin tocar el plan', async () => {
  const p = await crear(B, 'ciclo');
  assert.equal(await registrar(p.id, '6001', 'approved', 34.90), 'aprobado');
  const hasta = (await plan(B)).hasta, n = await pagos(B);
  assert.equal(await registrar(p.id, '6002', 'approved', 34.90), 'duplicado');
  assert.equal(await registrar(p.id, '6001', 'refunded', 34.90), 'devuelto');
  assert.equal(await registrar(p.id, '6001', 'approved', 34.90), 'aprobado');
  assert.equal(iso((await plan(B)).hasta), iso(hasta));
  assert.equal(await pagos(B), n);
});

test('un id que no es de LIA no hace nada', async () => {
  assert.equal(await registrar('99999999-9999-4999-8999-999999999999', '4001', 'approved', 9.90), 'desconocido');
});

test('pago_mp_de solo devuelve el pago de esa cuenta', async () => {
  const p = await crear(A, 'mes');
  assert.equal((await servidor(`select * from public.pago_mp_de('${A}', '${p.id}')`)).estado, 'pendiente');
  assert.equal((await servidor(`select * from public.pago_mp_de('${B}', '${p.id}')`)).id, null);
});

test('la app no crea, lee ni aprueba pagos de Mercado Pago', async () => {
  for (const rol of ['anon', 'authenticated']) {
    await db.exec(`set role ${rol}`);
    const e = [
      await falla(`select public.crear_pago_mp('${A}', 'mes')`),
      await falla(`select public.registrar_pago_mp('${A}', '5001', 'approved', 9.90, 'PEN', 'yape')`),
      await falla(`select public.pago_mp_de('${A}', '${A}')`),
      await falla(`select * from public.pagos_mp`),
      await falla(`update public.pagos_mp set estado = 'aprobado'`),
    ];
    await db.exec('reset role');
    e.forEach((x, i) => assert.ok(x && /permission denied/.test(x.message), `${rol} #${i}`));
  }
  await db.exec('set role service_role');
  const directo = await falla(`select * from public.pagos_mp`);
  await db.exec('reset role');
  assert.ok(directo && /permission denied/.test(directo.message), 'ni el servidor toca la tabla sin las funciones');
});

test('el medio mercadopago cabe en suscripciones y pagos, y lo de antes sigue valiendo', async () => {
  for (const t of ['suscripciones', 'pagos']) {
    const c = await una(`select pg_get_constraintdef(oid) d from pg_constraint where conname = '${t}_medio_check'`);
    for (const m of ['yape', 'plin', 'tarjeta', 'cortesia', 'mercadopago']) assert.ok(c.d.includes(`'${m}'`), `${t}: ${m}`);
  }
});
