// Lectura de frases: interpret() convierte lo que escribe la persona en horarios, evaluaciones o cambios del día.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora } from './logica.mjs';

// Horarios fijos: [frase, inicio, fin, días]
const HORARIOS = [
  ['trabajo de lunes a viernes de 10 de la noche a 6 de la mañana', '22:00', '06:00', [1, 2, 3, 4, 5]],
  ['trabajo de 10pm a 6am de lunes a viernes', '22:00', '06:00'],
  ['trabajo de lunes a viernes de 22 a 6', '22:00', '06:00'],
  ['clases los martes y jueves de 6:30 a 10:30 pm', '18:30', '22:30', [2, 4]],
  ['voy al gym lunes miércoles y viernes de 5 a 7 am', '05:00', '07:00', [1, 3, 5]],
  ['trabajo de 9 a 6 de lunes a viernes', '09:00', '18:00'],
  ['trabajo de lunes a viernes de 3 a 9 de la noche', '15:00', '21:00'],
  ['tengo clases lunes miércoles y viernes de 7 a 10 de la noche', '19:00', '22:00'],
  ['trabajo los sábados de 6 a 2', '06:00', '14:00', [6]],
  ['clases de lunes a viernes de 8 a 1', '08:00', '13:00'],
  ['trabajo de lunes a viernes de 4 a 12', '16:00', '00:00'],
  ['trabajo de 8am a 5pm de lunes a sábado', '08:00', '17:00', [1, 2, 3, 4, 5, 6]],
  ['turno de 6 a 8 de la mañana los domingos', '06:00', '08:00', [0]],
  ['trabajo de lunes a viernes de 3 a 7', '15:00', '19:00'],
];
for (const [frase, ini, fin, dias] of HORARIOS) {
  test(`horario: «${frase}» → ${ini}–${fin}`, () => {
    const r = L.interpret(frase, estado(), ahora());
    assert.equal(r.intent, 'add');
    const it = r.items[0];
    assert.equal(it.error, undefined, it.error);
    assert.equal(it.kind, 'commit');
    assert.equal(it.start, ini);
    assert.equal(it.end, fin);
    if (dias) assert.deepEqual(it.days, dias);
  });
}

test('una excepción de noche guarda el fin al día siguiente', () => {
  const r = L.interpret('hoy no puedo de 10 de la noche a 2 de la madrugada', estado(), ahora());
  assert.equal(r.intent, 'except');
  assert.equal(r.ex.start, '22:00');
  assert.equal(r.ex.end, '02:00');
});

test('«libera mi sábado» con hora de dormir 00:30 bloquea hasta las 00:30', () => {
  const r = L.interpret('libera mi sábado', estado({ ajustes: { sleep: '00:30' } }), ahora());
  assert.equal(r.intent, 'except');
  assert.equal(r.ex.date, '2026-10-31');
  assert.equal(r.ex.start, '07:00');
  assert.equal(r.ex.end, '00:30');
});

test('evaluación a las 7 de la noche', () => {
  const r = L.interpret('pc2 de Física el miércoles a las 7 de la noche', estado(), ahora());
  assert.equal(r.items[0].time, '19:00');
  assert.equal(r.items[0].date, '2026-10-28');
});
