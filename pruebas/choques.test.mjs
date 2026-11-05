// Duplicados y cruces antes de guardar (iteración 3, docs/iteracion-3.md §5): choques() revisa una rutina, un evento de
// un día o una evaluación contra lo que ya hay, y textoChoques() dice qué pasa en una línea. El estudio no cuenta.
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const conTrabajo = (extra = {}) => estado({
  compromisos: [
    { id: 'tr', name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '09:00', end: '18:00' },
    { id: 'al', name: 'Almuerzo', type: 'comida', days: LUN_A_VIE, start: '13:00', end: '14:30' },
  ],
  ...extra,
});
const rutina = (name, days, start, end) => ({ kind: 'commit', name, days, start, end });
const evento = (label, date, start, end) => ({ kind: 'evento', label, date, start, end });
const evalua = (course, date, time, type = 'parcial') => ({ kind: 'eval', type, course, date, time });

test('una rutina igual (nombre sin tildes ni mayúsculas, mismo día y mismas horas) es un duplicado', () => {
  const r = L.choques(conTrabajo(), rutina('almuerzo', [1], '13:00', '14:30'), ahora());
  assert.equal(r.duplicado && r.duplicado.ref, 'al');
  assert.equal(L.textoChoques(r), 'Ya tienes «Almuerzo» el lunes de 13:00 a 14:30.');
  assert.ok(!r.cruces.some(c => c.ref === 'al'), 'el duplicado no se cuenta otra vez como cruce');
});

test('de lunes a viernes, el duplicado lo dice así', () => {
  const r = L.choques(conTrabajo(), rutina('Almuerzo', LUN_A_VIE, '13:00', '14:30'), ahora());
  assert.equal(L.textoChoques(r), 'Ya tienes «Almuerzo» de lunes a viernes de 13:00 a 14:30.');
});

test('el mismo nombre con otras horas no es duplicado: es un cruce', () => {
  const r = L.choques(conTrabajo(), rutina('Almuerzo', [1], '13:30', '15:00'), ahora());
  assert.equal(r.duplicado, null);
  assert.deepEqual(r.cruces.map(c => c.ref).sort(), ['al', 'tr']);
});

test('un evento de un día a la hora del trabajo se cruza con el trabajo', () => {
  const r = L.choques(conTrabajo(), evento('Cita médica', '2026-11-02', '10:00', '11:00'), ahora());
  assert.equal(r.duplicado, null);
  assert.deepEqual(r.cruces.map(c => c.ref), ['tr']);
  assert.equal(L.textoChoques(r), 'Se cruza con «Trabajo» (lunes, 9:00–18:00).');
});

test('con dos cruces los nombra a los dos; con más, dice cuántos más', () => {
  const st = conTrabajo({ excepciones: [{ id: 'x1', date: '2026-11-02', start: '13:00', end: '15:00', label: 'Reunión', cat: 'trabajo' }] });
  const dos = L.choques(conTrabajo(), evento('Trámite', '2026-11-02', '12:00', '14:00'), ahora());
  assert.equal(L.textoChoques(dos), 'Se cruza con «Trabajo» (lunes, 9:00–18:00) y con «Almuerzo» (lunes, 13:00–14:30).');
  const tres = L.choques(st, evento('Trámite', '2026-11-02', '12:00', '14:00'), ahora());
  assert.equal(tres.cruces.length, 3);
  assert.equal(L.textoChoques(tres), 'Se cruza con «Trabajo» (lunes, 9:00–18:00), «Almuerzo» (lunes, 13:00–14:30) y 1 más.');
});

test('el estudio no cuenta como cruce', () => {
  const st = estado({ evaluaciones: [{ course: 'Cálculo', date: '2026-10-30', time: '09:00', hours: 5 }] });
  const p = L.plan(st, ahora());
  assert.ok(p.blocks.length, 'hay bloques de estudio');
  const b = p.blocks[0];
  const r = L.choques(st, evento('Cumpleaños de Ana', b.date, L.fmt(b.s), L.fmt(b.e)), ahora());
  assert.deepEqual(r, { duplicado: null, cruces: [] });
  assert.equal(L.textoChoques(r), '');
});

test('lo que se está editando no choca consigo mismo', () => {
  const r = L.choques(conTrabajo(), rutina('Trabajo', LUN_A_VIE, '09:00', '18:00'), ahora(), ['tr']);
  assert.equal(r.duplicado, null);
  assert.deepEqual(r.cruces.map(c => c.ref), ['al']);
});

test('una evaluación igual (mismo curso, día y hora) es un duplicado, aunque cambie el tipo', () => {
  const st = estado({ evaluaciones: [{ id: 'e0', course: 'Cálculo I', type: 'parcial', date: '2026-11-02', time: '10:00' }] });
  const r = L.choques(st, evalua('calculo i', '2026-11-02', '10:00', 'examen'), ahora());
  assert.equal(r.duplicado && r.duplicado.ref, 'e0');
  assert.equal(L.textoChoques(r), 'Ya tienes «Parcial de Cálculo I» el lunes 2 de noviembre a las 10:00.');
});

test('una evaluación en horas de clase no avisa (los exámenes suelen ser en clase); con el trabajo u otra evaluación, sí', () => {
  const st = estado({
    compromisos: [
      { id: 'cl', name: 'Cálculo I', type: 'clase', days: [1, 3, 5], start: '08:00', end: '10:00' },
      { id: 'tr', name: 'Trabajo', type: 'trabajo', days: [1], start: '10:00', end: '18:00' },
    ],
    excepciones: [{ id: 'x1', date: '2026-11-02', start: '08:00', end: '09:30', label: 'Clase de recuperación', cat: 'clase' }],
    evaluaciones: [{ id: 'e0', course: 'Física', type: 'practica', date: '2026-11-02', time: '10:30' }],
  });
  const r = L.choques(st, evalua('Cálculo I', '2026-11-02', '09:00'), ahora());
  assert.deepEqual(r.cruces.map(c => c.ref), ['tr', 'e0']);
  assert.equal(L.textoChoques(r), 'Se cruza con «Trabajo» (lunes, 10:00–18:00) y con «Práctica de Física» (lunes 2 de noviembre, 10:30–12:30).');
  // Al revés, una clase nueva tampoco avisa por la evaluación que cae en su horario.
  assert.deepEqual(L.choques(st, { ...rutina('Física', [1], '10:00', '12:00'), type: 'clase' }, ahora()).cruces.map(c => c.ref), ['tr']);
  assert.deepEqual(L.choques(st, { ...evento('Repaso', '2026-11-02', '10:00', '12:00'), cat: 'clase' }, ahora()).cruces.map(c => c.ref), ['tr']);
  // Pero un examen de otro curso encima de la clase de Cálculo sí es un cruce (revisión ux del 4-nov).
  assert.deepEqual(L.choques(st, evalua('Química', '2026-11-02', '08:30'), ahora()).cruces.map(c => c.ref), ['cl', 'tr']);
  // Una rutina «Clases» no dice de qué curso es: no avisa (el registro de siempre: clases de 8 a 1 y examen a las 10).
  const st2 = estado({ compromisos: [{ id: 'cg', name: 'Clases', type: 'clase', days: [1, 3, 5], start: '08:00', end: '13:00' }] });
  assert.deepEqual(L.choques(st2, evalua('Cálculo', '2026-11-02', '10:00'), ahora()).cruces, []);
  // Y una clase nueva de otro curso encima de un examen, también.
  assert.deepEqual(L.choques(st, { ...rutina('Inglés', [1], '10:00', '12:00'), type: 'clase' }, ahora()).cruces.map(c => c.ref), ['tr', 'e0']);
});

test('lo liberado ese día no cuenta: sin trabajo, la cita no se cruza', () => {
  const st = conTrabajo({ excepciones: [{ id: 'l1', date: '2026-11-02', start: '09:00', end: '18:00', label: 'Sin Trabajo', libre: true, ref: 'tr' }] });
  const r = L.choques(st, evento('Cita médica', '2026-11-02', '10:00', '11:00'), ahora());
  assert.deepEqual(r.cruces.map(c => c.ref), []);
});

test('un turno que pasa la medianoche se cruza con lo de temprano al día siguiente, y se nombra por el día en que empieza', () => {
  const st = estado({ compromisos: [{ id: 'tn', name: 'Turno noche', type: 'trabajo', days: [1], start: '22:00', end: '06:00' }] });
  const r = L.choques(st, evento('Trámite', '2026-11-03', '05:00', '07:00'), ahora());   // martes
  assert.deepEqual(r.cruces.map(c => c.ref), ['tn']);
  assert.equal(L.textoChoques(r), 'Se cruza con «Turno noche» (lunes, 22:00–6:00).');
  const r2 = L.choques(st, rutina('Gimnasio', [2], '05:30', '06:30'), ahora());
  assert.deepEqual(r2.cruces.map(c => c.ref), ['tn']);
});

test('una rutina nueva se cruza con un evento de un día y con una evaluación que vienen, no con los que ya pasaron', () => {
  const st = estado({
    excepciones: [
      { id: 'x1', date: '2026-10-31', start: '19:00', end: '23:00', label: 'Cumpleaños de Ana', cat: 'ocio' },
      { id: 'x0', date: '2026-10-24', start: '19:00', end: '23:00', label: 'Fiesta', cat: 'ocio' },
    ],
    evaluaciones: [{ id: 'e0', course: 'Química', type: 'parcial', date: '2026-11-07', time: '18:00' }],
  });
  const r = L.choques(st, rutina('Gimnasio', [6], '18:00', '20:00'), ahora());
  assert.deepEqual(r.cruces.map(c => c.ref), ['x1', 'e0']);
  assert.equal(L.textoChoques(r), 'Se cruza con «Cumpleaños de Ana» (sábado 31 de octubre, 19:00–23:00) y con «Parcial de Química» (sábado 7 de noviembre, 18:00–20:00).');
});

test('una rutina de Google Calendar que ya terminó no cuenta', () => {
  const st = estado({ compromisos: [{ id: 'g', name: 'Inglés', type: 'curso', days: [1], start: '18:00', end: '20:00', hasta: '2026-10-19', gcal: 'r1' }] });
  assert.deepEqual(L.choques(st, rutina('Gimnasio', [1], '19:00', '20:00'), ahora()).cruces, []);
});

test('un evento igual a una rutina ese día es un duplicado', () => {
  const r = L.choques(conTrabajo(), evento('Almuerzo', '2026-11-02', '13:00', '14:30'), ahora());
  assert.equal(r.duplicado && r.duplicado.ref, 'al');
  assert.equal(L.textoChoques(r), 'Ya tienes «Almuerzo» el lunes de 13:00 a 14:30.');
});

test('dos eventos de un día iguales son un duplicado', () => {
  const st = estado({ excepciones: [{ id: 'x1', date: '2026-10-31', start: '19:00', end: '23:00', label: 'Cumpleaños de Ana', cat: 'ocio' }] });
  const r = L.choques(st, evento('cumpleaños de ana', '2026-10-31', '19:00', '23:00'), ahora());
  assert.equal(r.duplicado && r.duplicado.ref, 'x1');
  assert.equal(L.textoChoques(r), 'Ya tienes «Cumpleaños de Ana» el sábado 31 de octubre de 19:00 a 23:00.');
});

test('algo sin horas válidas no choca con nada', () => {
  assert.deepEqual(L.choques(conTrabajo(), rutina('X', [1], '10:00', '10:00'), ahora()), { duplicado: null, cruces: [] });
  assert.deepEqual(L.choques(conTrabajo(), rutina('X', [], '10:00', '11:00'), ahora()), { duplicado: null, cruces: [] });
  assert.deepEqual(L.choques(conTrabajo(), { kind: 'eval', course: 'X', date: 'mañana', time: '10:00' }, ahora()), { duplicado: null, cruces: [] });
  assert.deepEqual(L.choques(conTrabajo(), null, ahora()), { duplicado: null, cruces: [] });
});

test('choquesTramos revisa cada horario de una rutina y junta los días del mismo cruce', () => {
  const st = conTrabajo();
  const r = L.choquesTramos(st, { name: 'Inglés', tramos: [{ days: [1], start: '08:00', end: '10:00' }, { days: [3], start: '17:00', end: '19:00' }] }, ahora());
  assert.deepEqual(r.cruces.map(c => c.ref), ['tr']);
  assert.equal(L.textoChoques(r), 'Se cruza con «Trabajo» (lunes y miércoles, 9:00–18:00).');
  const d = L.choquesTramos(st, { name: 'Almuerzo', tramos: [{ days: [6], start: '13:00', end: '14:30' }, { days: [2], start: '13:00', end: '14:30' }] }, ahora());
  assert.equal(L.textoChoques(d), 'Ya tienes «Almuerzo» el martes de 13:00 a 14:30.');
});

test('cursosClase da los cursos que ya existen, sin repetir y sin el nombre genérico; claseDeEval los liga por nombre', () => {
  const st = estado({
    compromisos: [
      { id: 'a', grupo: 'g', name: 'Cálculo I', type: 'clase', days: [1], start: '08:00', end: '10:00' },
      { id: 'b', grupo: 'g', name: 'Cálculo I', type: 'clase', days: [3], start: '08:00', end: '10:00' },
      { id: 'c', name: 'Clases', type: 'clase', days: [2], start: '08:00', end: '12:00' },
      { id: 'd', name: 'Física General', type: 'clase', days: [4], start: '08:00', end: '10:00' },
      { id: 'e', name: 'Trabajo', type: 'trabajo', days: [1], start: '14:00', end: '18:00' },
    ],
  });
  assert.deepEqual(L.cursosClase(st), ['Cálculo I', 'Física General']);
  assert.equal(L.claseDeEval(st, { course: 'calculo i' }).id, 'a');
  assert.equal(L.claseDeEval(st, { course: 'Química' }), null);
  assert.equal(L.claseDeEval(st, { course: 'Clases' }), null);
});
