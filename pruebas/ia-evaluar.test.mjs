// La evaluación con Gemini (pruebas/ia/evaluar.mjs): que las frases estén bien escritas y que la revisión sea justa.
// Gemini está simulado: la evaluación real se corre a mano, con la clave de Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L } from './logica.mjs';
import { cargarFrases, estadoEval, ahoraLocal, revisar, evaluarFrase } from './ia/evaluar.mjs';

const frases = cargarFrases();
const n = ahoraLocal();
const dias = f => Math.round((L.fromYmd(f) - L.fromYmd(L.ymd(n))) / 864e5);
const alternativas = e => (Array.isArray(e) ? e : [e]);

test('el set tiene entre 60 y 100 frases, con identificadores únicos', () => {
  assert.ok(frases.length >= 60 && frases.length <= 100, `${frases.length} frases`);
  assert.equal(new Set(frases.map(f => f.id)).size, frases.length);
  for (const f of frases) assert.ok(typeof f.frase === 'string' && f.frase.trim() && f.frase.length <= 500, f.id);
});

test('lo esperado es algo que la app puede aceptar: fechas, horas, ids y rangos de validarIA()', () => {
  const s = estadoEval(), evals = new Set(s.evals.map(e => e.id)), fijos = new Set(s.commitments.map(c => c.id));
  const hora = h => h === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
  const fecha = (f, a, b) => L.fechaIA(f) === f && dias(f) >= a && dias(f) <= b;
  for (const f of frases) for (const e of alternativas(f.espera)) {
    const donde = `${f.id} ${JSON.stringify(e)}`;
    switch (e.intent) {
      case 'add':
        assert.ok(e.items.length >= 1, donde);
        for (const i of e.items) {
          if (i.kind === 'eval') assert.ok([].concat(i.type).every(t => L.EVAL_TYPES[t]) && i.course && fecha(i.date, 0, 400) && hora(i.time), donde);
          else assert.ok(i.kind === 'commit' && [].concat(i.type).every(t => L.COMMIT_TYPES[t]) && i.days.every(d => d >= 0 && d <= 6) && hora(i.start) && hora(i.end), donde);
        }
        break;
      case 'except':
        for (const x of e.exs) assert.ok(fecha(x.date, -1, 120) && hora(x.start) && hora(x.end) && (!x.libre || fijos.has(x.ref)), donde);
        break;
      case 'log': assert.ok(evals.has(e.evalId) && fecha(e.date, -14, 0) && Number.isInteger(e.min), donde); break;
      case 'agenda': assert.ok(fecha(e.date, -7, 60), donde); break;
      default: assert.ok(['progress', 'next', 'replan', 'pregunta', 'aviso', 'fuera', 'sin_cambios'].includes(e.intent), donde);
    }
  }
});

test('revisar(): datos exactos, sin cosas inventadas, y cursos sin importar tildes ni mayúsculas', () => {
  const espera = { intent: 'add', items: [{ kind: 'eval', type: 'parcial', course: 'estadistica', date: '2026-10-30', time: '10:00' }] };
  const item = { kind: 'eval', type: 'parcial', course: 'Estadística II', date: '2026-10-30', time: '10:00', hours: 5 };
  const ia = r => ({ r, origen: 'ia', ia: r.intent });
  assert.equal(revisar(espera, ia({ intent: 'add', items: [item] })), true);
  assert.equal(revisar(espera, ia({ intent: 'add', items: [item, { ...item, course: 'Inventado' }] })), false);
  assert.equal(revisar(espera, ia({ intent: 'add', items: [{ ...item, date: '2026-10-31' }] })), false);
  assert.equal(revisar(espera, ia({ intent: 'add', items: [{ ...item, time: '' }] })), false);
  const dosDias = { intent: 'add', items: [{ kind: 'commit', type: 'trabajo', days: [0, 6], start: '08:00', end: '16:00' }] };
  assert.equal(revisar(dosDias, ia({ intent: 'add', items: [{ kind: 'commit', type: 'trabajo', name: 'Trabajo', days: [6, 0], start: '08:00', end: '16:00' }] })), true);
});

test('revisar(): cambios de un día, con o sin cosas de más', () => {
  const libera = { intent: 'except', exs: [{ date: '2026-10-27', libre: true, ref: 'c2' }] };
  const ex = { date: '2026-10-27', start: '08:00', end: '12:00', label: 'Sin Clases', libre: true, ref: 'c2' };
  const r = exs => ({ r: { intent: 'except', exs, ex: exs[0] }, origen: 'ia', ia: 'except' });
  assert.equal(revisar(libera, r([ex])), true);
  assert.equal(revisar(libera, r([{ ...ex, ref: 'c1' }])), false);
  assert.equal(revisar(libera, r([{ date: '2026-10-27', start: '08:00', end: '12:00', label: 'Ocupado' }])), false);
  const ocupa = { intent: 'except', exacto: false, exs: [{ date: '2026-10-27', start: '18:00', end: '23:00' }] };
  const turno = { date: '2026-10-27', start: '18:00', end: '23:00', label: 'Trabajo' };
  assert.equal(revisar(ocupa, r([turno, { ...ex, ref: 'c1' }])), true);
  assert.equal(revisar({ ...ocupa, exacto: true }, r([turno, { ...ex, ref: 'c1' }])), false);
});

test('revisar(): preguntar, avisar y no cambiar nada se cuentan según quién respondió', () => {
  const ia = (intent, r = { intent: 'aviso', texto: 'x' }) => ({ r, origen: 'ia', ia: intent });
  const reglas = r => ({ r, origen: 'reglas', ia: null });
  const pregunta = { intent: 'pregunta' };
  assert.equal(revisar(pregunta, ia('pregunta')), true);
  assert.equal(revisar(pregunta, ia('fuera')), false);
  const sinHora = { intent: 'pregunta', texto: '¿A qué hora?', borrador: { intent: 'add', i: 0, items: [{ kind: 'eval', type: 'examen', course: 'Inglés', date: '2026-10-28', time: '' }] } };
  assert.equal(revisar(pregunta, reglas(sinHora)), true);
  assert.equal(revisar(pregunta, reglas({ intent: 'add', items: [{ kind: 'eval', type: 'examen', course: 'Curso', date: '2026-10-28', time: '09:00' }] })), false);
  // Con «falta», tiene que preguntar ese dato: en el borrador o, con IA, en lo que Gemini dijo que preguntaba.
  assert.equal(revisar({ intent: 'pregunta', falta: 'hora' }, reglas(sinHora)), true);
  assert.equal(revisar({ intent: 'pregunta', falta: 'fecha' }, reglas(sinHora)), false);
  assert.equal(revisar({ intent: 'pregunta', falta: 'curso' }, { ...ia('pregunta'), faltaIA: 'curso' }), true);
  assert.equal(revisar({ intent: 'pregunta', falta: 'curso' }, { ...ia('pregunta'), faltaIA: 'fecha' }), false);
  assert.equal(revisar({ intent: 'sin_cambios' }, ia('fuera')), true);
  assert.equal(revisar({ intent: 'sin_cambios' }, ia('add', { intent: 'add', items: [{ kind: 'eval' }] })), false);
  assert.equal(revisar([{ intent: 'pregunta' }, { intent: 'aviso' }], ia('aviso')), true);
});

// Gemini simulado: responde lo que se le pase y guarda lo que recibió.
const simulado = (respuesta, status = 200) => {
  const pedidos = [];
  const fetch = async (url, op) => { pedidos.push({ url, op, cuerpo: JSON.parse(op.body) });
    return { ok: status === 200, status, text: async () => status === 200 ? JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(respuesta) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40 } }) : '{}' }; };
  return { fetch, pedidos };
};
const f01 = frases.find(f => f.id === 'eval-01');

test('evaluarFrase(): envía a Gemini lo mismo que la función, sin el nombre, y revisa la respuesta como la app', async () => {
  const g = simulado({ intent: 'add', texto: 'Anoto tu parcial.', evaluaciones: [{ tipo: 'parcial', curso: 'Estadística', fecha: '2026-10-30', hora: '10:00' }] });
  const r = await evaluarFrase(f01, { fetch: g.fetch, clave: 'clave-de-prueba', modelo: 'modelo-x' });
  // Las reglas entienden la frase, así que la persona ve las reglas; Gemini se consulta igual para «Solo la IA».
  assert.equal(r.soloIA, true); assert.equal(r.conRespaldo, true); assert.equal(r.origen, 'reglas'); assert.equal(r.reglas, true); assert.equal(r.vaIA, false);
  const p = g.pedidos[0], texto = p.cuerpo.contents[0].parts[0].text;
  assert.match(p.url, /models\/modelo-x:generateContent$/);
  assert.equal(p.op.headers['x-goog-api-key'], 'clave-de-prueba');
  assert.ok(texto.includes('Ahora: lunes 2026-10-26, 10:00 (hora de Lima)') && texto.includes('[c1] Trabajo (trabajo): lun, mar, mié, jue, vie, 15:00–19:00') && texto.endsWith(f01.frase), texto);
});

test('evaluarFrase(): si Gemini falla o no sirve, cuenta lo que haría la app con las reglas', async () => {
  const limite = await evaluarFrase(f01, { fetch: simulado(null, 429).fetch, clave: 'k' });
  assert.equal(limite.error, 'limite'); assert.equal(limite.soloIA, false); assert.equal(limite.conRespaldo, limite.reglas);
  const ayuda = await evaluarFrase(f01, { fetch: simulado({ intent: 'help', texto: '?' }).fetch, clave: 'k' });
  assert.equal(ayuda.origen, 'reglas'); assert.equal(ayuda.soloIA, false); assert.equal(ayuda.conRespaldo, true);
  // Si las reglas entienden, una respuesta equivocada de la IA ya no llega a la persona (antes empeoraba 20 frases).
  const malo = await evaluarFrase(f01, { fetch: simulado({ intent: 'add', texto: 'ok', evaluaciones: [{ tipo: 'parcial', curso: 'Estadística', fecha: '2026-10-31', hora: '10:00' }] }).fetch, clave: 'k' });
  assert.equal(malo.soloIA, false); assert.equal(malo.origen, 'reglas'); assert.equal(malo.conRespaldo, true);
});

test('evaluarFrase(): si las reglas no entienden, la persona ve la IA', async () => {
  const fuera = { id: 'x-fuera', frase: '¿quién ganó el partido de ayer?', espera: { intent: 'fuera' } };
  const bien = await evaluarFrase(fuera, { fetch: simulado({ intent: 'fuera', texto: 'Eso no lo sé, pero puedo anotar tus exámenes.' }).fetch, clave: 'k' });
  assert.equal(bien.vaIA, true); assert.equal(bien.origen, 'ia'); assert.equal(bien.conRespaldo, true);
  const mal = await evaluarFrase(fuera, { fetch: simulado({ intent: 'add', texto: 'ok', evaluaciones: [{ tipo: 'parcial', curso: 'Fútbol', fecha: '2026-10-31', hora: '10:00' }] }).fetch, clave: 'k' });
  assert.equal(mal.origen, 'ia'); assert.equal(mal.conRespaldo, false);
});
