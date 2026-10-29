// Fechas con día de la semana y número («el lunes 9»): el número dice qué semana es.
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const evaluacion = frase => {
  const r = L.interpret(frase, estado(), ahora());
  assert.equal(r.intent, 'add', `«${frase}» no se leyó como evaluación`);
  return r.items[0];
};

// [frase, fecha, hora]
const FECHAS = [
  ['examen de cálculo el lunes 9 a las 10', '2026-11-09', '10:00'],
  ['parcial de física el martes 3 a las 8 de la noche', '2026-11-03', '20:00'],
  ['parcial de física el viernes 30 a las 6 de la tarde', '2026-10-30', '18:00'],
  ['examen de inglés el sábado 7 a las 9', '2026-11-07', '09:00'],
  ['control de química el lunes 26 a las 8 de la noche', '2026-10-26', '20:00'],   // hoy
  ['final de estadística el miércoles 2 de diciembre a las 8', '2026-12-02', '08:00'],
];
for (const [frase, fecha, hora] of FECHAS) {
  test(`fecha: «${frase}» → ${fecha} ${hora}`, () => {
    const it = evaluacion(frase);
    assert.equal(it.date, fecha);
    assert.equal(it.time, hora);
  });
}

test('sin número, el día de la semana sigue siendo el próximo', () => {
  assert.equal(evaluacion('examen de química el lunes a las 9').date, '2026-11-02');
  assert.equal(evaluacion('examen de química el próximo lunes a las 9').date, '2026-11-02');
});

test('si el número y el día no coinciden, manda el número (la propuesta muestra el día)', () => {
  // El 10 de noviembre de 2026 es martes.
  assert.equal(evaluacion('examen de química el lunes 10 a las 9').date, '2026-11-10');
});

test('un número que es hora no se toma como fecha', () => {
  // «10 de la noche» es una hora: el cumpleaños es este viernes 30, no el 10 de noviembre.
  const r = L.interpret('el viernes 10 de la noche tengo un cumpleaños', estado(), ahora());
  assert.equal(r.intent, 'except');
  assert.equal(r.ex.date, '2026-10-30');
  // «Lunes 8 a 1» y «lunes 9:30» son horas: la fecha es el próximo lunes.
  assert.equal(L.parseDate('el lunes 8 a 1 tengo un taller', ahora()), '2026-11-02');
  assert.equal(L.parseDate('el lunes 9:30 tengo una cita', ahora()), '2026-11-02');
  assert.equal(L.parseDate('el lunes 9 am tengo una cita', ahora()), '2026-11-02');
});

test('«el lunes 9 no tengo clases» libera el lunes 9, no el próximo', () => {
  const s = estado({ compromisos: [{ name: 'Clases', type: 'clase', days: LUN_A_VIE, start: '08:00', end: '13:00' }] });
  const r = L.interpret('el lunes 9 no tengo clases', s, ahora());
  assert.equal(r.intent, 'except');
  assert.equal(r.ex.date, '2026-11-09');
});

test('«práctica calificada de termodinámica»: el curso es Termodinámica', () => {
  const it = evaluacion('práctica calificada de termodinámica el martes 3 a las 8 de la noche');
  assert.deepEqual([it.type, it.course, it.date, it.time], ['practica', 'Termodinámica', '2026-11-03', '20:00']);
});

test('«práctica calificada» sin curso: Lía pregunta el curso', () => {
  const r = L.interpret('tengo práctica calificada el jueves a las 7', estado(), ahora());
  assert.equal(r.intent, 'pregunta');
  assert.equal(L.faltaDe(r.borrador.items[0]), 'curso');
});
