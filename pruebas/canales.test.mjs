// Canales (docs/canales.md): lia-calendario (enlace iCal para Google Calendar) y lia-whatsapp (Cloud API de Meta),
// con Supabase y Meta simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import * as C from '../supabase/functions/lia-calendario/logica.js';
import * as W from '../supabase/functions/lia-whatsapp/logica.js';

const ENV = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv' };
const ev = (inicio, fin, titulo, tipo = 'estudio') => ({ id: 1, inicio, fin, titulo, tipo });

// ---------- Calendario ----------
test('calendario: iCal válido con UID estable, horas en UTC, textos escapados y líneas de 75 bytes', () => {
  const ics = C.calendarioIcs([ev('2026-11-03T01:00:00+00:00', '2026-11-03T03:00:00+00:00', 'Estudiar Cálculo II, capítulo 3; repaso'),
    ev('2026-11-05T14:00:00+00:00', '2026-11-05T15:00:00+00:00', 'Parcial de Física', 'evaluacion')], new Date('2026-11-02T19:00:00Z'));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.match(ics, /DTSTART:20261103T010000Z\r\nDTEND:20261103T030000Z/);
  assert.match(ics, /SUMMARY:Estudiar Cálculo II\\, capítulo 3\\; repaso/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  for (const l of ics.split('\r\n')) assert.ok(new TextEncoder().encode(l).length <= 75, l);
  const otra = C.calendarioIcs([ev('2026-11-03T01:00:00+00:00', '2026-11-03T03:00:00+00:00', 'Estudiar Cálculo II, capítulo 3; repaso')]);
  assert.equal(ics.match(/UID:[^\r]+/)[0], otra.match(/UID:[^\r]+/)[0], 'mismo evento, mismo UID');
});

test('calendario: pide la agenda con el token y responde text/calendar; sin token o con uno raro, 404', async () => {
  const llamadas = [];
  const deps = { env: k => ENV[k], log: () => {}, fetch: async (url, op) => { llamadas.push({ url, body: JSON.parse(op.body), h: op.headers }); return new Response(JSON.stringify([ev('2026-11-03T01:00:00Z', '2026-11-03T03:00:00Z', 'Estudiar Física')])); } };
  const t = 'a'.repeat(64);
  const r = await C.manejar(new Request(`https://x/functions/v1/lia-calendario?t=${t}`), deps);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/calendar/);
  assert.match(await r.text(), /SUMMARY:Estudiar Física/);
  assert.deepEqual([llamadas[0].url, llamadas[0].body.p_token, llamadas[0].h.apikey], ['https://p.supabase.co/rest/v1/rpc/agenda_por_token', t, 'srv']);
  for (const q of ['', '?t=corto', '?t=' + 'Z'.repeat(64)]) assert.equal((await C.manejar(new Request(`https://x/lia-calendario${q}`), deps)).status, 404);
  assert.equal(llamadas.length, 1);
});

test('calendario: el registro no guarda el token ni los títulos', async () => {
  const logs = [];
  const deps = { env: k => ENV[k], log: d => logs.push(d), fetch: async () => new Response(JSON.stringify([ev('2026-11-03T01:00:00Z', '2026-11-03T03:00:00Z', 'Estudiar Física')])) };
  await C.manejar(new Request(`https://x/lia-calendario?t=${'b'.repeat(64)}`), deps);
  assert.ok(!JSON.stringify(logs).includes('bbbb') && !JSON.stringify(logs).includes('Física'));
});

// ---------- WhatsApp ----------
const SECRETO = 'secreto-de-la-app';
function meta({ env = {}, rpc = {}, ahora = '2026-11-02T15:00:00Z' } = {}) {
  const llamadas = [], enviados = [], logs = [];
  const E = { ...ENV, WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '123', WHATSAPP_APP_SECRET: SECRETO, WHATSAPP_VERIFY_TOKEN: 'verif', ...env };
  const deps = {
    env: k => E[k], log: d => logs.push(d), crypto: webcrypto, ahora: () => new Date(ahora),
    fetch: async (url, op) => {
      const body = op.body ? JSON.parse(op.body) : null;
      if (url.includes('graph.facebook.com')) { enviados.push({ url, body, auth: op.headers.Authorization }); return new Response('{}'); }
      const fn = url.split('/rpc/')[1];
      llamadas.push({ fn, body });
      const r = rpc[fn];
      return new Response(JSON.stringify(typeof r === 'function' ? r(body) : r ?? null));
    },
  };
  return { deps, llamadas, enviados, logs };
}
const firmar = cuerpo => 'sha256=' + createHmac('sha256', SECRETO).update(cuerpo).digest('hex');
const mensaje = (texto, from = '51987654321') => JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from, type: 'text', text: { body: texto } }] } }] }] });
const post = (deps, cuerpo, firma = firmar(cuerpo)) => W.manejar(new Request('https://x/lia-whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': firma }, body: cuerpo }), deps);

test('whatsapp: Meta verifica el webhook solo con el token correcto', async () => {
  const { deps } = meta();
  const ok = await W.manejar(new Request('https://x/lia-whatsapp?hub.mode=subscribe&hub.verify_token=verif&hub.challenge=777'), deps);
  assert.deepEqual([ok.status, await ok.text()], [200, '777']);
  assert.equal((await W.manejar(new Request('https://x/lia-whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=777'), deps)).status, 403);
});

test('whatsapp: sin firma válida no hace nada', async () => {
  const { deps, llamadas, enviados } = meta();
  const r = await post(deps, mensaje('hoy'), 'sha256=' + '0'.repeat(64));
  assert.equal(r.status, 401);
  assert.equal(llamadas.length + enviados.length, 0);
  assert.equal((await post(meta({ env: { WHATSAPP_APP_SECRET: '' } }).deps, mensaje('hoy'))).status, 401, 'sin secreto configurado tampoco');
});

test('whatsapp: «LIA 123456» vincula el número y responde', async () => {
  const { deps, llamadas, enviados } = meta({ rpc: { vincular_whatsapp: true } });
  assert.equal((await post(deps, mensaje('LIA 123456'))).status, 200);
  assert.deepEqual(llamadas[0], { fn: 'vincular_whatsapp', body: { p_numero: '51987654321', p_codigo: '123456' } });
  assert.equal(enviados[0].url, 'https://graph.facebook.com/v23.0/123/messages');
  assert.equal(enviados[0].auth, 'Bearer tok');
  assert.deepEqual([enviados[0].body.to, enviados[0].body.type], ['51987654321', 'text']);
  assert.match(enviados[0].body.text.body, /vinculé este número/);
});

test('whatsapp: un número sin vincular recibe cómo vincularlo', async () => {
  const { deps, enviados } = meta({ rpc: { whatsapp_vinculado: null } });
  await post(deps, mensaje('¿qué tengo hoy?'));
  assert.equal(enviados[0].body.text.body, W.SIN_VINCULAR);
});

test('whatsapp: «¿qué tengo hoy?» responde con la agenda de hoy en hora de Lima', async () => {
  const { deps, llamadas, enviados } = meta({ rpc: { whatsapp_vinculado: true, agenda_whatsapp: [
    { inicio: '2026-11-02T23:00:00Z', fin: '2026-11-03T01:00:00Z', titulo: 'Estudiar Cálculo II', tipo: 'estudio' },
    { inicio: '2026-11-03T02:00:00Z', fin: '2026-11-03T03:00:00Z', titulo: 'Parcial de Física', tipo: 'evaluacion' }] } });
  await post(deps, mensaje('¿Qué tengo hoy?'));
  const a = llamadas.find(l => l.fn === 'agenda_whatsapp').body;
  assert.equal(a.p_hasta, '2026-11-03T05:00:00.000Z', 'hasta la medianoche de Lima');
  assert.equal(enviados[0].body.text.body, 'Hoy en LIA:\n• 18:00–20:00 Estudiar Cálculo II\n• 21:00 Parcial de Física');
});

test('whatsapp: intenciones de las reglas', () => {
  assert.deepEqual(W.intencion('lia 654321'), { tipo: 'vincular', codigo: '654321' });
  assert.equal(W.intencion('Pausa').tipo, 'pausa');
  assert.equal(W.intencion('avisos').tipo, 'avisos');
  assert.equal(W.intencion('¿qué tengo mañana?').nombre, 'Mañana');
  assert.equal(W.intencion('y pasado mañana?').nombre, 'Pasado mañana');
  assert.equal(W.intencion('cómo va mi semana').dias, 7);
  assert.equal(W.intencion('hola').tipo, 'ayuda');
  assert.equal(W.intencion('¿cuándo estudio para el parcial?').tipo, 'otro');
});

test('whatsapp: «pausa» apaga los avisos de ese número', async () => {
  const { deps, llamadas, enviados } = meta({ rpc: { whatsapp_vinculado: true } });
  await post(deps, mensaje('pausa'));
  assert.deepEqual(llamadas.at(-1), { fn: 'avisos_whatsapp_numero', body: { p_numero: '51987654321', p_activos: false } });
  assert.match(enviados[0].body.text.body, /ya no te envío avisos/);
});

test('whatsapp: una pregunta libre va a Groq con la agenda; sin clave, responde la ayuda', async () => {
  const conIA = meta({ env: { GROQ_API_KEY: 'g' }, rpc: { whatsapp_vinculado: true, agenda_whatsapp: [{ inicio: '2026-11-04T23:00:00Z', fin: '2026-11-05T01:00:00Z', titulo: 'Estudiar Física', tipo: 'estudio' }] } });
  const f = conIA.deps.fetch;
  let pedido = null;
  conIA.deps.fetch = async (url, op) => url.includes('groq.com') ? (pedido = JSON.parse(op.body), new Response(JSON.stringify({ choices: [{ message: { content: 'Estudias Física el miércoles de 18:00 a 20:00.' } }] }))) : f(url, op);
  await post(conIA.deps, mensaje('¿cuándo estudio física?'));
  assert.match(pedido.messages[1].content, /miércoles 4 nov 18:00–20:00: Estudiar Física/);
  assert.equal(conIA.enviados[0].body.text.body, 'Estudias Física el miércoles de 18:00 a 20:00.');
  const sinIA = meta({ rpc: { whatsapp_vinculado: true, agenda_whatsapp: [] } });
  await post(sinIA.deps, mensaje('¿cuándo estudio física?'));
  assert.equal(sinIA.enviados[0].body.text.body, W.AYUDA);
});

test('whatsapp: pg_cron envía los avisos que tocan; con plantilla, como plantilla', async () => {
  const filas = [{ numero: '51987654321', titulo: 'Estudiar Cálculo II', inicio: '2026-11-02T23:00:00Z', fin: '2026-11-03T01:00:00Z', tipo: 'estudio' }];
  const cron = cab => W.manejar(new Request('https://x/lia-whatsapp', { method: 'POST', headers: cab, body: '{"accion":"avisos"}' }), cab.deps);
  let m = meta({ rpc: { avisos_cron_ok: false } });
  assert.equal((await W.manejar(new Request('https://x', { method: 'POST', headers: { 'x-lia-cron': 'malo' }, body: '{}' }), m.deps)).status, 401);
  m = meta({ rpc: { avisos_cron_ok: true, tomar_avisos_whatsapp: filas } });
  await W.manejar(new Request('https://x', { method: 'POST', headers: { 'x-lia-cron': 's' }, body: '{}' }), m.deps);
  assert.match(m.enviados[0].body.text.body, /A las 18:00 empieza tu sesión: Estudiar Cálculo II \(hasta las 20:00\)/);
  m = meta({ env: { WHATSAPP_PLANTILLA: 'recordatorio_lia' }, rpc: { avisos_cron_ok: true, tomar_avisos_whatsapp: filas } });
  await W.manejar(new Request('https://x', { method: 'POST', headers: { 'x-lia-cron': 's' }, body: '{}' }), m.deps);
  assert.deepEqual(m.enviados[0].body.template, { name: 'recordatorio_lia', language: { code: 'es' }, components: [{ type: 'body', parameters: [{ type: 'text', text: '18:00' }, { type: 'text', text: 'Estudiar Cálculo II' }] }] });
  m = meta({ env: { WHATSAPP_TOKEN: '' }, rpc: { avisos_cron_ok: true } });
  const r = await W.manejar(new Request('https://x', { method: 'POST', headers: { 'x-lia-cron': 's' }, body: '{}' }), m.deps);
  assert.equal((await r.json()).sin_configurar, true);
  assert.equal(m.llamadas.some(l => l.fn === 'tomar_avisos_whatsapp'), false, 'sin claves de Meta no toma los avisos');
  void cron;
});

test('whatsapp: los registros no llevan textos ni números', async () => {
  const m = meta({ rpc: { whatsapp_vinculado: true, agenda_whatsapp: [{ inicio: '2026-11-02T23:00:00Z', fin: '2026-11-03T01:00:00Z', titulo: 'Estudiar Cálculo II', tipo: 'estudio' }] } });
  await post(m.deps, mensaje('¿qué tengo hoy?'));
  const t = JSON.stringify(m.logs);
  assert.ok(!t.includes('51987654321') && !t.includes('Cálculo') && !t.includes('tengo'));
});
