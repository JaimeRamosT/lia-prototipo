// Contador de amanecidas («Qué sigue», 3-nov): noches con estudio y cuántas pasaron la medianoche.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora } from './logica.mjs';

const h = (id, date, start, min) => ({ id, evalId: 'e0', date, start, min });

test('el estudio de madrugada cuenta como amanecida de la noche anterior', () => {
  const s = estado({ evaluaciones: [{ course: 'Cálculo', date: '2026-11-02' }], hechos: [
    h('a', '2026-10-26', '20:00', 60),   // lunes, antes de medianoche
    h('b', '2026-10-27', '23:30', 60),   // martes, termina 00:30: amanecida
    h('c', '2026-10-29', '01:00', 45),   // madrugada del jueves: noche del miércoles
    h('d', '2026-10-29', '19:00', 30),   // jueves, normal
  ] });
  const a = L.nochesDeEstudio(s, { blocks: [] }, '2026-10-26', '2026-11-01');
  assert.deepEqual([a.noches, a.tarde, a.salvadas], [4, 2, 2]);
  assert.deepEqual(a.diasTarde, ['2026-10-27', '2026-10-28']);
});

test('el plan marca el riesgo si un bloque termina después de medianoche', () => {
  const s = estado({ ajustes: { sleep: '01:00' }, evaluaciones: [{ course: 'Cálculo', date: '2026-10-28', hours: 12 }] });
  const p = L.plan(s, ahora()), r = L.nochesDeEstudio(s, p, '2026-10-26', '2026-10-28').riesgo;
  assert.equal(r, p.blocks.filter(b => b.e > 1440 && b.date <= '2026-10-28').length);
  assert.equal(L.nochesDeEstudio(estado(), { blocks: [] }, '2026-10-26', '2026-11-01').noches, 0);
});
