// Prueba la migración whatsapp_lia (docs/whatsapp-lia.md) en PGlite, sobre las migraciones de cuentas, cupo de IA y
// canales. Imita lo que trae Supabase: auth.uid() real, roles, Vault, pg_cron, pg_net y Realtime.
// Se corre con `npm ci && npm test` en pruebas/sql (y en la CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const M = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const res = []; const ok = (n, c, x) => res.push([n, !!c, x]);
const BASE = `
create schema if not exists auth; create table auth.users (id uuid primary key, email text);
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
const one = async (db, q) => (await db.query(q)).rows[0];
async function como(db, rol, uid, fn) { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); select set_config('request.jwt.claims', '', false);`); if (rol) await db.exec(`set role ${rol};`); try { return await fn(); } finally { await db.exec('reset role;'); } }
const falla = async p => { try { await p; return null; } catch (e) { return e; } };
const db = new PGlite();
await db.exec(BASE);
for (const f of fs.readdirSync(M).sort().filter(f => /cuentas_y_suscripciones|cupo_ia|_canales\.sql|canales_codigo/.test(f))) await db.exec(fs.readFileSync(M + f, 'utf8'));
const sql = fs.readFileSync(M + '20261104120000_whatsapp_lia.sql', 'utf8');
await db.exec(sql);
const otra = await falla(db.exec(sql)); ok('Se puede aplicar dos veces', otra === null, otra && otra.message);
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NA = '51911111111', NB = '51922222222';
await db.exec(`insert into auth.users values ('${A}', 'a@x.pe'), ('${B}', 'b@x.pe');`);
await db.exec(`insert into public.canales (user_id, wa_numero, wa_verificado) values ('${A}', '${NA}', true), ('${B}', '${NB}', false)`);
const sr = q => como(db, 'service_role', null, () => one(db, q));
const au = (uid, q) => como(db, 'authenticated', uid, () => one(db, q));

ok('whatsapp_senal está en la publicación de Realtime', !!(await one(db, `select 1 x from pg_publication_tables where pubname='supabase_realtime' and tablename='whatsapp_senal'`)));
// La app no llama las funciones del servidor ni lee las tablas.
for (const f of [`cuenta_whatsapp('${NA}')`, `whatsapp_estado('${NA}')`, `guardar_propuesta_whatsapp('${NA}', 'pendiente', '{}')`, `confirmar_propuesta_whatsapp('${NA}')`, `descartar_propuesta_whatsapp('${NA}')`, `usar_ia_whatsapp('${NA}', true)`, `whatsapp_visto('${'a'.repeat(64)}')`]) {
  for (const rol of ['authenticated', 'anon']) { const e = await como(db, rol, A, () => falla(db.query(`select public.${f}`))); ok(`${rol} no puede ${f.split('(')[0]}`, !!e && /permission denied/.test(e.message), e && e.message); }
}
for (const t of ['contexto_whatsapp', 'propuestas_whatsapp', 'whatsapp_vistos']) { const e = await como(db, 'authenticated', A, () => falla(db.query(`select * from public.${t}`))); ok(`authenticated no lee ${t}`, !!e); }
for (const f of [`publicar_contexto_whatsapp('{}')`, `propuestas_whatsapp_confirmadas()`, `quitar_propuestas_whatsapp('{}')`]) { const e = await como(db, 'anon', null, () => falla(db.query(`select public.${f}`))); ok(`anon no puede ${f.split('(')[0]}`, !!e); }

// Contexto
ok('Sin WhatsApp vinculado no se publica el contexto', (await au(B, `select public.publicar_contexto_whatsapp('{"evals":[]}') r`)).r === false);
ok('Con WhatsApp vinculado sí', (await au(A, `select public.publicar_contexto_whatsapp('{"evals":[{"id":"e1","course":"Cálculo"}]}') r`)).r === true);
ok('Un contexto enorme se rechaza', !!(await como(db, 'authenticated', A, () => falla(db.query(`select public.publicar_contexto_whatsapp(jsonb_build_object('x', repeat('a', 70000)))`)))));
ok('Uno que no es objeto se rechaza', !!(await como(db, 'authenticated', A, () => falla(db.query(`select public.publicar_contexto_whatsapp('[1]')`)))));
let e = (await sr(`select public.whatsapp_estado('${NA}') r`)).r;
ok('whatsapp_estado trae el contexto, Gratis y nada pendiente', e.contexto.evals[0].course === 'Cálculo' && e.pro === false && e.propuesta === null && Number(e.confirmadas) === 0 && e.avisos === true, JSON.stringify(e));
ok('Un número sin vincular no tiene estado', (await sr(`select public.whatsapp_estado('${NB}') r`)).r === null && (await sr(`select public.whatsapp_estado('51900000000') r`)).r === null);

// Propuestas
await sr(`select public.guardar_propuesta_whatsapp('${NA}', 'borrador', '{"intent":"add","items":[],"i":0}') r`);
e = (await sr(`select public.whatsapp_estado('${NA}') r`)).r;
ok('El borrador queda como propuesta', e.propuesta.estado === 'borrador');
ok('«sí» no confirma un borrador', (await sr(`select public.confirmar_propuesta_whatsapp('${NA}') r`)).r === false);
const id = (await sr(`select public.guardar_propuesta_whatsapp('${NA}', 'pendiente', '{"intent":"add","items":[{"kind":"eval"}]}') r`)).r;
ok('La propuesta reemplaza al borrador', Number((await one(db, `select count(*) n from public.propuestas_whatsapp`)).n) === 1 && (await sr(`select public.whatsapp_estado('${NA}') r`)).r.propuesta.id === id);
ok('Un estado raro se rechaza', !!(await como(db, 'service_role', null, () => falla(db.query(`select public.guardar_propuesta_whatsapp('${NA}', 'confirmada', '{}')`)))));
ok('Un número sin vincular no guarda', (await sr(`select public.guardar_propuesta_whatsapp('${NB}', 'pendiente', '{}') r`)).r === null);
ok('«sí» confirma la pendiente una sola vez', (await sr(`select public.confirmar_propuesta_whatsapp('${NA}') r`)).r === true && (await sr(`select public.confirmar_propuesta_whatsapp('${NA}') r`)).r === false);
ok('Confirmar suma 1 a la señal', Number((await one(db, `select n from public.whatsapp_senal where user_id = '${A}'`)).n) === 1);
ok('La señal la ve solo su dueño', (await como(db, 'authenticated', B, () => db.query(`select * from public.whatsapp_senal`))).rows.length === 0 && (await como(db, 'authenticated', A, () => db.query(`select * from public.whatsapp_senal`))).rows.length === 1);
ok('authenticated no escribe la señal', !!(await como(db, 'authenticated', A, () => falla(db.query(`update public.whatsapp_senal set n = 0`)))));
e = (await sr(`select public.whatsapp_estado('${NA}') r`)).r;
ok('Después del «sí», una confirmada y nada pendiente', Number(e.confirmadas) === 1 && e.propuesta === null);
ok('Cuenta las evaluaciones confirmadas que la app aún no guarda (límite de Gratis)', Number(e.confirmadas_evals) === 1, JSON.stringify(e));
let c = await como(db, 'authenticated', A, () => db.query(`select * from public.propuestas_whatsapp_confirmadas()`));
ok('La app lee su confirmada', c.rows.length === 1 && c.rows[0].id === id && c.rows[0].intencion.intent === 'add');
ok('Otra cuenta no la ve', (await como(db, 'authenticated', B, () => db.query(`select * from public.propuestas_whatsapp_confirmadas()`))).rows.length === 0);
ok('Otra cuenta no la borra', (await au(B, `select public.quitar_propuestas_whatsapp(array['${id}']::uuid[]) r`)).r === 0);
ok('La dueña la borra al guardarla', (await au(A, `select public.quitar_propuestas_whatsapp(array['${id}']::uuid[]) r`)).r === 1 && Number((await one(db, `select count(*) n from public.propuestas_whatsapp`)).n) === 0);
// Vencidas
await sr(`select public.guardar_propuesta_whatsapp('${NA}', 'pendiente', '{"intent":"log"}') r`);
await db.exec(`update public.propuestas_whatsapp set creado = now() - interval '31 minutes', vence = now() - interval '1 minute'`);
ok('Una pendiente vencida no se confirma', (await sr(`select public.confirmar_propuesta_whatsapp('${NA}') r`)).r === false);
ok('whatsapp_estado limpia lo vencido', (await sr(`select public.whatsapp_estado('${NA}') r`)).r.propuesta === null && Number((await one(db, `select count(*) n from public.propuestas_whatsapp`)).n) === 0);
await sr(`select public.guardar_propuesta_whatsapp('${NA}', 'pendiente', '{"intent":"log"}') r`);
ok('«no» descarta', (await sr(`select public.descartar_propuesta_whatsapp('${NA}') r`)).r === true && (await sr(`select public.descartar_propuesta_whatsapp('${NA}') r`)).r === false);
// Tope de 20 confirmadas
for (let k = 0; k < 22; k++) { await sr(`select public.guardar_propuesta_whatsapp('${NA}', 'pendiente', '{"k":${k}}') r`); await sr(`select public.confirmar_propuesta_whatsapp('${NA}') r`); }
ok('Hasta 20 confirmadas esperando a la app', Number((await one(db, `select count(*) n from public.propuestas_whatsapp where estado = 'confirmada'`)).n) === 20);
ok('Salen las más antiguas', !(await one(db, `select 1 x from public.propuestas_whatsapp where intencion->>'k' in ('0', '1')`)));

// Cupo de la IA: el mismo de usar_ia()
let u = (await sr(`select public.usar_ia_whatsapp('${NA}', false) r`)).r;
ok('En Gratis la IA no está permitida', u.permitido === false && u.motivo === 'solo_pro', JSON.stringify(u));
ok('auth.uid() vuelve a vacío después de la llamada', (await sr(`select auth.uid() r`)).r === null);
await db.exec(`update public.suscripciones set plan = 'pro', periodo = 'mes', medio = 'tarjeta', desde = current_date, hasta = current_date + 30 where user_id = '${A}'`);
ok('En Pro whatsapp_estado dice pro', (await sr(`select public.whatsapp_estado('${NA}') r`)).r.pro === true);
u = (await sr(`select public.usar_ia_whatsapp('${NA}', false) r`)).r;
ok('En Pro está permitida y no descuenta sin sumar', u.permitido === true && u.restantes_dia === 25, JSON.stringify(u));
u = (await sr(`select public.usar_ia_whatsapp('${NA}', true) r`)).r;
ok('Con sumar descuenta 1 del mismo cupo', u.restantes_dia === 24 && Number((await one(db, `select mensajes from public.uso_ia where user_id = '${A}'`)).mensajes) === 1, JSON.stringify(u));
const app = await au(A, `select public.usar_ia(false) r`);
ok('El chat de la app ve el mismo cupo', app.r.restantes_dia === 24, JSON.stringify(app.r));
ok('Un número sin vincular no usa el cupo', (await sr(`select public.usar_ia_whatsapp('${NB}', true) r`)).r.motivo === 'sin_vincular');
// Mensajes repetidos
const h = 'c'.repeat(64);
ok('La primera vez es nuevo; la segunda, repetido', (await sr(`select public.whatsapp_visto('${h}') r`)).r === true && (await sr(`select public.whatsapp_visto('${h}') r`)).r === false);
// Desvincular
await au(A, `select public.quitar_whatsapp() r`);
ok('Desvincular borra el contexto y las propuestas', !(await one(db, `select 1 x from public.contexto_whatsapp`)) && !(await one(db, `select 1 x from public.propuestas_whatsapp`)));
ok('Desvincular sigue quitando el número', (await one(db, `select wa_numero from public.canales where user_id = '${A}'`)).wa_numero === null);
// Al borrar la cuenta
await db.exec(`update public.canales set wa_numero = '${NA}', wa_verificado = true where user_id = '${A}'`);
await au(A, `select public.publicar_contexto_whatsapp('{"evals":[]}') r`);
await sr(`select public.guardar_propuesta_whatsapp('${NA}', 'pendiente', '{}') r`);
await db.exec(`delete from public.canales where user_id = '${A}'; delete from public.uso_ia where user_id = '${A}'; delete from public.pagos where user_id = '${A}'; delete from public.suscripciones where user_id = '${A}'; delete from auth.users where id = '${A}'`);
ok('Al borrar la cuenta se borra todo lo de WhatsApp', !(await one(db, `select 1 x from public.contexto_whatsapp`)) && !(await one(db, `select 1 x from public.propuestas_whatsapp`)) && !(await one(db, `select 1 x from public.whatsapp_senal`)));
for (const [n, c, x] of res) test(n, () => assert.ok(c, x === undefined ? n : String(x)));
