// LIA → Google Calendar (docs/calendario.md): además del estudio y las evaluaciones, el enlace iCal lleva los eventos
// de un día y las rutinas de los próximos 14 días si la persona lo eligió (settings.calTodo). Nunca lo que vino de Google.
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora } from './logica.mjs';

const vacio = { blocks: [] };
const todo = { calTodo: true };
const de = (ev, t) => ev.filter(e => e.titulo === t).map(e => [e.inicio.slice(0, 16), e.fin.slice(11, 16), e.tipo]);

test('eventos de un día con su nombre; los «No disponible» de mover un bloque no', () => {
  const s = estado({ excepciones: [
    { id: 'x1', date: '2026-10-28', start: '16:00', end: '17:00', label: 'Cita con el dentista', cat: 'otro' },
    { id: 'x2', date: '2026-10-30', start: '22:00', end: '06:00', label: 'Turno extra', cat: 'trabajo' },
    { id: 'x3', date: '2026-10-27', start: '19:00', end: '20:00', label: 'No disponible' },
    { id: 'x4', date: '2026-10-29', start: '08:00', end: '10:00', label: 'Clase de recuperación', cat: 'clase' },
    { id: 'x5', date: '2026-11-20', start: '08:00', end: '10:00', label: 'Muy lejos', cat: 'otro' },
    { id: 'x6', date: '2026-10-20', start: '08:00', end: '10:00', label: 'Ya pasó', cat: 'otro' },
  ], ajustes: todo });
  const ev = L.eventosCanales(s, vacio, ahora());
  assert.deepEqual(de(ev, 'Cita con el dentista'), [['2026-10-28T16:00', '17:00', 'otro']]);
  assert.deepEqual(ev.find(e => e.titulo === 'Turno extra').fin, '2026-10-31T06:00:00-05:00', 'pasa la medianoche');
  assert.deepEqual(de(ev, 'Clase de recuperación'), [['2026-10-29T08:00', '10:00', 'clase']]);
  for (const t of ['No disponible', 'Muy lejos', 'Ya pasó']) assert.ok(!ev.some(e => e.titulo === t), t);
});

test('rutinas de los próximos 14 días, sin las horas que se liberaron ese día', () => {
  const s = estado({ compromisos: [
    { id: 'c1', name: 'Cálculo II', type: 'clase', days: [1, 3], start: '08:00', end: '10:00' },
    { id: 'c2', name: 'Trabajo', type: 'trabajo', days: [1, 2, 3, 4, 5], start: '15:00', end: '19:00' },
  ], excepciones: [
    { date: '2026-10-28', start: '08:00', end: '10:00', label: 'Sin clases', libre: true, ref: 'c1' },
    { date: '2026-10-27', start: '15:00', end: '17:00', label: 'Entrada más tarde', libre: true, ref: 'c2' },
  ], ajustes: todo });
  const ev = L.eventosCanales(s, vacio, ahora());
  assert.deepEqual(de(ev, 'Cálculo II').map(x => x[0].slice(0, 10)), ['2026-10-26', '2026-11-02', '2026-11-04', '2026-11-09'], 'el 28 no hay clase');
  assert.ok(de(ev, 'Cálculo II').every(x => x[2] === 'clase'));
  assert.deepEqual(de(ev, 'Trabajo').find(x => x[0].startsWith('2026-10-27')), ['2026-10-27T17:00', '19:00', 'otro']);
  assert.equal(de(ev, 'Trabajo').length, 11, 'de lunes a viernes, del 26-oct al 9-nov');
  // Si la persona lo apaga, no van.
  s.settings.calTodo = false;
  assert.deepEqual(L.eventosCanales(s, vacio, ahora()), []);
});

test('quien activó un canal antes de esta versión no publica eventos ni rutinas hasta que lo elija', () => {
  const s = estado({ compromisos: [{ id: 'c1', name: 'Trabajo', type: 'trabajo', days: [1, 2, 3, 4, 5], start: '15:00', end: '19:00' }],
    excepciones: [{ id: 'x1', date: '2026-10-28', start: '16:00', end: '17:00', label: 'Cita con el dentista', cat: 'otro' }] });
  assert.deepEqual(L.eventosCanales(s, vacio, ahora()), []);
});

test('una rutina con fecha de fin no se publica después; con más de 300, se recortan primero las rutinas', () => {
  const s = estado({ compromisos: [{ id: 'c1', name: 'Taller', type: 'curso', days: [1, 2, 3, 4, 5], start: '18:00', end: '19:00', hasta: '2026-10-28' }], ajustes: todo });
  assert.deepEqual(de(L.eventosCanales(s, vacio, ahora()), 'Taller').map(x => x[0].slice(0, 10)), ['2026-10-26', '2026-10-27', '2026-10-28']);
  // 24 rutinas diarias (24 × 15 = 360) y una evaluación al final de la ventana.
  const muchas = estado({ compromisos: Array.from({ length: 24 }, (_, i) => ({ id: 'r' + i, name: 'R' + i, type: 'otro', days: [0, 1, 2, 3, 4, 5, 6], start: `${String(i).padStart(2, '0')}:00`, end: `${String(i).padStart(2, '0')}:30` })),
    evaluaciones: [{ id: 'e1', type: 'final', course: 'Química', date: '2026-11-09', time: '20:00', hours: 3 }], ajustes: todo });
  const ev = L.eventosCanales(muchas, { blocks: [{ date: '2026-11-08', s: 600, e: 660, evalId: 'e1' }] }, ahora());
  assert.equal(ev.length, 300);
  assert.ok(ev.some(e => e.titulo === 'Final de Química') && ev.some(e => e.titulo === 'Estudiar Química'), 'estudio y evaluaciones primero');
});

test('nada que vino de Google Calendar (evita duplicados); sí el estudio para esas evaluaciones', () => {
  const s = estado({ compromisos: [{ id: 'c1', name: 'Cálculo II', type: 'otro', days: [1, 3], start: '08:00', end: '10:00', gcal: 'r:calculo@google.com', gh: 'x' }],
    evaluaciones: [{ id: 'e1', type: 'parcial', course: 'Física 1', date: '2026-11-05', time: '09:00', hours: 3, gcal: 'v:fisica@google.com', gh: 'x' }],
    excepciones: [{ id: 'x1', date: '2026-10-28', start: '16:00', end: '17:00', label: 'Cita con el dentista', cat: 'otro', gcal: 'e:dentista@google.com', gh: 'x' }], ajustes: todo });
  const ev = L.eventosCanales(s, { blocks: [{ date: '2026-10-27', s: 19 * 60, e: 21 * 60, evalId: 'e1' }] }, ahora());
  assert.deepEqual(ev.map(e => e.titulo), ['Estudiar Física 1']);
});
