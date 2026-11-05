// Audios de WhatsApp, solo Pro (iteración 3, docs/iteracion-3.md sección 3 y docs/whatsapp-lia.md): lia-whatsapp
// descarga el audio de Meta, Groq lo transcribe (whisper-large-v3-turbo, español) y el texto sigue el mismo camino que
// un mensaje escrito. Descuenta 1 del cupo de la IA. Ni el audio ni la transcripción se guardan ni se registran.
// Supabase, Meta y Groq simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import * as W from '../supabase/functions/lia-whatsapp/logica.js';
import * as A from '../supabase/functions/lia-whatsapp/audio.js';
import { estadoEval } from './ia/evaluar.mjs';

const SECRETO = 'secreto-de-la-app', NUM = '51987654321', MEDIA = '1234567890123456';
const P1 = '11111111-1111-4111-8111-111111111111';
const LUNES_10 = '2026-10-26T15:00:00Z';   // lunes 26 de octubre, 10:00 en Lima
const URL_AUDIO = `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${MEDIA}&ext=1&hash=abc`;
const DICHO = 'Tengo parcial de estadística el viernes a las 10';
const CONTEXTO = (() => { const s = estadoEval(); return { settings: { wake: s.settings.wake, sleep: s.settings.sleep }, evals: s.evals.map(e => ({ ...e, hecho: 0, sinHueco: 0 })), commitments: s.commitments }; })();
const estadoWa = (x = {}) => ({ avisos: true, pro: true, contexto: CONTEXTO, propuesta: null, confirmadas: 0, ...x });

// Un Ogg/Opus mínimo (como las notas de voz de WhatsApp): cabecera OpusHead y la última página con su posición.
function ogg(segundos, { preskip = 312 } = {}) {
  const pagina = (granulo, datos, tipo) => {
    const h = Buffer.alloc(28);
    h.write('OggS', 0, 'latin1'); h[5] = tipo; h.writeBigUInt64LE(BigInt(granulo), 6); h.writeUInt32LE(7, 14); h[26] = 1; h[27] = datos.length;
    return Buffer.concat([h, datos]);
  };
  const cabeza = Buffer.alloc(19); cabeza.write('OpusHead', 0, 'latin1'); cabeza[8] = 1; cabeza[9] = 1; cabeza.writeUInt16LE(preskip, 10); cabeza.writeUInt32LE(48000, 12);
  return new Uint8Array(Buffer.concat([pagina(0, cabeza, 2), pagina(0, Buffer.from('OpusTags'), 0), pagina(preskip + Math.round(segundos * 48000), Buffer.alloc(200, 7), 4)]));
}

function lia({ estado = estadoWa(), env = {}, rpc = {}, bytes = ogg(8), media = {}, metaMedia = 200, descarga = 200, groq = () => ({ text: ` ${DICHO}.` }), groqChat = null } = {}) {
  const llamadas = [], enviados = [], logs = [], meta = [], transcripciones = [], chat = [];
  const E = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv', WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '123', WHATSAPP_APP_SECRET: SECRETO, GROQ_API_KEY: 'clave-groq', ...env };
  const R = { whatsapp_estado: estado, whatsapp_visto: true, usar_ia_whatsapp: { permitido: true, restantes_dia: 20, restantes_mes: 200 }, guardar_propuesta_whatsapp: P1, agenda_whatsapp: [], ...rpc };
  const deps = {
    env: k => E[k], log: d => logs.push(d), crypto: webcrypto, ahora: () => new Date(LUNES_10), tiempoAudio: 50,
    fetch: async (url, op = {}) => {
      url = String(url);
      if (url.endsWith('/messages')) { enviados.push(JSON.parse(op.body)); return new Response('{}'); }
      if (url.startsWith('https://graph.facebook.com/')) {
        meta.push({ url, auth: op.headers && op.headers.Authorization });
        return metaMedia === 200 ? new Response(JSON.stringify({ messaging_product: 'whatsapp', url: URL_AUDIO, mime_type: 'audio/ogg; codecs=opus', sha256: 'x', file_size: bytes.length, id: MEDIA, ...media })) : new Response('{"error":{"code":100}}', { status: metaMedia });
      }
      if (url === URL_AUDIO) { meta.push({ url, auth: op.headers && op.headers.Authorization }); return descarga === 200 ? new Response(bytes, { headers: { 'Content-Type': 'audio/ogg' } }) : new Response('no', { status: descarga }); }
      if (url === 'https://api.groq.com/openai/v1/audio/transcriptions') {
        const f = op.body, archivo = f.get('file');
        transcripciones.push({ auth: op.headers.Authorization, model: f.get('model'), language: f.get('language'), response_format: f.get('response_format'), nombre: archivo.name, tipo: archivo.type, bytes: new Uint8Array(await archivo.arrayBuffer()), signal: op.signal });
        const r = await groq(op);
        return r instanceof Response ? r : new Response(JSON.stringify(r));
      }
      if (url.includes('api.groq.com')) { chat.push(JSON.parse(op.body)); return groqChat ? groqChat() : new Response('{}', { status: 500 }); }
      const fn = url.split('/rpc/')[1], body = op.body ? JSON.parse(op.body) : null;
      llamadas.push({ fn, body });
      const r = R[fn];
      return new Response(JSON.stringify(typeof r === 'function' ? r(body) : r ?? null));
    },
  };
  return { deps, llamadas, enviados, logs, meta, transcripciones, chat, fn: n => llamadas.filter(l => l.fn === n) };
}
const firmar = c => 'sha256=' + createHmac('sha256', SECRETO).update(c).digest('hex');
const audio = (x = {}) => ({ from: NUM, id: 'wamid.AUDIO1', type: 'audio', audio: { id: MEDIA, mime_type: 'audio/ogg; codecs=opus', voice: true, ...x } });
async function llega(m, ...mensajes) {
  const c = JSON.stringify({ entry: [{ changes: [{ value: { messages: mensajes } }] }] });
  const r = await W.manejar(new Request('https://x/lia-whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': firmar(c) }, body: c }), m.deps);
  assert.equal(r.status, 200);
  return m.enviados.at(-1);
}
const cuerpo = e => (e.type === 'interactive' ? e.interactive.body.text : e.text.body);
const tipos = m => m.logs.at(-1).tipos;
const sumas = m => m.fn('usar_ia_whatsapp').map(l => l.body.p_sumar);

// ---------- Pro con cupo ----------
test('Pro con cupo: descarga el audio de Meta, Groq lo transcribe y Lía lo entiende como un mensaje escrito', async () => {
  const m = lia();
  const e = await llega(m, audio());
  assert.deepEqual(m.meta.map(x => [x.url, x.auth]), [[`https://graph.facebook.com/${W.VERSION_API}/${MEDIA}`, 'Bearer tok'], [URL_AUDIO, 'Bearer tok']], 'los datos del audio y luego el archivo, con el token de WhatsApp');
  const t = m.transcripciones[0];
  assert.deepEqual([t.auth, t.model, t.language, t.response_format], ['Bearer clave-groq', 'whisper-large-v3-turbo', 'es', 'json']);
  assert.deepEqual([t.nombre, t.tipo], ['audio.ogg', 'audio/ogg']);
  assert.deepEqual(t.bytes, ogg(8), 'el audio tal cual');
  assert.ok(t.signal, 'con tiempo límite');
  assert.match(cuerpo(e), /^Entendí: Parcial de Estadística, vie 30 oct a las 10:00\. ¿Lo guardo en tu LIA\?$/);
  assert.equal(m.fn('guardar_propuesta_whatsapp')[0].body.p_intencion.items[0].course, 'Estadística');
  assert.deepEqual(sumas(m), [false, true], 'revisa el cupo antes y descuenta 1 al transcribir');
  assert.deepEqual(tipos(m), ['audio:ok:propuesta:add']);
  assert.equal(m.fn('whatsapp_estado').length, 1, 'una sola lectura del estado');
});

test('un «sí» dicho en un audio confirma la propuesta pendiente, igual que escrito', async () => {
  const m = lia({ estado: estadoWa({ propuesta: { id: P1, estado: 'pendiente', intencion: { intent: 'add', items: [] }, creado: LUNES_10 } }), rpc: { confirmar_propuesta_whatsapp: true }, groq: () => ({ text: 'Sí, guárdalo.' }) });
  const e = await llega(m, audio());
  assert.equal(m.fn('confirmar_propuesta_whatsapp').length, 1);
  assert.equal(cuerpo(e), W.CONFIRMADO + ' Ahí reacomodo tu estudio.');
  assert.deepEqual(tipos(m), ['audio:ok:confirmada']);
});

test('si lo transcrito necesita la IA, cuenta como cualquier mensaje escrito (1 por el audio y 1 por la IA)', async () => {
  const m = lia({ env: { IA_PROVEEDOR: 'groq', IA_RESPALDO: 'ninguno' }, groq: () => ({ text: 'xq la profe dijo q eco va el lunes 2 a las 8 qwerty' }),
    groqChat: () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ intent: 'add', texto: 'Anoto el parcial.', evaluaciones: [{ tipo: 'parcial', curso: 'Economía', fecha: '2026-11-02', hora: '08:00' }] }) } }], usage: {} })) });
  const e = await llega(m, audio());
  assert.match(cuerpo(e), /^Entendí: Parcial de Economía, lun 2 nov a las 08:00\./);
  assert.deepEqual(sumas(m), [false, true, false, true]);
  assert.equal(m.chat.length, 1);
  assert.deepEqual(tipos(m), ['audio:ok:propuesta:add[groq]']);
});

// ---------- Gratis, sin cupo, sin activar ----------
test('en Gratis: «Los audios son de LIA Pro», sin descargar ni transcribir ni tocar el cupo', async () => {
  const m = lia({ estado: estadoWa({ pro: false }) });
  const e = await llega(m, audio());
  assert.equal(cuerpo(e), 'Los audios son de LIA Pro. Escríbeme lo mismo y lo entiendo.');
  assert.equal(m.meta.length + m.transcripciones.length + m.fn('usar_ia_whatsapp').length, 0);
  assert.deepEqual(tipos(m), ['audio:pro']);
});

test('en Pro sin cupo de la IA: lo dice y no descarga el audio', async () => {
  for (const [motivo, re] of [['cupo_dia', /^Ya usaste tus 25 mensajes con IA de hoy/], ['cupo_mes', /^Ya usaste tus 300 mensajes con IA de este mes/]]) {
    const m = lia({ rpc: { usar_ia_whatsapp: { permitido: false, motivo, restantes_dia: 0 } } });
    const e = await llega(m, audio());
    assert.match(cuerpo(e), re);
    assert.match(cuerpo(e), /escríbeme/);
    assert.equal(m.meta.length + m.transcripciones.length, 0);
    assert.deepEqual(sumas(m), [false]);
    assert.deepEqual(tipos(m), ['audio:cupo']);
  }
  const m = lia({ rpc: { usar_ia_whatsapp: { permitido: false, motivo: 'solo_pro' } } });   // el plan venció hace un momento
  assert.equal(cuerpo(await llega(m, audio())), A.AUDIO.pro);
});

test('en Pro sin Lía activada en WhatsApp: no manda el audio a Groq y dice cómo activarla', async () => {
  const m = lia({ estado: estadoWa({ contexto: null }) });
  const e = await llega(m, audio());
  assert.equal(cuerpo(e), A.AUDIO.sinContexto);
  assert.equal(m.meta.length + m.transcripciones.length + m.fn('usar_ia_whatsapp').length, 0);
  assert.deepEqual(tipos(m), ['audio:sin_contexto']);
});

test('un número sin vincular recibe cómo vincularlo, sin descargar nada', async () => {
  const m = lia({ estado: null });
  assert.equal(cuerpo(await llega(m, audio())), W.SIN_VINCULAR);
  assert.equal(m.meta.length + m.transcripciones.length, 0);
});

// ---------- Muy largo o pesado ----------
test('un audio de más de 5 MB no se descarga; uno de más de 2 minutos no se transcribe; ninguno descuenta', async () => {
  const LARGO = 'Ese audio es muy largo: mándame uno de menos de 2 minutos o escríbelo.';
  let m = lia({ media: { file_size: 5 * 1024 * 1024 + 1 } });
  assert.equal(cuerpo(await llega(m, audio())), LARGO);
  assert.equal(m.meta.length, 1, 'solo pide los datos del audio');
  assert.deepEqual([m.transcripciones.length, sumas(m), tipos(m)], [0, [false], ['audio:largo']]);
  // Sin file_size en los datos, se mide lo descargado.
  m = lia({ bytes: new Uint8Array(5 * 1024 * 1024 + 10), media: { file_size: undefined } });
  assert.equal(cuerpo(await llega(m, audio())), LARGO);
  assert.equal(m.transcripciones.length, 0);
  m = lia({ bytes: ogg(121) });
  assert.equal(cuerpo(await llega(m, audio())), LARGO);
  assert.deepEqual([m.transcripciones.length, sumas(m), tipos(m)], [0, [false], ['audio:largo']]);
  m = lia({ bytes: ogg(119) });
  await llega(m, audio());
  assert.equal(m.transcripciones.length, 1, 'uno de 1:59 sí');
});

test('duracionOgg: la duración de una nota de voz Ogg/Opus; null si no es Ogg', () => {
  assert.equal(A.duracionOgg(ogg(90)), 90);
  assert.equal(A.duracionOgg(ogg(150, { preskip: 0 })), 150);
  assert.equal(A.duracionOgg(new Uint8Array(1000)), null);
  assert.equal(A.duracionOgg(new TextEncoder().encode('ID3 no es ogg')), null);
  const roto = ogg(30); roto.set([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], roto.length - 228 + 6);   // última página sin posición
  assert.equal(A.duracionOgg(roto), 0, 'sin la última posición, la de la página anterior');
});

// ---------- Fallas ----------
test('si la transcripción falla, tarda o viene vacía: «No pude escuchar ese audio» y no descuenta', async () => {
  const NO = 'No pude escuchar ese audio. ¿Me lo escribes?';
  const casos = [
    ['groq', () => new Response('{"error":{}}', { status: 500 })],
    ['limite', () => new Response('{"error":{}}', { status: 429 })],
    ['vacio', () => ({ text: '   ' })],
    ['tiempo', op => new Promise((_, no) => op.signal.addEventListener('abort', () => no(new DOMException('abortado', 'AbortError'))))],
  ];
  for (const [motivo, groq] of casos) {
    const m = lia({ groq });
    assert.equal(cuerpo(await llega(m, audio())), NO, motivo);
    assert.deepEqual(sumas(m), [false], motivo);
    assert.deepEqual(tipos(m), [`audio:error:${motivo}`]);
    assert.equal(m.fn('guardar_propuesta_whatsapp').length, 0);
  }
});

test('si Meta no da el audio o no hay clave de Groq: «No pude escuchar ese audio»', async () => {
  let m = lia({ metaMedia: 404 });
  assert.equal(cuerpo(await llega(m, audio())), A.AUDIO.error);
  assert.deepEqual([m.transcripciones.length, tipos(m)], [0, ['audio:error:meta']]);
  m = lia({ descarga: 403 });
  assert.equal(cuerpo(await llega(m, audio())), A.AUDIO.error);
  assert.deepEqual(tipos(m), ['audio:error:descarga']);
  m = lia({ env: { GROQ_API_KEY: '' } });
  assert.equal(cuerpo(await llega(m, audio())), A.AUDIO.error);
  assert.deepEqual([m.meta.length, m.fn('usar_ia_whatsapp').length, tipos(m)], [0, 0, ['audio:error:sin_clave']]);
  // El token de WhatsApp solo va a direcciones de Meta.
  m = lia({ media: { url: 'https://otro.sitio/audio.ogg' } });
  assert.equal(cuerpo(await llega(m, audio())), A.AUDIO.error);
  assert.deepEqual([m.meta.length, tipos(m)], [1, ['audio:error:meta']]);
});

// ---------- Privacidad ----------
test('el registro lleva solo el tipo: nunca el audio, la transcripción, el número ni la dirección del archivo', async () => {
  const m = lia();
  await llega(m, audio());
  const t = JSON.stringify(m.logs);
  for (const x of [NUM, 'stadíst', 'viernes', MEDIA, 'lookaside', 'clave-groq', 'Bearer']) assert.ok(!t.includes(x), `el registro lleva ${x}: ${t}`);
  assert.ok(!JSON.stringify(m.llamadas).includes('stadística el viernes'), 'la base no recibe la transcripción');
});

test('una foto sigue recibiendo que por ahora solo lee texto (y audios en Pro)', async () => {
  const m = lia();
  const e = await llega(m, { from: NUM, type: 'image', image: { id: 'x' } });
  assert.match(cuerpo(e), /^Por ahora solo leo mensajes de texto/);
  assert.equal(m.meta.length, 0);
});
