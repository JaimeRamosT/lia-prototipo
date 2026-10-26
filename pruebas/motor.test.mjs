// Motor de horarios: plan() reparte el estudio en las horas libres reales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE, minutos, faltan, choca } from './logica.mjs';

test('reparte todas las horas cuando hay tiempo y respeta clases y trabajo', () => {
  const st = estado({
    compromisos: [{ name: 'Clases', type: 'clase', days: LUN_A_VIE, start: '08:00', end: '13:00' }, { name: 'Trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' }],
    evaluaciones: [{ course: 'Cálculo', date: '2026-10-29', hours: 5 }],
  });
  const p = L.plan(st, ahora());
  assert.equal(faltan(p), 0);
  assert.equal(minutos(p), 300);
  for (const d of ['2026-10-26', '2026-10-27', '2026-10-28']) {
    assert.ok(!choca(p.blocks, d, 480, 780), 'sin estudio en clases el ' + d);
    assert.ok(!choca(p.blocks, d, 900, 1140), 'sin estudio en el trabajo el ' + d);
  }
  assert.ok(p.blocks.every(b => b.e <= 1380), 'nada después de la hora de dormir');
});
