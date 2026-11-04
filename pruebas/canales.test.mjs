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
  const { deps, enviados } = meta({ rpc: { whatsapp_estado: null } });
  await post(deps, mensaje('¿qué tengo hoy?'));
  assert.equal(enviados[0].body.text.body, W.SIN_VINCULAR);
});

test('whatsapp: «¿qué tengo hoy?» responde con la agenda de hoy en hora de Lima', async () => {
  const { deps, llamadas, enviados } = meta({ rpc: { whatsapp_estado: { avisos: true, pro: false, contexto: null, propuesta: null, confirmadas: 0 }, agenda_whatsapp: [
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
  const { deps, llamadas, enviados } = meta({ rpc: { whatsapp_estado: { avisos: true, pro: false, contexto: null, propuesta: null, confirmadas: 0 } } });
  await post(deps, mensaje('pausa'));
  assert.deepEqual(llamadas.at(-1), { fn: 'avisos_whatsapp_numero', body: { p_numero: '51987654321', p_activos: false } });
  assert.match(enviados[0].body.text.body, /ya no te envío avisos/);
});

test('whatsapp: una pregunta libre ya no va a Groq sin revisar el plan (en Gratis, la ayuda)', async () => {
  const m = meta({ env: { GROQ_API_KEY: 'g', IA_PROVEEDOR: 'groq' }, rpc: { whatsapp_estado: { avisos: true, pro: false, contexto: null, propuesta: null, confirmadas: 0 }, agenda_whatsapp: [] } });
  const f = m.deps.fetch;
  let groq = 0;
  m.deps.fetch = async (url, op) => (url.includes('groq.com') ? (groq++, new Response('{}')) : f(url, op));
  await post(m.deps, mensaje('asdfgh'));
  assert.equal(groq, 0);
  assert.equal(m.enviados[0].body.text.body, W.AYUDA);
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
  const m = meta({ rpc: { whatsapp_estado: { avisos: true, pro: false, contexto: null, propuesta: null, confirmadas: 0 }, agenda_whatsapp: [{ inicio: '2026-11-02T23:00:00Z', fin: '2026-11-03T01:00:00Z', titulo: 'Estudiar Cálculo II', tipo: 'estudio' }] } });
  await post(m.deps, mensaje('¿qué tengo hoy?'));
  const t = JSON.stringify(m.logs);
  assert.ok(!t.includes('51987654321') && !t.includes('Cálculo') && !t.includes('tengo'));
});

// ---------- Vincular recibiendo el código (2-nov-2026) ----------
const PROD = 'https://lia-prototipo.jaime-ramos-93c.workers.dev';
function app({ env = {}, codigo = '482913', rpcStatus = 200, rpcCuerpo = null, metaStatus = [200] } = {}) {
  const llamadas = [], enviados = [];
  const E = { ...ENV, SUPABASE_ANON_KEY: 'anon', WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '123', WHATSAPP_APP_SECRET: SECRETO, WHATSAPP_PLANTILLA_CODIGO: 'lia_codigo', ...env };
  let m = 0;
  const deps = { env: k => E[k], log: () => {}, crypto: webcrypto,
    fetch: async (url, op) => {
      const body = op.body ? JSON.parse(op.body) : null;
      if (url.includes('graph.facebook.com')) { enviados.push(body); return new Response('{}', { status: metaStatus[Math.min(m++, metaStatus.length - 1)] }); }
      llamadas.push({ fn: url.split('/rpc/')[1], body, auth: op.headers.Authorization });
      if (url.endsWith('pedir_codigo_whatsapp')) return new Response(JSON.stringify(rpcCuerpo ?? codigo), { status: rpcStatus });
      return new Response('null');
    } };
  return { deps, llamadas, enviados };
}
const pedirCodigo = (deps, numero = '987 654 321', origin = PROD) => W.manejar(new Request('https://x/lia-whatsapp', {
  method: 'POST', headers: { origin, authorization: 'Bearer usuario', apikey: 'anon', 'content-type': 'application/json' }, body: JSON.stringify({ accion: 'codigo', numero }) }), deps);

test('código: con la sesión de la persona pide el código y lo envía con la plantilla de autenticación', async () => {
  const a = app();
  const r = await pedirCodigo(a.deps);
  assert.deepEqual(await r.json(), { ok: true, enviado: true });
  assert.equal(r.headers.get('access-control-allow-origin'), PROD);
  assert.deepEqual([a.llamadas[0].fn, a.llamadas[0].auth], ['pedir_codigo_whatsapp', 'Bearer usuario'], 'como la persona, no como el servidor');
  assert.deepEqual(a.enviados[0].template.components, [{ type: 'body', parameters: [{ type: 'text', text: '482913' }] }, { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '482913' }] }]);
  assert.deepEqual([a.enviados[0].to, a.enviados[0].template.name], ['51987654321', 'lia_codigo']);
  assert.deepEqual(a.llamadas.at(-1), { fn: 'codigo_whatsapp_enviado', body: { p_numero: '51987654321' }, auth: 'Bearer srv' });
});

test('código: si la plantilla no tiene botón, reintenta solo con el cuerpo', async () => {
  const a = app({ metaStatus: [400, 200] });
  assert.equal((await (await pedirCodigo(a.deps)).json()).enviado, true);
  assert.equal(a.enviados.length, 2);
  assert.equal(a.enviados[1].template.components.length, 1);
});

test('código: sin plantilla o si Meta falla, no lo marca como enviado (la app muestra el código)', async () => {
  let a = app({ env: { WHATSAPP_PLANTILLA_CODIGO: '' } });
  assert.deepEqual(await (await pedirCodigo(a.deps)).json(), { ok: true, enviado: false, motivo: 'sin_plantilla' });
  assert.equal(a.llamadas.some(l => l.fn === 'codigo_whatsapp_enviado'), false);
  a = app({ metaStatus: [500] });
  assert.equal((await (await pedirCodigo(a.deps)).json()).enviado, false);
  assert.equal(a.llamadas.some(l => l.fn === 'codigo_whatsapp_enviado'), false);
});

test('código: errores claros y nada enviado', async () => {
  for (const [msg, error, status] of [['espera', 'espera', 400], ['numero_ocupado', 'numero_ocupado', 400]]) {
    const a = app({ rpcStatus: 400, rpcCuerpo: { message: msg } });
    const r = await pedirCodigo(a.deps);
    assert.deepEqual([r.status, (await r.json()).error], [status, error]);
    assert.equal(a.enviados.length, 0);
  }
  let a = app({ rpcStatus: 401, rpcCuerpo: { message: 'JWT expired' } });
  assert.equal((await (await pedirCodigo(a.deps)).json()).error, 'sesion');
  a = app();
  assert.equal((await pedirCodigo(a.deps, '123')).status, 400);
  assert.equal((await pedirCodigo(a.deps, '987654321', 'https://otro.sitio')).status, 403);
  assert.equal(a.llamadas.length + a.enviados.length, 0);
  assert.equal((await W.manejar(new Request('https://x/lia-whatsapp', { method: 'OPTIONS', headers: { origin: PROD } }), a.deps)).status, 204);
});

test('código: normaliza el número como la base', () => {
  assert.equal(W.normalizarNumero('987 654 321'), '51987654321');
  assert.equal(W.normalizarNumero('+51 987-654-321'), '51987654321');
  assert.equal(W.normalizarNumero('+1 (555) 140-4567'), '15551404567');
  assert.equal(W.normalizarNumero('12'), null);
});
