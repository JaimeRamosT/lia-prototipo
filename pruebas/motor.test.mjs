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

test('dormir después de medianoche no deja el horario vacío', () => {
  const st = estado({
    ajustes: { wake: '06:30', sleep: '00:30' },
    compromisos: [{ name: 'Clases', type: 'clase', days: LUN_A_VIE, start: '08:00', end: '13:00' }, { name: 'Trabajo', days: LUN_A_VIE, start: '15:00', end: '21:00' }],
    evaluaciones: [{ course: 'Cálculo', date: '2026-10-29', hours: 5 }, { course: 'Física', type: 'practica', date: '2026-10-28', time: '07:00', hours: 3 }],
  });
  const p = L.plan(st, ahora());
  assert.equal(faltan(p), 0, JSON.stringify(p.unmet));
  assert.equal(minutos(p), 480);
  assert.ok(p.blocks.some(b => b.e > 1380), 'usa la hora entre las 23:00 y las 00:30');
  assert.ok(p.blocks.every(b => b.e <= 1470), 'nada después de las 00:30');
  assert.ok(Object.values(p.days).every(d => d.free >= 0), 'las horas libres nunca son negativas');
});

test('un turno que cruza la medianoche ocupa la noche y la madrugada siguiente', () => {
  const st = estado({
    compromisos: [{ name: 'Trabajo', days: LUN_A_VIE, start: '18:00', end: '02:00' }],
    evaluaciones: [{ course: 'Cálculo', date: '2026-10-30', hours: 6 }],
  });
  const p = L.plan(st, ahora());
  for (const d of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']) assert.ok(!choca(p.blocks, d, 1080, 1560), 'sin estudio durante el turno del ' + d);
  assert.ok(L.busyFor(st, '2026-10-27').some(b => b.s === 0 && b.e === 120 && b.cola), 'el martes empieza con la cola del turno del lunes');
  assert.ok(L.busyFor(st, '2026-10-31').some(b => b.s === 0 && b.e === 120), 'el turno del viernes termina el sábado');
});

test('quien duerme de día (de 07:00 a 14:00) y trabaja de noche', () => {
  const st = estado({
    ajustes: { wake: '14:00', sleep: '07:00' },
    compromisos: [{ name: 'Turno noche', days: LUN_A_VIE, start: '22:00', end: '06:00' }],
    evaluaciones: [{ course: 'Contabilidad', date: '2026-10-30', time: '16:00', hours: 4 }],
  });
  const p = L.plan(st, ahora(26, 15));
  assert.equal(faltan(p), 0, JSON.stringify(p.unmet));
  for (const b of p.blocks) {
    assert.ok(b.s >= 14 * 60, 'después de despertar');
    assert.ok(!(b.s < 1800 && b.e > 1320), 'no durante el turno: ' + JSON.stringify(b));
  }
});

test('una excepción de noche también ocupa la madrugada del día siguiente', () => {
  const st = estado({ excepciones: [{ id: 'x', date: '2026-10-27', start: '22:00', end: '02:00', label: 'Ocupado' }] });
  assert.ok(L.busyFor(st, '2026-10-27').some(b => b.s === 1320 && b.e === 1560));
  assert.ok(L.busyFor(st, '2026-10-28').some(b => b.s === 0 && b.e === 120 && b.cola));
});

test('antes de un examen, el estudio termina a la hora de dormir de la víspera', () => {
  const st = estado({ ajustes: { sleep: '00:30' }, evaluaciones: [{ course: 'Física', date: '2026-10-28', time: '08:00', hours: 4 }] });
  const p = L.plan(st, ahora());
  assert.ok(p.blocks.every(b => b.date < '2026-10-28'), 'nada el día del examen');
  assert.ok(p.blocks.every(b => b.date !== '2026-10-27' || b.e <= 1470), 'la víspera, hasta las 00:30');
});
