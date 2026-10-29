// Edge Function lia-ia (supabase/functions/lia-ia/logica.js) con Supabase y Gemini simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../supabase/functions/lia-ia/logica.js';

const PROD = 'https://lia-prototipo.jaime-ramos-93c.workers.dev';
const MENSAJE = 'el lunes me toca chamba hasta las 10 de la noche';
const pedidoBase = () => ({
  mensaje: MENSAJE,
  historial: [{ de: 'lia', texto: '¿Para qué curso es la PC2?' }, { de: 'yo', texto: 'física' }],
  contexto: {
    ahora: '2026-10-26T17:58:00-05:00', despierto: '06:30', duermo: '23:30',
    evaluaciones: [{ id: 'e1', curso: 'Cálculo II', tipo: 'parcial', fecha: '2026-10-29', hora: '09:00' }],
    compromisos: [{ id: 'c1', nombre: 'Trabajo', tipo: 'trabajo', dias: [1, 2, 3, 4, 5], inicio: '15:00', fin: '19:00' }],
  },
});
const respuestaModelo = { intent: 'except', texto: 'Anoto que el lunes trabajas hasta las 22:00.', cambios: [{ fecha: '2026-11-02', inicio: '19:00', fin: '22:00', motivo: 'Trabajo (más tarde)', libera: false, compromisoId: 'c1' }] };
const gemini = (obj, extra = {}) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }], role: 'model' }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1900, candidatesTokenCount: 80, thoughtsTokenCount: 0 }, ...extra });

// Entorno simulado: registra las llamadas y responde según el destino.
function entorno({ cupo = { permitido: true, motivo: null, restantes_dia: 25, restantes_mes: 300 }, rpcStatus = 200, geminiResp, env = {} } = {}) {
  const llamadas = { rpc: [], gemini: [] }, logs = [];
  const deps = {
    env: k => ({ GEMINI_API_KEY: 'clave-secreta-de-prueba', SUPABASE_URL: 'https://proyecto.supabase.co', SUPABASE_ANON_KEY: 'anon', ...env })[k],
    log: d => logs.push(d),
    tiempo: 200,
    fetch: async (url, op) => {
      if (url.includes('/rest/v1/rpc/usar_ia')) {
        const b = JSON.parse(op.body); llamadas.rpc.push({ sumar: b.p_sumar, auth: op.headers.Authorization, apikey: op.headers.apikey });
        const d = b.p_sumar && cupo.permitido ? { ...cupo, restantes_dia: cupo.restantes_dia - 1, restantes_mes: cupo.restantes_mes - 1 } : cupo;
        return new Response(JSON.stringify(rpcStatus === 200 ? d : { code: '42501', message: 'Necesitas iniciar sesión' }), { status: rpcStatus });
      }
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        llamadas.gemini.push({ url, headers: op.headers, body: JSON.parse(op.body) });
        return geminiResp(op, llamadas.gemini.length);
      }
      throw new Error('destino inesperado ' + url);
    },
  };
  return { deps, llamadas, logs };
}
const pedir = (deps, { metodo = 'POST', origen = PROD, auth = 'Bearer jwt-de-ana', cuerpo = JSON.stringify(pedidoBase()), apikey = 'sb_publishable_x' } = {}) =>
  F.manejar(new Request('https://proyecto.supabase.co/functions/v1/lia-ia', {
    method: metodo, body: metodo === 'POST' ? cuerpo : undefined,
    headers: { ...(origen ? { origin: origen } : {}), ...(auth ? { authorization: auth } : {}), apikey, 'content-type': 'application/json' },
  }), deps);
const okGemini = () => new Response(JSON.stringify(gemini(respuestaModelo)), { status: 200 });

test('orígenes: producción, vistas previas y localhost sí; otros no', () => {
  for (const o of [PROD, 'https://chore-x-lia-prototipo.jaime-ramos-93c.workers.dev', 'http://localhost:8787', 'http://127.0.0.1:8000', null])
    assert.equal(F.origenPermitido(o), true, o);
  for (const o of ['https://evil.example', 'https://lia-prototipo.jaime-ramos-93c.workers.dev.evil.com', 'https://x-lia-prototipo.otro.workers.dev', 'http://localhost.evil.com'])
    assert.equal(F.origenPermitido(o), false, o);
});

test('OPTIONS responde 204 con CORS para el origen de la app', async () => {
  const { deps } = entorno({ geminiResp: okGemini });
  const r = await pedir(deps, { metodo: 'OPTIONS' });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), PROD);
  assert.match(r.headers.get('access-control-allow-headers'), /authorization/);
});

test('rechaza método, origen ajeno, sin sesión y pedidos malos sin llamar a Gemini', async () => {
  const { deps, llamadas } = entorno({ geminiResp: okGemini });
  assert.equal((await pedir(deps, { metodo: 'GET' })).status, 405);
  assert.equal((await pedir(deps, { origen: 'https://evil.example' })).status, 403);
  assert.equal((await pedir(deps, { auth: null })).status, 401);
  for (const cuerpo of ['{', '[]', JSON.stringify({ ...pedidoBase(), mensaje: '' }), JSON.stringify({ ...pedidoBase(), mensaje: 'x'.repeat(501) }),
    JSON.stringify({ ...pedidoBase(), contexto: { ahora: 'ayer' } }), 'x'.repeat(16001)]) {
    const r = await pedir(deps, { cuerpo });
    assert.equal(r.status, 400, cuerpo.slice(0, 40));
    assert.equal((await r.json()).error, 'pedido');
  }
  assert.equal(llamadas.gemini.length, 0);
  assert.equal(llamadas.rpc.length, 0);
});

test('sin la clave de Gemini responde sin_clave', async () => {
  const { deps } = entorno({ geminiResp: okGemini, env: { GEMINI_API_KEY: undefined } });
  const r = await pedir(deps);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'sin_clave');
});

test('cupo: Gratis 403, sin cupo 429 con lo que queda, sesión vencida 401; nunca llama a Gemini', async () => {
  for (const [cupo, status, error] of [
    [{ permitido: false, motivo: 'solo_pro', restantes_dia: 0, restantes_mes: 0 }, 403, 'solo_pro'],
    [{ permitido: false, motivo: 'cupo_dia', restantes_dia: 0, restantes_mes: 270 }, 429, 'cupo_dia'],
    [{ permitido: false, motivo: 'cupo_mes', restantes_dia: 25, restantes_mes: 0 }, 429, 'cupo_mes'],
  ]) {
    const { deps, llamadas } = entorno({ cupo, geminiResp: okGemini });
    const r = await pedir(deps); const b = await r.json();
    assert.equal(r.status, status); assert.equal(b.error, error);
    assert.equal(b.restantes_mes, cupo.restantes_mes);
    assert.equal(llamadas.gemini.length, 0);
  }
  const { deps, llamadas } = entorno({ rpcStatus: 401, geminiResp: okGemini });
  const r = await pedir(deps);
  assert.equal(r.status, 401); assert.equal((await r.json()).error, 'sesion');
  assert.equal(llamadas.gemini.length, 0);
});

test('respuesta correcta: revisa el cupo, pide a Gemini y recién entonces suma el mensaje', async () => {
  const { deps, llamadas, logs } = entorno({ geminiResp: okGemini });
  const r = await pedir(deps); const b = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(b.respuesta, respuestaModelo);
  assert.equal(b.restantes_dia, 24); assert.equal(b.restantes_mes, 299);
  assert.equal(b.modelo, 'gemini-3.5-flash-lite');
  assert.deepEqual(llamadas.rpc.map(x => x.sumar), [false, true]);
  assert.ok(llamadas.rpc.every(x => x.auth === 'Bearer jwt-de-ana' && x.apikey === 'sb_publishable_x'), 'usa la sesión de la persona');
  const g = llamadas.gemini[0];
  assert.match(g.url, /\/v1beta\/models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(g.headers['x-goog-api-key'], 'clave-secreta-de-prueba');
  assert.equal(r.headers.get('access-control-allow-origin'), PROD);
  const registro = JSON.stringify(logs);
  assert.ok(!registro.includes('chamba') && !registro.includes('física') && !registro.includes('clave-secreta'), 'los registros no llevan el mensaje ni la clave');
  assert.equal(logs.at(-1).intent, 'except');
  assert.equal(logs.at(-1).tokens.entrada, 1900);
});

test('el modelo se puede cambiar con el secreto GEMINI_MODELO', async () => {
  const { deps, llamadas } = entorno({ geminiResp: okGemini, env: { GEMINI_MODELO: 'gemini-3.8-flash' } });
  const b = await (await pedir(deps)).json();
  assert.match(llamadas.gemini[0].url, /gemini-3\.8-flash:generateContent/);
  assert.equal(b.modelo, 'gemini-3.8-flash');
});

test('lo que se envía a Gemini: instrucciones, esquema, contexto con calendario y sin temperature', async () => {
  const { deps, llamadas } = entorno({ geminiResp: okGemini });
  await pedir(deps);
  const body = llamadas.gemini[0].body, gc = body.generationConfig;
  assert.equal(body.system_instruction.parts[0].text, F.INSTRUCCIONES);
  assert.equal(gc.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(gc.responseFormat.text.mimeType, 'APPLICATION_JSON');
  assert.deepEqual(gc.responseFormat.text.schema, F.esquema());
  assert.equal('temperature' in gc, false);
  const texto = body.contents[0].parts[0].text;
  assert.match(texto, /Ahora: lunes 2026-10-26, 17:58/);
  assert.match(texto, /jueves 2026-10-29/);
  assert.match(texto, /viernes 2026-11-13/, '21 días de calendario');
  assert.match(texto, /\[e1\] parcial de Cálculo II, 2026-10-29 09:00/);
  assert.match(texto, /\[c1\] Trabajo \(trabajo\): lun, mar, mié, jue, vie, 15:00–19:00/);
  assert.match(texto, /Lía: ¿Para qué curso es la PC2\?\nPersona: física/);
  assert.match(texto, new RegExp(`MENSAJE\\n${MENSAJE}$`));
});

test('si la API no reconoce responseFormat, reintenta una vez con responseMimeType y responseJsonSchema', async () => {
  const geminiResp = (op, n) => n === 1
    ? new Response(JSON.stringify({ error: { code: 400, message: 'Invalid JSON payload received. Unknown name "responseFormat" at \'generation_config\': Cannot find field.' } }), { status: 400 })
    : okGemini();
  const { deps, llamadas, logs } = entorno({ geminiResp });
  const r = await pedir(deps);
  assert.equal(r.status, 200);
  assert.equal(llamadas.gemini.length, 2);
  const gc = llamadas.gemini[1].body.generationConfig;
  assert.equal(gc.responseMimeType, 'application/json');
  assert.deepEqual(gc.responseJsonSchema, F.esquema());
  assert.equal('responseFormat' in gc, false);
  assert.equal(logs.at(-1).formato, 'legado');
});

test('Gemini saturado, caído, con la clave mala o sin responder: 503 ocupado y no se gasta el cupo', async () => {
  for (const [geminiResp, detalle] of [
    [() => new Response('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}', { status: 429 }), 'limite'],
    [() => new Response('{}', { status: 500 }), 'caido'],
    [() => new Response('{}', { status: 403 }), 'clave'],
    [(op) => new Promise((_, rej) => op.signal.addEventListener('abort', () => rej(new Error('abortado')))), 'tiempo'],
    [() => Promise.reject(new TypeError('fetch failed')), 'red'],
  ]) {
    const { deps, llamadas, logs } = entorno({ geminiResp });
    const r = await pedir(deps);
    assert.equal(r.status, 503, detalle);
    assert.equal((await r.json()).error, 'ocupado');
    assert.equal(logs.at(-1).detalle, detalle);
    assert.deepEqual(llamadas.rpc.map(x => x.sumar), [false], 'solo revisó el cupo');
  }
});

test('respuesta que no cumple el esquema: 502 respuesta y no se gasta el cupo', async () => {
  for (const json of [
    { candidates: [{ content: { parts: [{ text: 'no es json' }] }, finishReason: 'STOP' }] },
    gemini({ intent: 'borrar_todo', texto: 'ok' }),
    { candidates: [{ content: { parts: [{ text: '{"intent":"add"' }] }, finishReason: 'MAX_TOKENS' }] },
    { promptFeedback: { blockReason: 'SAFETY' } },
    { candidates: [] },
  ]) {
    const { deps, llamadas } = entorno({ geminiResp: () => new Response(JSON.stringify(json), { status: 200 }) });
    const r = await pedir(deps);
    assert.equal(r.status, 502, JSON.stringify(json).slice(0, 60));
    assert.equal((await r.json()).error, 'respuesta');
    assert.deepEqual(llamadas.rpc.map(x => x.sumar), [false]);
  }
});

test('leerGemini ignora el razonamiento y los bloques ```json, y limpia campos desconocidos', () => {
  const json = { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'pensando…' }, { text: '```json\n' + JSON.stringify({ intent: 'add', texto: 'x'.repeat(400), extra: 1, evaluaciones: [{ tipo: 'parcial', curso: 'Cálculo', fecha: '2026-10-29', hora: '09:00', borrar: true }] }) + '\n```' }] } }] };
  const r = F.leerGemini(json);
  assert.equal(r.respuesta.intent, 'add');
  assert.equal(r.respuesta.texto.length, 300);
  assert.equal('extra' in r.respuesta, false);
  assert.deepEqual(r.respuesta.evaluaciones, [{ tipo: 'parcial', curso: 'Cálculo', fecha: '2026-10-29', hora: '09:00' }]);
});

test('leerPedido limpia el contexto: tipos desconocidos, días fuera de rango, historial largo', () => {
  const p = pedidoBase();
  p.contexto.compromisos.push({ id: 'c2', nombre: 'Gym', tipo: 'fiesta', dias: [6, 9, 6, -1], inicio: '07:00', fin: '08:00' }, { id: 'c3', nombre: 'Sin horas', tipo: 'otro', dias: [1] });
  p.contexto.evaluaciones.push({ id: 'e2', curso: 'Sin fecha', tipo: 'parcial' });
  p.historial = Array.from({ length: 10 }, (_, i) => ({ de: i % 2 ? 'lia' : 'yo', texto: 'm' + i }));
  const r = F.leerPedido(JSON.stringify(p));
  assert.deepEqual(r.contexto.compromisos.map(x => [x.id, x.tipo, x.dias]), [['c1', 'trabajo', [1, 2, 3, 4, 5]], ['c2', 'otro', [6]]]);
  assert.deepEqual(r.contexto.evaluaciones.map(e => e.id), ['e1']);
  assert.deepEqual(r.historial.map(h => h.texto), ['m4', 'm5', 'm6', 'm7', 'm8', 'm9']);
  assert.equal('correo' in r.contexto || 'nombre' in r.contexto, false);
});

test('el calendario cruza meses y años', () => {
  assert.deepEqual(F.calendario('2026-12-30T10:00:00-05:00', 4), ['miércoles 2026-12-30 (hoy)', 'jueves 2026-12-31 (mañana)', 'viernes 2027-01-01', 'sábado 2027-01-02']);
});

// ---------- Lía pide lo que falta (iteración 2) ----------
test('el esquema deja fuera lo que no se sabe y pide «falta» al preguntar', () => {
  const e = F.esquema();
  assert.deepEqual(e.properties.evaluaciones.items.required, ['tipo']);
  assert.deepEqual(e.properties.compromisos.items.required, ['tipo', 'nombre']);
  assert.deepEqual(e.properties.cambios.items.required, ['libera']);
  assert.equal(e.properties.estudio.required, undefined);
  assert.deepEqual(e.properties.falta.enum, ['curso', 'fecha', 'hora', 'dias', 'horario', 'evaluacion', 'minutos']);
  // Las instrucciones ya no dan una hora por defecto: piden preguntar.
  assert.ok(!/Si no dice la hora: 09:00/.test(F.INSTRUCCIONES));
  assert.match(F.INSTRUCCIONES, /nada se guarda sin hora/);
  assert.match(F.INSTRUCCIONES, /"fuera": solo si el mensaje no habla de horarios/);
});

test('leerGemini conserva «falta» (solo si es uno conocido) y lo entendido a medias', () => {
  const leer = obj => F.leerGemini(gemini(obj)).respuesta;
  const r = leer({ intent: 'pregunta', falta: 'hora', texto: '¿A qué hora vence?', evaluaciones: [{ tipo: 'entrega', curso: 'Informe de Química', fecha: '2026-11-05' }] });
  assert.deepEqual(r, { intent: 'pregunta', texto: '¿A qué hora vence?', falta: 'hora', evaluaciones: [{ tipo: 'entrega', curso: 'Informe de Química', fecha: '2026-11-05', hora: undefined }] });
  assert.equal('falta' in leer({ intent: 'pregunta', falta: 'contraseña', texto: '¿?' }), false);
});

test('el registro dice qué dato faltó, nunca el texto', async () => {
  const pregunta = { intent: 'pregunta', falta: 'horario', texto: 'Anoto el cumpleaños de Ana del sábado. ¿De qué hora a qué hora es?', cambios: [{ fecha: '2026-10-31', libera: false, motivo: 'Cumpleaños de Ana' }] };
  const { deps, logs } = entorno({ geminiResp: () => new Response(JSON.stringify(gemini(pregunta)), { status: 200 }) });
  const b = await (await pedir(deps)).json();
  assert.equal(b.respuesta.falta, 'horario');
  assert.deepEqual([logs.at(-1).intent, logs.at(-1).falta], ['pregunta', 'horario']);
  assert.ok(!JSON.stringify(logs).includes('Ana') && !JSON.stringify(logs).includes('cumpleaños'), 'sin el texto');
});
