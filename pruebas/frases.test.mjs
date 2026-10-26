// Lectura de frases: interpret() convierte lo que escribe la persona en horarios, evaluaciones o cambios del día.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora } from './logica.mjs';

// Horarios fijos: [frase, inicio, fin, días]
const HORARIOS = [
  ['clases los martes y jueves de 6:30 a 10:30 pm', '18:30', '22:30', [2, 4]],
  ['trabajo de 9 a 6 de lunes a viernes', '09:00', '18:00'],
  ['trabajo de lunes a viernes de 3 a 9 de la noche', '15:00', '21:00'],
  ['tengo clases lunes miércoles y viernes de 7 a 10 de la noche', '19:00', '22:00'],
  ['clases de lunes a viernes de 8 a 1', '08:00', '13:00'],
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

test('evaluación a las 7 de la noche', () => {
  const r = L.interpret('pc2 de Física el miércoles a las 7 de la noche', estado(), ahora());
  assert.equal(r.items[0].time, '19:00');
  assert.equal(r.items[0].date, '2026-10-28');
});
