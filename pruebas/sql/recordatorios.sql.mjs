// Prueba la migración de recordatorios de la iteración 3 (docs/iteracion-3.md, secciones 1 y 2) en PGlite, sobre las
// de cuentas, canales y Google:
//   - tomar_avisos_whatsapp() avisa de toda la agenda publicada: estudio, clases y otros 15 minutos antes; evaluaciones
//     2 horas antes. Respeta wa_verificado, wa_avisos («pausa») y avisado.
//   - Los canales de Google que ya existen vencen ya (canal_vence = now()) para que la renovación horaria los recree.
// Se corre con `npm ci && npm test` en pruebas/sql (y en la CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const M = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const NUEVA = '20261104160000_iteracion3_avisos.sql';
const BASE = `
create schema if not exists auth; create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema extensions; create function extensions.gen_random_bytes(n int) returns bytea language sql as $$ select decode(substr(md5(random()::text)||md5(random()::text)||md5(random()::text), 1, n*2), 'hex') $$;
create schema vault; create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text, secret text);
create view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret from vault.secrets;
create schema cron; create table cron.job (name text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job values (n, s, c) on conflict (name) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
create schema net; create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$ select 1::bigint $$;
create publication supabase_realtime;
insert into vault.secrets (name, secret) values ('lia_avisos_secreto', 'x');
`;
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const NA = '51911111111', NB = '51922222222', NC = '51933333333';
const db = new PGlite();
const filas = async q => (await db.query(q)).rows;
const falla = async p => { try { await p; return null; } catch (e) { return e; } };
async function como(rol, fn) { await db.exec(`reset role; set role ${rol};`); try { return await fn(); } finally { await db.exec('reset role;'); } }
const tomar = () => como('service_role', () => filas(`select * from public.tomar_avisos_whatsapp() order by inicio`));
// Un evento publicado que empieza dentro de `min` minutos (negativo: ya empezó).
const publicar = (uid, min, titulo, tipo, { avisado = false, dura = 60 } = {}) => db.exec(`insert into public.agenda_canales (user_id, inicio, fin, titulo, tipo, avisado)
  values ('${uid}', now() + interval '${min} minutes', now() + interval '${min + dura} minutes', '${titulo}', '${tipo}', ${avisado})`);

test('preparar la base: cuentas, canales y Google; canales de Google vigentes antes de la migración', async () => {
  await db.exec(BASE);
  for (const f of fs.readdirSync(M).sort().filter(f => /cuentas_y_suscripciones|cupo_ia|_canales\.sql|canales_codigo|_google\.sql/.test(f))) await db.exec(fs.readFileSync(M + f, 'utf8'));
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.pe'), ('${B}', 'b@x.pe'), ('${C}', 'c@x.pe')`);
  await db.exec(`insert into public.canales (user_id, wa_numero, wa_verificado, wa_avisos) values
    ('${A}', '${NA}', true, true), ('${B}', '${NB}', false, true), ('${C}', '${NC}', true, false)`);
  // Google: A y B con un canal que vence en 6 días (no se renovaría hasta dentro de 4); C sin canal.
  await db.exec(`insert into public.google_cuentas (user_id, cal_lia, canal_id, canal_recurso, canal_token, canal_vence, estado) values
    ('${A}', 'lia-a', 'canal-a', 'rec-a', 'tok-a', now() + interval '6 days', 'activa'),
    ('${B}', 'lia-b', 'canal-b', 'rec-b', 'tok-b', now() + interval '6 days', 'activa'),
    ('${C}', 'lia-c', null, null, null, null, 'activa')`);
  const antes = await como('service_role', () => filas(`select public.google_canales_por_vencer() r`));
  assert.deepEqual(antes[0].r, [C], 'antes de la migración, solo la cuenta sin canal');
});

test('la migración se puede aplicar dos veces', async () => {
  const sql = fs.readFileSync(M + NUEVA, 'utf8');
  assert.equal(await falla(db.exec(sql)), null);
  assert.equal(await falla(db.exec(sql)), null);
});

test('Google: los canales que ya existen vencen ya y la renovación horaria los toma; la cuenta sin canal sigue igual', async () => {
  const g = await filas(`select user_id, canal_vence <= now() vencido, canal_vence is null sin from public.google_cuentas order by user_id`);
  assert.deepEqual(g.map(x => [x.user_id, x.vencido, x.sin]), [[A, true, false], [B, true, false], [C, null, true]]);
  const r = await como('service_role', () => filas(`select public.google_canales_por_vencer() r`));
  assert.deepEqual([...r[0].r].sort(), [A, B, C]);
});

test('tomar_avisos_whatsapp: avisa de todos los tipos, 15 minutos antes (2 horas en evaluaciones)', async () => {
  await publicar(A, 10, 'Estudiar Cálculo II', 'estudio');
  await publicar(A, 20, 'Estudiar Física', 'estudio');          // todavía no
  await publicar(A, 14, 'Clase de Química', 'clase');
  await publicar(A, 16, 'Clase de Historia', 'clase');          // todavía no
  await publicar(A, 5, 'Almuerzo', 'otro', { dura: 90 });
  await publicar(A, 30, 'Gimnasio', 'otro');                    // todavía no
  await publicar(A, 110, 'Parcial de Física', 'evaluacion');
  await publicar(A, 130, 'Parcial de Cálculo', 'evaluacion');   // todavía no
  await publicar(A, -5, 'Trabajo', 'otro', { dura: 480 });      // ya empezó: no se avisa
  await publicar(A, 10, 'Inglés', 'clase', { avisado: true });  // ya avisado
  await publicar(B, 10, 'Clase de B', 'clase');                 // número sin verificar
  await publicar(C, 10, 'Evento de C', 'otro');                 // en «pausa»
  const r = await tomar();
  assert.deepEqual(r.map(x => [x.numero, x.titulo, x.tipo]), [
    [NA, 'Almuerzo', 'otro'], [NA, 'Estudiar Cálculo II', 'estudio'], [NA, 'Clase de Química', 'clase'], [NA, 'Parcial de Física', 'evaluacion'],
  ]);
  assert.ok(r.every(x => x.inicio instanceof Date && x.fin instanceof Date && x.fin > x.inicio), 'con inicio y fin');
});

test('tomar_avisos_whatsapp: lo tomado queda avisado y no se repite', async () => {
  assert.deepEqual(await tomar(), []);
  const avisados = await filas(`select titulo from public.agenda_canales where avisado order by titulo`);
  assert.deepEqual(avisados.map(x => x.titulo), ['Almuerzo', 'Clase de Química', 'Estudiar Cálculo II', 'Inglés', 'Parcial de Física']);
});

test('tomar_avisos_whatsapp: «avisos» después de «pausa» vuelve a avisar lo que toca', async () => {
  await db.exec(`update public.canales set wa_avisos = true where user_id = '${C}'`);
  assert.deepEqual((await tomar()).map(x => [x.numero, x.titulo]), [[NC, 'Evento de C']]);
});

test('tomar_avisos_whatsapp: solo service_role la llama', async () => {
  for (const rol of ['authenticated', 'anon']) {
    const e = await como(rol, () => falla(db.query(`select * from public.tomar_avisos_whatsapp()`)));
    assert.ok(e && /permission denied/.test(e.message), `${rol}: ${e && e.message}`);
  }
  const p = await filas(`select p.prosecdef def, pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'tomar_avisos_whatsapp'`);
  assert.deepEqual(p, [{ def: true, args: '' }], 'una sola versión, security definer');
});
