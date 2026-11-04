// Cambios de turno de un solo día (revisión del 3-nov, «Qué sigue», sección 3): el trabajo manda y LIA se adapta.
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00. Trabajo de lunes a viernes de 15:00 a 19:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const base = () => estado({ compromisos: [{ name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' }] });
const leer = (f, s = base()) => L.interpret(f, s, ahora());
const tramos = r => (r.exs || []).map(x => [x.date, x.start, x.end, !!x.libre]);

test('el turno de un día se alarga, sin crear una rutina semanal', () => {
  for (const [f, fecha] of [
    ['el viernes me toca chamba hasta las 10 de la noche', '2026-10-30'],
    ['el jueves trabajo hasta las 10 de la noche', '2026-10-29'],
    ['mañana tengo trabajo hasta las 10', '2026-10-27'],
  ]) {
    const r = leer(f);
    assert.equal(r.intent, 'except', f);
    assert.deepEqual(tramos(r), [[fecha, '19:00', '22:00', false]], f);
    assert.equal(r.ex.label, 'Trabajo (más tarde)', f);
  }
});

test('«hasta tarde» sin hora: Lía pregunta hasta cuándo, desde el fin de siempre', () => {
  const s = base(), r = leer('me pidió quedarme hasta tarde el jueves', s);
  assert.equal(r.intent, 'pregunta');
  assert.equal(r.texto, '¿Hasta qué hora te quedas el jueves? Tu turno termina a las 19:00.');
  assert.deepEqual(r.opciones.map(o => o.t), ['Hasta las 20:00', 'Hasta las 21:00', 'Hasta las 22:00', 'Otra hora']);
  const x = L.respuestaBorrador({ ...r.borrador, at: ahora().getTime() }, 'hasta las 10', s, ahora());
  assert.equal(x.intent, 'except');
  assert.deepEqual([x.ex.date, x.ex.start, x.ex.end, x.ex.label], ['2026-10-29', '19:00', '22:00', 'Trabajo (más tarde)']);
  assert.equal(x.ex.preg, undefined, 'la pregunta no se guarda en el horario');
  assert.match(leer('hoy me quedo hasta tarde en la chamba').texto, /^¿Hasta qué hora te quedas hoy\?/);
});

test('otro turno ese día: se libera el de siempre y se anota el nuevo', () => {
  for (const f of ['mañana tengo chamba de 6 a 11 de la noche, me cambiaron el turno', 'mañana tengo chamba de 6 a 11 de la noche']) {
    const r = leer(f);
    assert.equal(r.intent, 'except', f);
    assert.deepEqual(tramos(r), [['2026-10-27', '15:00', '19:00', true], ['2026-10-27', '18:00', '23:00', false]], f);
    assert.equal(r.exs[0].ref, 'c0');
  }
  // Si cabe dentro del turno de siempre, no hay nada que cambiar.
  assert.equal(leer('mañana tengo chamba de 4 a 6').intent, 'aviso');
});

test('lo que ya funcionaba sigue igual', () => {
  assert.deepEqual(tramos(leer('hoy salgo temprano del trabajo, a las 5')), [['2026-10-26', '17:00', '19:00', true]]);
  assert.deepEqual(tramos(leer('hoy salgo del trabajo a las 9')), [['2026-10-26', '19:00', '21:00', false]]);
  assert.deepEqual(tramos(leer('mañana entro a la chamba recién a las 5')), [['2026-10-27', '15:00', '17:00', true]]);
  // Una hora antes del fin de siempre no se lee como la madrugada siguiente.
  for (const f of ['el viernes trabajo hasta las 5', 'hoy tengo trabajo hasta las 7']) {
    const r = leer(f);
    assert.ok(!(r.exs || []).some(x => x.label === 'Trabajo (más tarde)'), f);
  }
  assert.deepEqual(tramos(leer('mañana tengo chamba hasta las 2 de la madrugada')), [['2026-10-27', '19:00', '02:00', false]]);
  // «Hasta tarde» sin hablar del trabajo no toca el turno.
  for (const f of ['el jueves me quedo hasta tarde estudiando', 'mañana me quedo hasta tarde en la u', 'el sábado salgo hasta tarde con mis amigos'])
    assert.ok(!/Tu turno/.test(leer(f).texto || ''), f);
  // «Desde mañana…» es un cambio para siempre: no se anota como de un día.
  assert.notEqual(leer('desde mañana me cambiaron el turno, trabajo de 8 a 4').intent, 'except');
  // Un turno distinto que se cruza con el de siempre lo reemplaza ese día (decisión: es un cambio de turno).
  assert.deepEqual(tramos(leer('mañana tengo chamba de 2 a 4')), [['2026-10-27', '15:00', '19:00', true], ['2026-10-27', '14:00', '16:00', false]]);
  // Sin trabajo ese día o con varios días, no se alarga nada: son rutinas.
  for (const f of ['el sábado trabajo hasta las 4', 'trabajo de lunes a viernes hasta las 10', 'el lunes y el martes me toca chamba hasta las 10'])
    assert.notEqual(leer(f).intent, 'except', f);
});

test('«práctica de fútbol» es deporte, no una práctica calificada', () => {
  const r = leer('toda la tarde del viernes tengo práctica de fútbol');
  assert.notEqual(r.intent, 'pregunta');
  assert.equal((r.items || [])[0]?.type, 'deporte');
  assert.equal(r.items[0].name, 'Práctica de fútbol');
  assert.equal(leer('entrenamiento de vóley el sábado de 9 a 11').items[0].type, 'deporte');
  // Las prácticas calificadas siguen siendo evaluaciones.
  assert.equal(leer('pc de química el jueves a las 7').items[0].kind, 'eval');
  assert.equal(leer('práctica calificada de termodinámica el martes a las 8 de la noche').items[0].type, 'practica');
});
