// Preguntas por la agenda que Lía no entendía: «recuérdame si tengo algo mañana», «y para el domingo tengo algo».
// Pedido de Coconut el 29-oct. Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const base = () => estado({ compromisos: [{ name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '08:00', end: '13:00' }] });
const leer = f => L.interpret(f, base(), ahora());

test('preguntas por si hay algo un día', () => {
  for (const [f, fecha] of [
    ['recuerdame si tengo algo mañana', '2026-10-27'],
    ['recuérdame si tengo algo mañana', '2026-10-27'],
    ['y para el domingo tengo algo', '2026-11-01'],
    ['¿tengo algo el domingo?', '2026-11-01'],
    ['hay algo para mañana', '2026-10-27'],
    ['que hay para el sábado', '2026-10-31'],
    ['tengo algo que hacer hoy', '2026-10-26'],
    ['¿tengo algo en 2 semanas?', '2026-11-09'],
    ['¿estoy ocupado el sábado?', '2026-10-31'],
    ['¿tengo clase el viernes?', '2026-10-30'],
    ['tengo trabajo mañana?', '2026-10-27'],
    ['¿y para el domingo?', '2026-11-01'],
    ['¿y mañana?', '2026-10-27'],
  ]) assert.deepEqual(leer(f), { intent: 'agenda', date: fecha }, f);
});

test('contar algo no es preguntar', () => {
  // Sin signo de pregunta, «estoy ocupado el sábado» marca el día.
  assert.equal(leer('estoy ocupado el sábado').intent, 'except');
  // «Recuérdame que tengo…» anota lo nuevo, como antes de esta regla debía.
  const ex = leer('recuérdame que tengo examen de cálculo el viernes a las 9');
  assert.equal(ex.intent, 'add');
  assert.deepEqual([ex.items[0].course, ex.items[0].date, ex.items[0].time], ['Cálculo', '2026-10-30', '09:00']);
  assert.equal(leer('recuerdame que mañana tengo clase a las 4pm').intent, 'pregunta');
  assert.equal(leer('tengo clase mañana a las 4').intent, 'pregunta');
  // Con hora y sin pregunta, «tengo algo» cuenta algo: no muestra la agenda.
  assert.notEqual(leer('mañana tengo algo de 3 a 5').intent, 'agenda');
  // Una semana entera no es un día.
  assert.notEqual(leer('tengo algo pendiente esta semana').intent, 'agenda');
});

test('las preguntas de siempre siguen igual', () => {
  for (const [f, fecha] of [['que tengo mañana', '2026-10-27'], ['¿qué tengo de trabajo mañana?', '2026-10-27'], ['que me toca hoy', '2026-10-26'], ['¿estoy libre el domingo?', '2026-11-01']])
    assert.deepEqual(leer(f), { intent: 'agenda', date: fecha }, f);
});
