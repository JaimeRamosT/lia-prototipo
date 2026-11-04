// «No pude» con reacomodo (Gratis) y «Tu semana» («Qué sigue», 3-nov, «Hacer ya»).
// Trabajo de lunes a viernes de 15:00 a 19:00; examen de Cálculo el viernes 30 de octubre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const base = () => estado({
  compromisos: [{ name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' }],
  evaluaciones: [{ course: 'Cálculo', date: '2026-10-30', time: '09:00', hours: 5 }],
});
const cruza = (a, b) => a.date === b.date && a.s < b.e + 10 && b.s < a.e + 10;

test('lo que no se pudo estudiar entra en un hueco libre, antes del examen y sin pisar lo armado', () => {
  const s = base(), p = L.plan(s, ahora());
  const f = { blocks: p.blocks, evalIds: ['e0'], unmet: p.unmet, week: '2026-10-26', vistos: [] };
  const perdido = p.blocks[0], luego = new Date(2026, 9, 26, 23, 0);  // ya pasó el primer bloque
  const nuevos = L.reacomodar(s, f, { e0: perdido.e - perdido.s }, luego);
  assert.ok(nuevos.length >= 1, 'hay un bloque nuevo');
  assert.equal(nuevos.reduce((a, b) => a + b.e - b.s, 0), perdido.e - perdido.s, 'el mismo tiempo');
  for (const b of nuevos) {
    assert.equal(b.evalId, 'e0');
    assert.ok(b.date > '2026-10-26' && b.date <= '2026-10-30', `antes del examen: ${b.date}`);
    assert.ok(!f.blocks.filter(x => x !== perdido).some(x => cruza(x, b)), 'no pisa otro bloque');
  }
});

test('sin huecos antes del examen, no inventa bloques', () => {
  const s = base(), p = L.plan(s, ahora()), f = { blocks: p.blocks, evalIds: ['e0'], vistos: [] };
  assert.deepEqual(L.reacomodar(s, f, { e0: 60 }, new Date(2026, 9, 30, 8, 30)), []);
  assert.deepEqual(L.reacomodar(s, f, { e0: 5 }, ahora()), [], 'menos de 10 minutos no se mueve');
});

test('«Tu semana»: lo de esta semana y lo de la anterior', () => {
  const s = estado({
    compromisos: [{ name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' }],
    evaluaciones: [{ course: 'Cálculo', date: '2026-10-30' }, { course: 'Arte', date: '2026-10-21' }, { course: 'Física', date: '2026-11-04' }],
    hechos: [{ id: 'h1', evalId: 'e1', date: '2026-10-20', start: '20:00', min: 90 }, { id: 'h2', evalId: 'e0', date: '2026-10-26', start: '08:00', min: 30 }],
  });
  const r = L.resumenSemana(s, L.plan(s, ahora()), ahora());
  assert.equal(r.lunes, '2026-10-26');
  assert.deepEqual(r.evals.map(e => e.course), ['Cálculo']);
  assert.ok(r.agendado > 0);
  assert.equal(r.hechoPasada, 90);
  assert.equal(r.evalsPasada, 1);
});
