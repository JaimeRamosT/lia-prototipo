// lia-calendario, ruta para traer el Google Calendar de la persona (docs/calendario.md): POST {accion:'importar', url}
// con su sesión. Lee la «dirección secreta en formato iCal» y la devuelve sin lo que ya pasó. No guarda nada.
// Supabase y Google simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../supabase/functions/lia-calendario/logica.js';

const ENV = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'srv' };
const ORIGEN = 'https://lia-prototipo.jaime-ramos-93c.workers.dev';
const GOOGLE = 'https://calendar.google.com/calendar/ical/ana%40gmail.com/private-0123456789abcdef0123456789abcdef/basic.ics';
const HOY = new Date('2026-10-26T15:00:00Z');
const CAL = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VTIMEZONE', 'TZID:America/Lima', 'END:VTIMEZONE',
  'BEGIN:VEVENT', 'UID:viejo', 'DTSTART:20250310T140000Z', 'DTEND:20250310T150000Z', 'SUMMARY:Clase de 2025', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:semanal', 'DTSTART;TZID=America/Lima:20250310T080000', 'DTEND;TZID=America/Lima:20250310T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'SUMMARY:Cálculo', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:movida-vieja', 'RECURRENCE-ID;TZID=America/Lima:20250317T080000', 'DTSTART;TZID=America/Lima:20250318T080000', 'DTEND;TZID=America/Lima:20250318T100000', 'SUMMARY:Cálculo', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:anteayer', 'DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261025', 'SUMMARY:Anteayer', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:anoche', 'DTSTART:20261026T030000Z', 'DTEND:20261026T050000Z', 'SUMMARY:Anoche', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:futuro', 'DTSTART:20261105T140000Z', 'DTEND:20261105T160000Z', 'SUMMARY:Parcial de Física', 'END:VEVENT',
  'END:VCALENDAR', ''].join('\r\n');

function simular({ sesion = true, google = () => new Response(CAL, { status: 200, headers: { 'Content-Type': 'text/calendar' } }), limites } = {}) {
  const llamadas = [], logs = [];
  const deps = {
    env: k => ENV[k], log: d => logs.push(d), ahora: () => HOY, limites,
    fetch: async (url, op = {}) => {
      llamadas.push({ url: String(url), op });
      if (String(url) === `${ENV.SUPABASE_URL}/auth/v1/user`) return sesion && op.headers.Authorization === 'Bearer bueno'
        ? new Response(JSON.stringify({ id: 'u1' }), { status: 200 }) : new Response('{}', { status: 401 });
      return google(String(url), op);
    },
  };
  return { deps, llamadas, logs };
}
const pedir = (cuerpo, { token = 'bueno', origen = ORIGEN, metodo = 'POST' } = {}) => new Request('https://p.supabase.co/functions/v1/lia-calendario', {
  method: metodo, headers: { 'Content-Type': 'application/json', apikey: 'anon', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origen ? { Origin: origen } : {}) },
  ...(metodo === 'POST' ? { body: JSON.stringify(cuerpo) } : {}),
});
const json = async r => [r.status, await r.json()];

test('importar: solo direcciones https de calendarios conocidos', () => {
  assert.equal(C.urlCalendario(GOOGLE), GOOGLE);
  assert.equal(C.urlCalendario('  webcal://calendar.google.com/calendar/ical/a/private-b/basic.ics '), 'https://calendar.google.com/calendar/ical/a/private-b/basic.ics');
  assert.ok(C.urlCalendario('https://outlook.office365.com/owa/calendar/abc/def/calendar.ics'));
  assert.ok(C.urlCalendario('https://outlook.live.com/owa/calendar/abc/def/calendar.ics'));
  assert.ok(C.urlCalendario('webcal://p42-caldav.icloud.com/published/2/MTIzNDU'));
  for (const mala of ['http://calendar.google.com/calendar/ical/a/b/basic.ics', 'https://calendar.google.com/calendar/u/0/r',
    'https://calendar.google.com.evil.pe/calendar/ical/a/b/basic.ics', 'https://user:pw@calendar.google.com/calendar/ical/a/b/basic.ics',
    'https://calendar.google.com:8443/calendar/ical/a/b/basic.ics', 'https://lvtthltugrpbqjezwnsd.supabase.co/functions/v1/lia-calendario?t=abc',
    'https://127.0.0.1/calendar/ical/a/b/basic.ics', 'file:///etc/passwd', '', 'x'.repeat(3000)])
    assert.equal(C.urlCalendario(mala), null, mala);
});

test('importar: con sesión, lee el calendario y lo devuelve sin lo que ya pasó', async () => {
  const { deps, llamadas, logs } = simular();
  const [status, r] = await json(await C.manejar(pedir({ accion: 'importar', url: GOOGLE }), deps));
  assert.equal(status, 200);
  assert.equal(r.ok, true);
  assert.match(r.ics, /^BEGIN:VCALENDAR/);
  assert.match(r.ics, /UID:semanal/, 'lo que se repite se queda');
  assert.match(r.ics, /UID:futuro/);
  assert.match(r.ics, /BEGIN:VTIMEZONE/);
  for (const k of ['UID:viejo', 'UID:movida-vieja', 'UID:anteayer']) assert.doesNotMatch(r.ics, new RegExp(k), k);
  const g = llamadas.find(l => l.url === GOOGLE);
  assert.equal(g.op.redirect, 'manual', 'las redirecciones se revisan una por una');
  assert.ok(!('Authorization' in (g.op.headers || {})), 'a Google no le llega la sesión');
  const linea = JSON.stringify(logs);
  for (const secreto of ['private-0123', 'ana%40gmail', 'Física', 'Cálculo', 'bueno']) assert.ok(!linea.includes(secreto), secreto);
  assert.equal(logs.at(-1).paso, 'importar');
});

test('importar: sin sesión 401, desde otra página 403, y a Google no se le pide nada', async () => {
  for (const [op, esperado] of [[{ token: null }, 401], [{ token: 'malo' }, 401], [{ origen: 'https://otra.pe' }, 403]]) {
    const { deps, llamadas } = simular();
    const [status, r] = await json(await C.manejar(pedir({ accion: 'importar', url: GOOGLE }, op), deps));
    assert.equal(status, esperado);
    assert.equal(r.ok, false);
    assert.ok(!llamadas.some(l => l.url.includes('google')));
  }
});

test('importar: errores claros', async () => {
  const casos = [
    [{ url: 'https://evil.pe/x.ics' }, undefined, 400, 'no_permitida'],
    [{ url: GOOGLE }, () => new Response('', { status: 404 }), 404, 'no_encontrado'],
    [{ url: GOOGLE }, () => new Response('<html>Inicia sesión</html>', { status: 200 }), 422, 'no_es_calendario'],
    [{ url: GOOGLE }, () => new Response('', { status: 302, headers: { Location: 'https://evil.pe/robar' } }), 400, 'no_permitida'],
    [{ url: GOOGLE }, () => { throw new TypeError('red'); }, 502, 'no_responde'],
    [{ url: GOOGLE }, () => new Response('BEGIN:VCALENDAR\r\n' + 'X'.repeat(5000), { status: 200 }), 413, 'muy_grande', { bytes: 1000, ms: 1000 }],
    [{ url: GOOGLE }, (u, op) => new Promise((_, no) => op.signal.addEventListener('abort', () => no(new DOMException('fin', 'AbortError')))), 504, 'tiempo', { bytes: 1e6, ms: 30 }],
    [{ accion: 'otra', url: GOOGLE }, undefined, 400, 'pedido'],
  ];
  for (const [cuerpo, google, status, error, limites] of casos) {
    const { deps } = simular({ ...(google ? { google } : {}), limites });
    const [s, r] = await json(await C.manejar(pedir({ accion: 'importar', ...cuerpo }), deps));
    assert.deepEqual([s, r.error], [status, error], error);
  }
});

test('importar: sigue una redirección dentro de Google', async () => {
  const otra = 'https://calendar.google.com/calendar/ical/ana%40gmail.com/private-x/basic.ics';
  const { deps } = simular({ google: u => u === GOOGLE ? new Response('', { status: 301, headers: { Location: otra } }) : new Response(CAL, { status: 200 }) });
  const [s, r] = await json(await C.manejar(pedir({ accion: 'importar', url: GOOGLE }), deps));
  assert.deepEqual([s, r.ok], [200, true]);
});

test('importar: CORS para la app; el enlace para Google Calendar sigue igual', async () => {
  const { deps } = simular();
  const pre = await C.manejar(new Request('https://p.supabase.co/functions/v1/lia-calendario', { method: 'OPTIONS', headers: { Origin: ORIGEN } }), deps);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGEN);
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /POST/);
  const r = await C.manejar(pedir({ accion: 'importar', url: GOOGLE }), deps);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGEN);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  const feed = await C.manejar(new Request('https://p.supabase.co/functions/v1/lia-calendario?t=x'), deps);
  assert.equal(feed.status, 404, 'GET con un token raro, como antes');
});

test('recortarIcs: deja la zona horaria, lo que se repite y lo de ayer en adelante', () => {
  const r = C.recortarIcs(CAL, '2026-10-26');
  assert.match(r, /UID:semanal/);
  assert.match(r, /UID:futuro/);
  assert.match(r, /UID:anoche/, 'con un día de margen: en UTC, «anoche» puede tener la fecha de hoy o de ayer');
  assert.doesNotMatch(r, /UID:viejo|UID:movida-vieja|UID:anteayer/);
  assert.match(r, /\r\nEND:VCALENDAR\r\n$/);
});
