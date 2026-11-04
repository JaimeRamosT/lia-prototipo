// Lía en WhatsApp, igual que en la app (docs/whatsapp-lia.md): entiende con las mismas reglas y, en Pro, con la IA;
// propone, la persona confirma con «sí» y la app lo guarda. Supabase, Meta y Groq simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import * as W from '../supabase/functions/lia-whatsapp/logica.js';
import { readFileSync } from 'node:fs';
import { estadoEval } from './ia/evaluar.mjs';

const SECRETO = 'secreto-de-la-app', NUM = '51987654321';
const P1 = '11111111-1111-4111-8111-111111111111', P2 = '22222222-2222-4222-8222-222222222222';  // ids de propuestas
const LUNES_10 = '2026-10-26T15:00:00Z';   // lunes 26 de octubre, 10:00 en Lima
// Lo que publica la app (contextoWhatsapp) con el horario de ejemplo de pruebas/ia/frases.json.
const CONTEXTO = (() => { const s = estadoEval(); return {
  settings: { wake: s.settings.wake, sleep: s.settings.sleep },
  evals: s.evals.map((e, k) => ({ ...e, hecho: k === 0 ? 60 : 0, sinHueco: 0 })),
  commitments: s.commitments }; })();
// Pro por defecto: el horario de ejemplo ya tiene 3 evaluaciones próximas (el límite de Gratis).
const estadoWa = (x = {}) => ({ avisos: true, pro: true, contexto: CONTEXTO, propuesta: null, confirmadas: 0, ...x });

function lia({ estado = estadoWa(), env = {}, ahora = LUNES_10, rpc = {}, groq = null } = {}) {
  const llamadas = [], enviados = [], logs = [], ia = [];
  const E = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv', WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '123', WHATSAPP_APP_SECRET: SECRETO, ...env };
  const R = { whatsapp_estado: estado, whatsapp_visto: true, guardar_propuesta_whatsapp: P1, confirmar_propuesta_whatsapp: true, descartar_propuesta_whatsapp: true, agenda_whatsapp: [], ...rpc };
  const deps = {
    env: k => E[k], log: d => logs.push(d), crypto: webcrypto, ahora: () => new Date(ahora),
    fetch: async (url, op) => {
      const body = op.body ? JSON.parse(op.body) : null;
      if (url.includes('graph.facebook.com')) { enviados.push(body); return new Response('{}'); }
      if (url.includes('api.groq.com') || url.includes('generativelanguage')) { ia.push(body); return groq ? groq(body) : new Response('{}', { status: 500 }); }
      const fn = url.split('/rpc/')[1];
      llamadas.push({ fn, body });
      const r = R[fn];
      return new Response(JSON.stringify(typeof r === 'function' ? r(body) : r ?? null));
    },
  };
  return { deps, llamadas, enviados, logs, ia, fn: n => llamadas.filter(l => l.fn === n) };
}
const firmar = c => 'sha256=' + createHmac('sha256', SECRETO).update(c).digest('hex');
const texto = (t, id) => ({ from: NUM, ...(id ? { id } : {}), type: 'text', text: { body: t } });
const boton = (id, title) => ({ from: NUM, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
async function llega(m, ...mensajes) {
  const c = JSON.stringify({ entry: [{ changes: [{ value: { messages: mensajes } }] }] });
  const r = await W.manejar(new Request('https://x/lia-whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': firmar(c) }, body: c }), m.deps);
  assert.equal(r.status, 200);
  return m.enviados.at(-1);
}
const cuerpo = e => (e.type === 'interactive' ? e.interactive.body.text : e.text.body);
const botones = e => (e.type === 'interactive' ? e.interactive.action.buttons.map(b => [b.reply.id, b.reply.title]) : []);
const groqDice = respuesta => () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(respuesta) } }], usage: {} }));

// ---------- Proponer y confirmar ----------
test('propone una evaluación con «¿Lo guardo?» y los botones Sí y No, y la deja pendiente', async () => {
  const m = lia();
  const e = await llega(m, texto('tengo parcial de estadística el viernes a las 10'));
  assert.match(cuerpo(e), /^Entendí: Parcial de Estadística, vie 30 oct a las 10:00\. ¿Lo guardo en tu LIA\?$/);
  assert.deepEqual(botones(e), [[`si:${P1}`, 'Sí, guárdalo'], [`no:${P1}`, 'No, déjalo']], 'cada botón lleva el id de su propuesta');
  const g = m.fn('guardar_propuesta_whatsapp')[0].body;
  assert.deepEqual([g.p_numero, g.p_estado], [NUM, 'pendiente']);
  assert.deepEqual(g.p_intencion, { intent: 'add', items: [{ kind: 'eval', type: 'parcial', course: 'Estadística', date: '2026-10-30', time: '10:00', hours: 5 }] });
  assert.equal(m.fn('confirmar_propuesta_whatsapp').length, 0, 'sin «sí» no se confirma nada');
});

test('«mañana tengo examen…» es algo que anotar, no la agenda de mañana', async () => {
  const m = lia();
  await llega(m, texto('mañana tengo examen de historia a las 9'));
  assert.equal(m.fn('agenda_whatsapp').length, 0);
  assert.equal(m.fn('guardar_propuesta_whatsapp')[0].body.p_intencion.items[0].date, '2026-10-27');
});

const pendiente = (creado = LUNES_10, id = P1) => estadoWa({ propuesta: { id, estado: 'pendiente', intencion: { intent: 'add', items: [] }, creado } });
test('«sí», «dale» o el botón confirman la propuesta pendiente; «no» la descarta', async () => {
  const pend = pendiente();
  for (const msj of [texto('Sí'), texto('dale'), texto('ok, guárdalo'), boton(`si:${P1}`, 'Sí, guárdalo')]) {
    const m = lia({ estado: pend });
    const e = await llega(m, msj);
    assert.deepEqual(m.fn('confirmar_propuesta_whatsapp').map(l => l.body), [{ p_numero: NUM }]);
    assert.equal(cuerpo(e), W.CONFIRMADO + ' Ahí reacomodo tu estudio.');
    assert.equal(m.fn('guardar_propuesta_whatsapp').length, 0);
  }
  for (const msj of [texto('no'), texto('cancela'), boton(`no:${P1}`, 'No, déjalo')]) {
    const m = lia({ estado: pend });
    const e = await llega(m, msj);
    assert.equal(m.fn('descartar_propuesta_whatsapp').length, 1);
    assert.equal(m.fn('confirmar_propuesta_whatsapp').length, 0);
    assert.equal(cuerpo(e), 'Ok, no guardé nada.');
  }
});

test('un botón de un mensaje viejo no confirma ni completa otra cosa', async () => {
  for (const msj of [boton(`si:${P2}`, 'Sí, guárdalo'), boton(`no:${P2}`, 'No, déjalo'), boton('si', 'Sí, guárdalo'), boton(`op0:${P1}`, '23:59')]) {
    const m = lia({ estado: pendiente() });
    const e = await llega(m, msj);
    assert.equal(m.fn('confirmar_propuesta_whatsapp').length + m.fn('descartar_propuesta_whatsapp').length + m.fn('guardar_propuesta_whatsapp').length, 0, JSON.stringify(msj));
    assert.equal(cuerpo(e), W.VIEJO);
  }
  const m = lia();   // sin nada pendiente
  assert.equal(cuerpo(await llega(m, boton(`si:${P1}`, 'Sí, guárdalo'))), W.VIEJO);
});

test('«ok» o «listo» solo confirman una propuesta de los últimos 5 minutos; «sí» siempre', async () => {
  let m = lia({ estado: pendiente('2026-10-26T14:56:00Z') });
  await llega(m, texto('ok'));
  assert.equal(m.fn('confirmar_propuesta_whatsapp').length, 1, 'a los 4 minutos, «ok» confirma');
  m = lia({ estado: pendiente('2026-10-26T14:40:00Z') });
  await llega(m, texto('listo'));
  assert.equal(m.fn('confirmar_propuesta_whatsapp').length, 0, 'a los 20 minutos, «listo» no');
  m = lia({ estado: pendiente('2026-10-26T14:40:00Z') });
  await llega(m, texto('sí'));
  assert.equal(m.fn('confirmar_propuesta_whatsapp').length, 1, 'a los 20 minutos, «sí» sí');
});

test('si los botones no salen, la propuesta va como texto con cómo responder', async () => {
  const m = lia();
  const f = m.deps.fetch;
  m.deps.fetch = async (url, op) => (url.includes('graph.facebook.com') && JSON.parse(op.body).type === 'interactive' ? new Response('{"error":{"code":131009}}', { status: 400 }) : f(url, op));
  const e = await llega(m, texto('tengo parcial de estadística el viernes a las 10'));
  assert.equal(e.type, 'text');
  assert.match(e.text.body, /¿Lo guardo en tu LIA\?\nResponde «sí» o «no»\.$/);
});

test('sin Lía activada en WhatsApp (sin contexto), no anota ni usa la IA: dice cómo activarla', async () => {
  const m = lia({ estado: estadoWa({ contexto: null }), env: { GROQ_API_KEY: 'g', IA_PROVEEDOR: 'groq' }, rpc: { usar_ia_whatsapp: { permitido: true } } });
  let e = await llega(m, texto('tengo parcial de estadística el viernes a las 10'));
  assert.equal(cuerpo(e), W.SIN_CONTEXTO);
  e = await llega(m, texto('asdfgh'));
  assert.equal(m.ia.length + m.fn('usar_ia_whatsapp').length + m.fn('guardar_propuesta_whatsapp').length, 0);
  e = await llega(m, texto('¿qué tengo hoy?'));
  assert.equal(m.fn('agenda_whatsapp').length, 1, 'la agenda sigue funcionando');
});

test('«sí» sin nada pendiente no confirma nada y dice cómo anotar', async () => {
  const m = lia();
  const e = await llega(m, texto('sí'));
  assert.equal(m.fn('confirmar_propuesta_whatsapp').length, 0);
  assert.match(cuerpo(e), /^No tengo nada pendiente por guardar\./);
});

test('si la base ya no tiene la propuesta (venció), «sí» lo dice', async () => {
  const m = lia({ estado: pendiente(), rpc: { confirmar_propuesta_whatsapp: false } });
  const e = await llega(m, texto('sí'));
  assert.equal(cuerpo(e), W.VENCIDA);
});

// Los audios (solo Pro) están en pruebas/whatsapp-audio.test.mjs.
test('una foto o un sticker reciben que por ahora solo lee texto (y audios en Pro)', async () => {
  for (const msj of [{ from: NUM, type: 'image', image: { id: 'x' } }, { from: NUM, type: 'sticker', sticker: { id: 'y' } }]) {
    const m = lia();
    const e = await llega(m, msj);
    assert.equal(cuerpo(e), 'Por ahora solo leo mensajes de texto (y audios, en LIA Pro). Cuéntame qué anoto o pregúntame «¿qué tengo hoy?».');
  }
  const m = lia({ estado: estadoWa({ pro: false }) });
  assert.match(cuerpo(await llega(m, { from: NUM, type: 'audio', audio: { id: 'x' } })), /^Los audios son de LIA Pro\./);
});

// ---------- Lo que falta ----------
test('si falta un dato, pregunta con respuestas rápidas y guarda el borrador; la respuesta completa la propuesta', async () => {
  const m = lia();
  const e = await llega(m, texto('el otro jueves entrego el ensayo de filosofía'));
  assert.equal(cuerpo(e), '¿A qué hora vence tu ensayo de Filosofía?');
  assert.deepEqual(botones(e), [[`op0:${P1}`, '23:59']], 'solo las respuestas que completan el dato, sin «Otra hora»');
  const g = m.fn('guardar_propuesta_whatsapp')[0].body;
  assert.equal(g.p_estado, 'borrador');
  assert.equal(g.p_intencion.items[0].date, '2026-11-05');
  assert.deepEqual(g.p_intencion.opciones, [{ t: '23:59', set: { time: '23:59' } }]);
  const borr = estadoWa({ propuesta: { id: P2, estado: 'borrador', intencion: g.p_intencion, creado: '2026-10-26T14:59:00Z' } });
  for (const msj of [texto('a las 11:59 de la noche'), boton(`op0:${P2}`, '23:59')]) {
    const m2 = lia({ estado: borr });
    const e2 = await llega(m2, msj);
    const g2 = m2.fn('guardar_propuesta_whatsapp')[0].body;
    assert.equal(g2.p_estado, 'pendiente');
    assert.deepEqual(g2.p_intencion.items[0], { kind: 'eval', type: 'entrega', course: 'Ensayo de Filosofía', date: '2026-11-05', time: '23:59', hours: g.p_intencion.items[0].hours });
    assert.match(cuerpo(e2), /^Entendí: Entrega del ensayo de Filosofía|^Entendí: .*Filosofía, jue 5 nov a las 23:59/);
  }
});

test('un borrador de hace más de 10 minutos ya no se usa', async () => {
  const g = { intent: 'add', items: [{ kind: 'eval', type: 'entrega', course: 'Ensayo de Filosofía', date: '2026-11-05', time: '', hours: 4 }], i: 0, opciones: [] };
  const m = lia({ estado: estadoWa({ propuesta: { id: P2, estado: 'borrador', intencion: g, creado: '2026-10-26T14:40:00Z' } }) });
  await llega(m, texto('a las 11:59 de la noche'));
  assert.equal(m.fn('guardar_propuesta_whatsapp').filter(l => l.body.p_estado === 'pendiente').length, 0);
});

// ---------- Hora de Lima ----------
test('entiende «mañana» con la hora de Lima a las 23:30 y a las 00:30, aunque el servidor esté en UTC', async () => {
  for (const [ahora, fecha] of [['2026-10-27T04:30:00Z', '2026-10-27'], ['2026-10-27T05:30:00Z', '2026-10-28']]) {
    const m = lia({ ahora });
    await llega(m, texto('parcial de historia mañana a las 9'));
    assert.equal(m.fn('guardar_propuesta_whatsapp')[0].body.p_intencion.items[0].date, fecha, ahora);
  }
});

// ---------- Los demás cambios ----------
test('estudio hecho, cambio de un día y mover una evaluación también se proponen', async () => {
  let m = lia();
  let e = await llega(m, texto('ayer estudié 2 horas de cálculo'));
  assert.deepEqual(m.fn('guardar_propuesta_whatsapp')[0].body.p_intencion, { intent: 'log', evalId: 'e1', course: 'Cálculo II', date: '2026-10-25', min: 120 });
  assert.match(cuerpo(e), /^Entendí: estudiaste 2 h de Cálculo II ayer\. ¿Lo anoto en tu LIA\?$/);
  m = lia();
  e = await llega(m, texto('mañana no tengo clases'));
  assert.deepEqual(m.fn('guardar_propuesta_whatsapp')[0].body.p_intencion, { intent: 'except', exs: [{ date: '2026-10-27', start: '08:00', end: '12:00', label: 'Sin Clases', libre: true, ref: 'c2' }] });
  assert.match(cuerpo(e), /^Entendí: mañana no tienes Clases \(08:00–12:00\)\. ¿Lo guardo en tu LIA\?$/);
  m = lia();
  e = await llega(m, texto('pasaron mi parcial de cálculo al viernes'));
  assert.deepEqual(m.fn('guardar_propuesta_whatsapp')[0].body.p_intencion, { intent: 'cambiaEval', evalId: 'e1', date: '2026-10-30', time: '09:00' });
  assert.match(cuerpo(e), /^Entendí: tu parcial de Cálculo II pasa al vie 30 oct a las 09:00\. ¿Lo cambio en tu LIA\?$/);
});

test('«¿y si…?» por WhatsApp propone el cambio sin simular', async () => {
  const m = lia();
  await llega(m, texto('¿y si mañana no voy a clases?'));
  assert.equal(m.fn('guardar_propuesta_whatsapp')[0].body.p_intencion.intent, 'except');
});

test('en Gratis, sin espacio para otra evaluación, avisa del límite y no propone', async () => {
  const lleno = { ...CONTEXTO, evals: [...CONTEXTO.evals, { id: 'e4', type: 'parcial', course: 'Arte', date: '2026-11-10', time: '08:00', hours: 3, hecho: 0, sinHueco: 0 }] };
  const m = lia({ estado: estadoWa({ pro: false, contexto: { ...lleno, evals: lleno.evals.slice(1) } }) });
  const e = await llega(m, texto('tengo parcial de estadística el viernes a las 10'));
  assert.equal(cuerpo(e), 'En Gratis puedes tener hasta 3 evaluaciones próximas y ya tienes 3. Con LIA Pro no hay límite.');
  assert.equal(m.fn('guardar_propuesta_whatsapp').length, 0);
  const pro = lia({ estado: estadoWa({ pro: true, contexto: { ...lleno, evals: lleno.evals.slice(1) } }) });
  await llega(pro, texto('tengo parcial de estadística el viernes a las 10'));
  assert.equal(pro.fn('guardar_propuesta_whatsapp').length, 1, 'en Pro no hay límite');
});

test('el límite de Gratis cuenta lo que cuenta la app (también lo de Google) y lo confirmado que falta guardar', async () => {
  const dos = { ...CONTEXTO, evals: CONTEXTO.evals.slice(0, 2) };
  let m = lia({ estado: estadoWa({ pro: false, contexto: dos }) });
  await llega(m, texto('tengo parcial de estadística el viernes a las 10'));
  assert.equal(m.fn('guardar_propuesta_whatsapp').length, 1, 'con 2 próximas, cabe una');
  m = lia({ estado: estadoWa({ pro: false, contexto: { ...dos, proximas: 3 } }) });
  assert.match(cuerpo(await llega(m, texto('tengo parcial de estadística el viernes a las 10'))), /ya tienes 3/, 'la de Google que cuenta la app');
  m = lia({ estado: estadoWa({ pro: false, contexto: dos, confirmadas: 1, confirmadas_evals: 1 }) });
  assert.match(cuerpo(await llega(m, texto('tengo parcial de estadística el viernes a las 10'))), /ya tienes 3/, 'la confirmada que la app aún no guarda');
});

// ---------- Preguntas ----------
test('responde la próxima evaluación y el avance con lo que publicó la app', async () => {
  let m = lia();
  let e = await llega(m, texto('¿cuál es mi próxima evaluación?'));
  assert.equal(cuerpo(e), 'Tu próxima evaluación: parcial de Cálculo II, el jueves 29 de octubre a las 09:00.');
  m = lia();
  e = await llega(m, texto('¿cómo voy?'));
  assert.match(cuerpo(e), /^Cálculo II: 1 h de 5 h\nInforme de Química: 0 min de 4 h\nFísica: 0 min de 3 h/);
});

test('«¿qué tengo mañana?» lee la agenda de ese día y avisa si hay cambios por guardar', async () => {
  const m = lia({ estado: estadoWa({ confirmadas: 1 }), rpc: { agenda_whatsapp: [{ inicio: '2026-10-27T23:00:00Z', fin: '2026-10-28T01:00:00Z', titulo: 'Estudiar Física', tipo: 'estudio' }] } });
  const e = await llega(m, texto('¿qué tengo mañana?'));
  const a = m.fn('agenda_whatsapp')[0].body;
  assert.deepEqual([a.p_desde, a.p_hasta], ['2026-10-27T05:00:00.000Z', '2026-10-28T05:00:00.000Z']);
  assert.equal(cuerpo(e), 'Mañana en LIA:\n• 18:00–20:00 Estudiar Física\nOjo: tienes 1 cambio por guardar. Se guarda cuando abras LIA.');
});

test('en Pro, una frase larga con «hoy» o «mañana» va a la IA antes que a la agenda; una corta, a la agenda', async () => {
  const conIA = () => lia({ env: { GROQ_API_KEY: 'g', IA_PROVEEDOR: 'groq', IA_RESPALDO: 'ninguno' }, rpc: { usar_ia_whatsapp: { permitido: true, restantes_dia: 20 } },
    groq: groqDice({ intent: 'aviso', texto: 'Si hoy no pudiste, dime cuándo puedes y lo reacomodo.' }) });
  let m = conIA();
  let e = await llega(m, texto('hoy salí tarde y no pude estudiar nada de nada'));
  assert.equal(m.ia.length, 1);
  assert.equal(m.fn('agenda_whatsapp').length, 0);
  assert.equal(cuerpo(e), 'Si hoy no pudiste, dime cuándo puedes y lo reacomodo.');
  m = conIA();
  await llega(m, texto('semana'));
  assert.equal(m.ia.length, 0, 'corta: directo a la agenda');
  assert.equal(m.fn('agenda_whatsapp').length, 1);
});

// ---------- IA: solo Pro, con el mismo cupo ----------
test('en Gratis, lo que las reglas no entienden recibe la ayuda, sin IA ni cupo', async () => {
  const m = lia({ estado: estadoWa({ pro: false }), env: { GROQ_API_KEY: 'g', IA_PROVEEDOR: 'groq' } });
  const e = await llega(m, texto('asdfgh'));
  assert.equal(m.ia.length, 0);
  assert.equal(m.fn('usar_ia_whatsapp').length, 0);
  assert.equal(cuerpo(e), W.AYUDA);
});

test('en Pro, lo que las reglas no entienden va a la IA (Groq) y descuenta 1 del cupo solo si respondió', async () => {
  const m = lia({ estado: estadoWa({ pro: true }), env: { GROQ_API_KEY: 'g', IA_PROVEEDOR: 'groq', IA_RESPALDO: 'ninguno' },
    rpc: { usar_ia_whatsapp: { permitido: true, restantes_dia: 20, restantes_mes: 200 } },
    groq: groqDice({ intent: 'add', texto: 'Anoto el parcial.', evaluaciones: [{ tipo: 'parcial', curso: 'Economía', fecha: '2026-11-02', hora: '08:00' }] }) });
  const e = await llega(m, texto('xq la profe dijo q eco va el lunes 2 a las 8 qwerty'));
  assert.deepEqual(m.fn('usar_ia_whatsapp').map(l => l.body), [{ p_numero: NUM, p_sumar: false }, { p_numero: NUM, p_sumar: true }]);
  assert.equal(m.ia[0].model, 'openai/gpt-oss-120b');
  assert.match(m.ia[0].messages[1].content, /\[e1\] parcial de Cálculo II, 2026-10-29 09:00/);
  assert.match(m.ia[0].messages[1].content, /Ahora: lunes 2026-10-26, 10:00/);
  assert.match(cuerpo(e), /^Entendí: Parcial de Economía, lun 2 nov a las 08:00\./);
});

test('en Pro, si la IA falla no descuenta y responde con la ayuda; sin cupo, lo dice', async () => {
  let m = lia({ estado: estadoWa({ pro: true }), env: { GROQ_API_KEY: 'g', IA_PROVEEDOR: 'groq', IA_RESPALDO: 'ninguno' }, rpc: { usar_ia_whatsapp: { permitido: true, restantes_dia: 20, restantes_mes: 200 } } });
  let e = await llega(m, texto('asdfgh'));
  assert.deepEqual(m.fn('usar_ia_whatsapp').map(l => l.body.p_sumar), [false]);
  assert.equal(cuerpo(e), W.AYUDA);
  m = lia({ estado: estadoWa({ pro: true }), env: { GROQ_API_KEY: 'g', IA_PROVEEDOR: 'groq' }, rpc: { usar_ia_whatsapp: { permitido: false, motivo: 'cupo_dia', restantes_dia: 0 } } });
  e = await llega(m, texto('asdfgh'));
  assert.equal(m.ia.length, 0);
  assert.match(cuerpo(e), /^Ya usaste tus 25 mensajes con IA de hoy\. Hasta mañana te respondo con lo básico\./);
});

// ---------- Robustez y privacidad ----------
test('un mensaje que Meta reenvía no se responde dos veces', async () => {
  const m = lia({ rpc: { whatsapp_visto: false } });
  const c = JSON.stringify({ entry: [{ changes: [{ value: { messages: [texto('tengo parcial de estadística el viernes a las 10', 'wamid.ABC')] } }] }] });
  await W.manejar(new Request('https://x/lia-whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': firmar(c) }, body: c }), m.deps);
  assert.equal(m.enviados.length, 0);
  assert.equal(m.fn('guardar_propuesta_whatsapp').length, 0);
  assert.ok(!JSON.stringify(m.fn('whatsapp_visto')).includes('wamid.ABC'), 'la base guarda un hash, no el id');
});

test('los registros no llevan textos, cursos ni números', async () => {
  const m = lia();
  await llega(m, texto('tengo parcial de estadística el viernes a las 10'));
  const t = JSON.stringify(m.logs);
  assert.ok(!t.includes(NUM) && !/estad[ií]stica/i.test(t) && !t.includes('parcial'), t);
});

test('el límite de Gratis del servidor es el mismo de la app', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(W.EVALS_GRATIS, Number(html.match(/const FREE_EVALS=(\d+);/)[1]));
});
