// Lía en WhatsApp (docs/whatsapp-lia.md), del lado de la app: el contexto que publica (contextoWhatsapp) y la revisión
// de lo confirmado antes de guardarlo (revisarPropuesta).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora } from './logica.mjs';

const base = () => estado({
  compromisos: [{ id: 'c1', name: 'Trabajo', type: 'trabajo', days: [1, 2, 3, 4, 5], start: '15:00', end: '19:00' },
    { id: 'g1', name: 'Clase de Google', type: 'clase', days: [2], start: '08:00', end: '10:00', gcal: 'u:1' }],
  evaluaciones: [{ id: 'e1', course: 'Cálculo II', date: '2026-10-29', time: '09:00', hours: 5 },
    { id: 'e0', course: 'Historia', date: '2026-10-05', time: '09:00', hours: 2 },
    { id: 'g2', course: 'De Google', date: '2026-10-30', time: '10:00', hours: 2, gcal: 'v:9' }],
  hechos: [{ id: 'h1', evalId: 'e1', date: '2026-10-25', start: '20:00', min: 90 }],
});

test('contextoWhatsapp: ajustes, evaluaciones recientes con avance y rutinas; sin lo de Google ni datos personales', () => {
  const s = base(); s.settings.name = 'Ana';
  const n = ahora(), c = L.contextoWhatsapp(s, L.plan(s, n), n);
  assert.deepEqual(c.settings, { wake: '07:00', sleep: '23:00', maxDay: 180, block: 60, minBlock: 30 });
  assert.deepEqual(c.evals.map(e => e.id), ['e1'], 'sin la de hace más de 14 días ni la de Google');
  assert.equal(c.evals[0].hecho, 90);
  assert.ok(Number.isInteger(c.evals[0].sinHueco));
  assert.deepEqual(c.commitments.map(x => x.id), ['c1']);
  const t = JSON.stringify(c);
  assert.ok(!t.includes('Ana') && !t.includes('Google') && !t.includes('gcal'));
  assert.ok(t.length < 60000);
});

test('revisarPropuesta: guarda lo que sigue valiendo y explica lo que no', () => {
  const s = base(), n = ahora(), rev = (it, room = Infinity) => L.revisarPropuesta(s, it, n, room);
  const ev = (x = {}) => ({ kind: 'eval', type: 'parcial', course: 'Física', date: '2026-10-30', time: '10:00', hours: 5, ...x });
  assert.deepEqual(rev({ intent: 'add', items: [ev()] }), { ok: true });
  assert.deepEqual(rev({ intent: 'add', items: [ev()] }, 0), { ok: false, motivo: 'limite' });
  assert.deepEqual(rev({ intent: 'add', items: [ev({ date: '2026-10-20' })] }), { ok: false, motivo: 'pasada' });
  assert.deepEqual(rev({ intent: 'add', items: [ev({ course: 'cálculo ii', date: '2026-10-29', time: '09:00' })] }), { ok: false, motivo: 'repetida' });
  assert.deepEqual(rev({ intent: 'add', items: [ev({ time: '' })] }), { ok: false, motivo: 'rara' });
  assert.deepEqual(rev({ intent: 'add', items: [{ kind: 'commit', type: 'deporte', name: 'Gimnasio', days: [2, 4], start: '06:00', end: '07:00' }] }, 0), { ok: true }, 'una rutina no cuenta para el límite');
  assert.deepEqual(rev({ intent: 'except', exs: [{ date: '2026-10-27', start: '15:00', end: '19:00', label: 'Sin Trabajo', libre: true, ref: 'c1' }] }), { ok: true });
  assert.deepEqual(rev({ intent: 'except', exs: [{ date: '2026-10-27', start: '15:00', end: '19:00', label: 'Sin Trabajo', libre: true, ref: 'cX' }] }), { ok: false, motivo: 'sin_rutina' });
  assert.deepEqual(rev({ intent: 'except', exs: [{ date: '2026-10-25', start: '15:00', end: '19:00', label: 'Cumpleaños' }] }), { ok: false, motivo: 'pasada' });
  assert.deepEqual(rev({ intent: 'log', evalId: 'e1', date: '2026-10-25', min: 120 }), { ok: true }, 'el estudio hecho puede ser de días pasados');
  assert.deepEqual(rev({ intent: 'log', evalId: 'eX', date: '2026-10-25', min: 120 }), { ok: false, motivo: 'sin_eval' });
  assert.deepEqual(rev({ intent: 'log', evalId: 'e1', date: '2026-10-27', min: 120 }), { ok: false, motivo: 'rara' }, 'no se anota estudio del futuro');
  assert.deepEqual(rev({ intent: 'cambiaEval', evalId: 'e1', date: '2026-10-30', time: '10:00' }), { ok: true });
  assert.deepEqual(rev({ intent: 'cambiaEval', evalId: 'eX', date: '2026-10-30', time: '10:00' }), { ok: false, motivo: 'sin_eval' });
  assert.deepEqual(rev({ intent: 'quitaEval', evalId: 'e1' }), { ok: true });
  assert.deepEqual(rev({ intent: 'borrarTodo' }), { ok: false, motivo: 'rara' });
  assert.deepEqual(rev(null), { ok: false, motivo: 'rara' });
});
