// Lo que la app publica para Google Calendar y WhatsApp (eventosCanales): sesiones de estudio y evaluaciones de los
// próximos 14 días, con hora de Lima y el nombre del curso. Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora } from './logica.mjs';

test('sesiones de estudio y evaluaciones con hora de Lima y su nombre', () => {
  const s = estado({ evaluaciones: [{ id: 'e1', type: 'parcial', course: 'Cálculo II', date: '2026-10-29', time: '09:00', hours: 3 },
    { id: 'e2', type: 'entrega', course: 'Informe de Química', date: '2026-10-30', time: '23:59', hours: 2 }] });
  const p = { blocks: [{ date: '2026-10-27', s: 19 * 60, e: 21 * 60, evalId: 'e1' }, { date: '2026-10-27', s: 23 * 60, e: 24 * 60 + 30, evalId: 'e2' }, { date: '2026-12-30', s: 600, e: 660, evalId: 'e1' }] };
  const ev = L.eventosCanales(s, p, ahora());
  assert.deepEqual(ev[0], { inicio: '2026-10-27T19:00:00-05:00', fin: '2026-10-27T21:00:00-05:00', titulo: 'Estudiar Cálculo II', tipo: 'estudio' });
  assert.deepEqual([ev[1].inicio, ev[1].fin], ['2026-10-27T23:00:00-05:00', '2026-10-28T00:30:00-05:00'], 'pasa la medianoche');
  assert.ok(ev.some(e => e.titulo === 'Parcial de Cálculo II' && e.inicio === '2026-10-29T09:00:00-05:00' && e.fin === '2026-10-29T10:00:00-05:00'));
  assert.ok(ev.some(e => e.titulo === 'Entrega de Informe de Química' && e.fin === '2026-10-31T00:14:00-05:00'), 'una entrega a las 23:59 dura 15 minutos');
  assert.ok(!ev.some(e => e.inicio.startsWith('2026-12-30')), 'solo los próximos 14 días');
  assert.ok(ev.every((e, i) => i === 0 || ev[i - 1].inicio <= e.inicio), 'en orden');
});

test('nada del pasado (las rutinas se prueban en calendario-exportar)', () => {
  const s = estado({ evaluaciones: [{ id: 'e1', type: 'parcial', course: 'Física', date: '2026-10-20', time: '09:00', hours: 3 }] });
  assert.deepEqual(L.eventosCanales(s, { blocks: [{ date: '2026-10-20', s: 600, e: 660, evalId: 'e1' }] }, ahora()), []);
});
