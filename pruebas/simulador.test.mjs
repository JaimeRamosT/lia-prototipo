// Simulador «¿y si…?» («Qué sigue», 3-nov): Lía prueba un cambio sobre una copia, sin tocar el horario.
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00. Trabajo de lunes a viernes de 15:00 a 19:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const base = () => estado({
  compromisos: [{ name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' }],
  evaluaciones: [{ course: 'Cálculo', date: '2026-10-29', hours: 8 }, { course: 'Física', date: '2026-11-05' }],
});

test('«¿y si…?» se simula; sin el «y si» se anota como siempre', () => {
  const s = base();
  for (const [f, intent] of [
    ['¿y si trabajo el sábado de 8 a 4?', 'add'],
    ['¿qué pasa si me quedo hasta las 11 de la noche el martes en la chamba?', 'except'],
    ['y si mañana no voy a trabajar', 'except'],
    ['¿qué pasaría si el jueves tengo examen de química a las 9?', 'add'],
  ]) {
    const r = L.interpret(f, s, ahora());
    assert.equal(r.intent, 'simula', f);
    assert.equal(r.base.intent, intent, f);
  }
  assert.equal(L.interpret('trabajo el sábado de 8 a 4', s, ahora()).intent, 'add');
  // «Pero si mañana no trabajo» corrige: se anota como siempre.
  assert.equal(L.interpret('pero si mañana no trabajo', s, ahora()).intent, 'except');
  // Un «sí» suelto es una respuesta, no un «¿y si…?».
  assert.equal(L.sinYSi('si'), null);
  assert.equal(L.sinYSi('si, a las 9'), null);
  // Sin día u horario, Lía pide lo que falta para probarlo.
  assert.match(L.interpret('y si tengo clase', s, ahora()).texto, /dime el día y el horario/);
});

test('simular no toca el horario y compara lo que falta por evaluación', () => {
  const s = base(), antes = JSON.stringify(s);
  const r = L.interpret('¿y si el miércoles tengo examen de química a las 9?', s, ahora());
  const x = L.simular(s, r.base, ahora());
  assert.equal(JSON.stringify(s), antes, 'el estado no cambia');
  assert.deepEqual(x.peor.map(y => [y.e.course, y.nueva]), [['Cálculo', false], ['Química', true]]);
  assert.ok(x.peor[0].despues > x.peor[0].antes, 'a Cálculo le falta más');
  assert.ok(x.semanaDespues > x.semanaAntes, 'hay más estudio esta semana');
});

test('liberar el trabajo de un día no empeora nada', () => {
  const s = base(), r = L.interpret('y si mañana no voy a trabajar', s, ahora()), x = L.simular(s, r.base, ahora());
  assert.deepEqual(x.peor, []);
  assert.ok(x.mejor.length || x.mueve > 0, 'el estudio se reacomoda o alcanza mejor');
});
