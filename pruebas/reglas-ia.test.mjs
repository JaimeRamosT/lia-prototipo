// Frases que las reglas no entendían y que la IA tenía que cubrir (evaluación del 29-oct). Ahora las entienden las
// reglas, así que no dependen de Gemini. Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const conRutinas = () => estado({
  compromisos: [
    { id: 'c1', name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' },
    { id: 'c2', name: 'Clases', type: 'clase', days: LUN_A_VIE, start: '08:00', end: '12:00' },
    { id: 'c3', name: 'Inglés', type: 'otro', days: [6], start: '09:00', end: '11:00' },
    { id: 'c4', name: 'Gimnasio', type: 'deporte', days: [2, 4], start: '19:00', end: '20:00' },
  ],
  evaluaciones: [
    { id: 'e1', course: 'Cálculo II', date: '2026-10-29' },
    { id: 'e3', course: 'Física', type: 'practica', date: '2026-11-03' },
  ],
});
const leer = f => L.interpret(f, conRutinas(), ahora());

test('«anoche repasé media hora de física» se anota ayer', () => {
  const r = leer('anoche repasé media hora de física');
  assert.deepEqual([r.intent, r.evalId, r.date, r.min], ['log', 'e3', '2026-10-25', 30]);
});

test('«el sábado le metí 3 horas a cálculo» es estudio del sábado pasado', () => {
  const r = leer('el sábado le metí 3 horas a cálculo');
  assert.deepEqual([r.intent, r.evalId, r.date, r.min], ['log', 'e1', '2026-10-24', 180]);
});

test('«¿estoy libre el domingo?» muestra ese día', () => {
  assert.deepEqual(leer('¿estoy libre el domingo?'), { intent: 'agenda', date: '2026-11-01' });
  assert.equal(leer('¿qué hago el sábado?').date, '2026-10-31');
});

test('«ármame el horario de nuevo» rearma', () => {
  assert.equal(leer('ármame el horario de nuevo, cambié varias cosas').intent, 'replan');
  assert.equal(leer('reorganízame la semana').intent, 'replan');
});

test('«no voy a trabajar ni a clases» libera las dos rutinas', () => {
  const r = leer('pasado mañana no voy a trabajar ni a clases');
  assert.equal(r.intent, 'except');
  assert.deepEqual(r.exs.map(x => [x.date, x.ref]).sort(), [['2026-10-28', 'c1'], ['2026-10-28', 'c2']]);
});

test('una rutina se encuentra por su nombre aunque su tipo sea otro', () => {
  const r = leer('este sábado no hay clase de inglés');
  assert.deepEqual(r.exs.map(x => [x.date, x.ref]), [['2026-10-31', 'c3']]);
  // «No tengo clases» sigue buscando por tipo, y no confunde «Clases» con otra rutina.
  assert.deepEqual(leer('mañana no tengo clases').exs.map(x => x.ref), ['c2']);
  assert.deepEqual(leer('el jueves no voy al gimnasio').exs.map(x => x.ref), ['c4']);
});

test('«me demoro una hora en llegar a la u, de 7 a 8 de lunes a viernes» es un traslado', () => {
  const it = leer('me demoro una hora en llegar a la u, de 7 a 8 de lunes a viernes').items[0];
  assert.deepEqual([it.kind, it.type, it.start, it.end, it.days], ['commit', 'traslado', '07:00', '08:00', LUN_A_VIE]);
  // Sin horario, Lía pregunta los días.
  const r = leer('me demoro una hora en llegar a la u');
  assert.equal(r.intent, 'pregunta');
  assert.equal(r.borrador.items[0].type, 'traslado');
});

// Cuándo se usa la IA: solo si las reglas no entienden (pideIA). Así la IA no empeora lo que las reglas ya leen bien.
test('pideIA: solo cuando las reglas responden «no entiendo»', () => {
  assert.equal(L.pideIA({ intent: 'help' }), true);
  assert.equal(L.pideIA(null), true);
  for (const intent of ['add', 'except', 'log', 'agenda', 'progress', 'next', 'replan', 'pregunta', 'aviso', 'cambiaEval', 'quitaEval'])
    assert.equal(L.pideIA({ intent }), false, intent);
  assert.equal(L.pideIA(leer('¿quién ganó el partido de ayer?')), true);
  assert.equal(L.pideIA(leer('tengo examen de física el viernes a las 9')), false);
});
