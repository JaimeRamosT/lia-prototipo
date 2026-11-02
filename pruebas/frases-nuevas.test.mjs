// Frases nuevas que fallaban (revisión de Claude del 2-nov-2026), entre ellas la del supervisor del 30-oct:
// «Necesito que me agendes para mañana a las 10 de la mañana». Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const base = () => estado({ compromisos: [
  { id: 'c1', name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' },
  { id: 'c3', name: 'Inglés', type: 'otro', days: [6], start: '09:00', end: '11:00' },
] });
const leer = (f, s = base()) => L.interpret(f, s, ahora());

test('agendar sin decir qué: Lía pregunta qué es y guarda el día y la hora', () => {
  const r = leer('Necesito que me agendes para mañana a las 10 de la mañana');
  assert.equal(r.intent, 'pregunta');
  assert.equal(r.texto, '¿Qué quieres que agende mañana a las 10:00?');
  assert.deepEqual(r.opciones.map(o => o.t), ['Una cita', 'Una reunión', 'Otra cosa']);
  const it = r.borrador.items[0];
  assert.deepEqual([it.kind, it.date, it.start, it.end, it.label], ['evento', '2026-10-27', '10:00', '', '']);
});

test('agendar: la respuesta completa lo pendiente («un repaso de cálculo», luego «hasta las 12»)', () => {
  const s = base(), r = leer('Necesito que me agendes para mañana a las 10 de la mañana', s);
  const a = L.respuestaBorrador(r.borrador, 'un repaso de cálculo', s, ahora());
  assert.equal(a.intent, 'pregunta');
  assert.equal(a.texto, 'Anoto el repaso de cálculo de mañana a las 10:00. ¿Hasta qué hora es?');
  const b = L.respuestaBorrador(a.borrador, 'hasta las 12', s, ahora());
  assert.equal(b.intent, 'except');
  assert.deepEqual(b.exs[0], { date: '2026-10-27', start: '10:00', end: '12:00', label: 'Repaso de cálculo', cat: 'otro' });
  // Con la hora de fin en la misma respuesta, no vuelve a preguntar.
  const c = L.respuestaBorrador(r.borrador, 'es una reunión con mi grupo hasta las 12', s, ahora());
  assert.deepEqual([c.intent, c.exs[0].label, c.exs[0].end], ['except', 'Reunión con mi grupo', '12:00']);
});

test('agendar con qué, día y horas: se anota de una vez', () => {
  const r = leer('agéndame un repaso de cálculo el jueves de 4 a 6');
  assert.equal(r.intent, 'except');
  assert.deepEqual(r.exs[0], { date: '2026-10-29', start: '16:00', end: '18:00', label: 'Repaso de cálculo', cat: 'otro' });
  assert.equal(leer('agéndame para el viernes').texto, '¿Qué quieres que agende el vie 30 oct?');
});

test('«agenda» como sustantivo o con una evaluación sigue como antes', () => {
  assert.equal(leer('¿qué tengo en mi agenda mañana?').intent, 'agenda');
  const r = leer('anota que el viernes tengo parcial de física a las 9');
  assert.equal(r.intent, 'add');
  assert.equal(r.items[0].kind, 'eval');
});

test('quitar una rutina: Lía indica dónde, sin crear una rutina nueva', () => {
  const r = leer('borra la clase de inglés');
  assert.equal(r.intent, 'aviso');
  assert.match(r.texto, /«Inglés»/);
  assert.match(leer('quita mi rutina de trabajo').texto, /«Trabajo»/);
  assert.match(leer('elimina mi rutina de natación').texto, /No encontré esa rutina/);
  // Con fecha es otra cosa (un solo día): lo ve la IA.
  assert.equal(leer('borra la clase de mañana').intent, 'help');
});

test('cambiar la hora de entrada de un día: más temprano ocupa, más tarde libera', () => {
  const t = leer('mañana entro a trabajar más temprano, a las 7');
  assert.equal(t.intent, 'except');
  assert.deepEqual(t.exs[0], { date: '2026-10-27', start: '07:00', end: '15:00', label: 'Trabajo (más temprano)' });
  const d = leer('el jueves entro a trabajar a las 5');
  assert.deepEqual(d.exs[0], { date: '2026-10-29', start: '15:00', end: '17:00', label: 'Entrada más tarde', libre: true, ref: 'c1' });
  assert.equal(leer('mañana entro a las 3').intent, 'aviso', 'ya entra a esa hora');
  // «Recién a las 5» con un trabajo de 8 a 13 no tiene una lectura posible: no se adivina.
  const m = estado({ compromisos: [{ id: 'm', name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '08:00', end: '13:00' }] });
  assert.equal(leer('mañana entro a la chamba recién a las 5', m).intent, 'help');
  // Un día sin trabajo no inventa nada.
  assert.equal(leer('el sábado entro a trabajar a las 7').intent, 'help');
});

test('un cambio para siempre de la hora de entrada se hace en la rutina', () => {
  const r = leer('me cambiaron el horario de clases, ahora entro a las 9');
  assert.equal(r.intent, 'aviso');
  assert.match(r.texto, /cámbialo en tus rutinas/);
});
