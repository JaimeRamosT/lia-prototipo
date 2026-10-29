// «Tu día» completo y el ocio como tiempo protegido (iteración 2, decisión 5 del 28-oct).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora } from './logica.mjs';

const base = () => estado({
  compromisos: [{ name: 'Clases', type: 'clase', days: [1, 2, 3, 4, 5], start: '08:00', end: '13:00' },
                { name: 'Trabajo', days: [1, 2, 3, 4, 5], start: '15:00', end: '21:00' }],
  evaluaciones: [{ course: 'Cálculo', date: '2026-10-30', hours: 4 }],
});
const horas = tr => tr.map(x => [L.fmt(x.s), L.fmt(x.e), x.k]);

test('tramosDia reparte el día despierto, de despertar a dormir, sin huecos ni encimas', () => {
  const st = base(), p = L.plan(st, ahora(26, 6, 0)), tr = L.tramosDia(st, p, '2026-10-27');
  assert.equal(tr[0].s, 420);
  assert.equal(tr[tr.length - 1].e, 1380);
  for (let i = 1; i < tr.length; i++) assert.equal(tr[i].s, tr[i - 1].e);
  assert.deepEqual(horas(tr), [['07:00', '08:00', 'libre'], ['08:00', '13:00', 'clase'], ['13:00', '14:00', 'estudio'],
    ['14:00', '15:00', 'libre'], ['15:00', '21:00', 'trabajo'], ['21:00', '23:00', 'libre']]);
});

test('resumenDia: ocupado + estudio + libre = las horas despierto', () => {
  const st = base(), p = L.plan(st, ahora(26, 6, 0)), r = L.resumenDia(st, p, '2026-10-27');
  assert.deepEqual([r.despierto, r.ocupado, r.estudio, r.libre], [960, 660, 60, 240]);
});

test('resumenDia: lo que se pisa cuenta una sola vez (la evaluación manda, después lo ocupado, después el estudio)', () => {
  const st = estado({
    compromisos: [{ name: 'Trabajo', days: [5], start: '08:00', end: '12:00' }, { name: 'Almuerzo', type: 'comida', days: [5], start: '11:00', end: '13:00' }],
    evaluaciones: [{ course: 'Física', date: '2026-10-30', time: '10:00', hours: 1 }],
  });
  const r = L.resumenDia(st, { blocks: [] }, '2026-10-30');
  assert.equal(r.ocupado, 300);  // 08:00 a 13:00, aunque el trabajo, el almuerzo y la evaluación se crucen
  assert.equal(r.ocupado + r.estudio + r.libre, r.despierto);
  assert.ok(r.tramos.some(x => x.k === 'examen' && x.s === 600 && x.e === 720));
});

test('resumenDia: si se duerme después de medianoche, el día termina al día siguiente', () => {
  const st = estado({ ajustes: { sleep: '00:30' } }), r = L.resumenDia(st, { blocks: [] }, '2026-10-27');
  assert.equal(r.despierto, 1050);
  assert.equal(r.libre, 1050);
});

test('algo de un solo día pinta su categoría en el día', () => {
  const st = estado({ excepciones: [{ id: 'x', date: '2026-10-27', start: '19:00', end: '22:00', label: 'Cumpleaños', cat: 'ocio' }] });
  assert.ok(L.tramosDia(st, { blocks: [] }, '2026-10-27').some(x => x.k === 'ocio' && x.s === 1140 && x.e === 1320));
});

test('huecosDia: desde ahora si es hoy, de 15 min o más y sin lo ya liberado', () => {
  const st = base(), p = L.plan(st, ahora(26, 6, 0));
  assert.deepEqual(L.huecosDia(st, p, '2026-10-26', ahora(26, 14, 2)).map(x => [L.fmt(x.s), L.fmt(x.e)]), [['14:05', '15:00'], ['21:00', '23:00']]);
  assert.deepEqual(L.huecosDia(st, p, '2026-10-25', ahora(26, 14, 0)), []);  // un día que ya pasó
  const lib = { ...st, exceptions: [{ id: 'l', date: '2026-10-27', start: '08:00', end: '13:00', label: 'Sin Clases', libre: true, ref: 'c0' }] };
  const h = L.huecosDia(lib, L.plan(lib, ahora(26, 6, 0)), '2026-10-27', ahora(26, 6, 0));
  assert.ok(!h.some(x => x.s < 780 && x.e > 480), 'lo liberado tiene su propia fila');
});

test('lo liberado de un evento de un día también se descuenta (para usar un rato de ocio)', () => {
  const st = estado({ excepciones: [
    { id: 'x', date: '2026-10-27', start: '18:00', end: '22:00', label: 'Cumpleaños', cat: 'ocio' },
    { id: 'l', date: '2026-10-27', start: '18:00', end: '19:00', label: 'Sin Cumpleaños', libre: true, ref: 'x' }] });
  assert.deepEqual(L.busyFor(st, '2026-10-27').map(b => [b.s, b.e, b.kind, b.cat]), [[1140, 1320, 'excepcion', 'ocio']]);
});

// Ocio: Lía no pone estudio ahí; si no alcanza el tiempo, propone usar un rato.
const conOcio = (ajustes = {}) => estado({ ajustes,
  compromisos: [{ name: 'Trabajo', days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '20:00' },
                { name: 'Fútbol', type: 'ocio', days: [3], start: '20:00', end: '23:00' },
                { name: 'Series', type: 'ocio', days: [1, 2, 4], start: '20:00', end: '23:00' }],
  evaluaciones: [{ course: 'Física', date: '2026-10-30', time: '09:00', hours: 3 }] });

test('el plan no pone estudio en el ocio', () => {
  const st = conOcio(), p = L.plan(st, ahora(26, 6, 0));
  assert.equal(p.blocks.length, 0);
  assert.equal(p.unmet.e0, 180);
});

test('ocioParaEstudio propone el primer rato de ocio que sirve, del largo de un bloque', () => {
  const st = conOcio(), p = L.plan(st, ahora(26, 6, 0)), o = L.ocioParaEstudio(st, p, 'e0', ahora(26, 6, 0));
  assert.deepEqual([o.date, L.fmt(o.s), L.fmt(o.e), o.label, o.ref, o.evento], ['2026-10-26', '20:00', '21:00', 'Series', 'c2', false]);
  // Hoy a las 22:40 ya no queda un bloque antes de dormir: pasa al martes.
  const o2 = L.ocioParaEstudio(st, p, 'e0', ahora(26, 22, 40));
  assert.equal(o2.date, '2026-10-27');
});

test('ocioParaEstudio respeta el máximo por día y no propone nada si no falta tiempo', () => {
  const st = conOcio({ maxDay: 45 }), p = L.plan(st, ahora(26, 6, 0)), o = L.ocioParaEstudio(st, p, 'e0', ahora(26, 6, 0));
  assert.equal(o.e - o.s, 45);
  assert.equal(L.ocioParaEstudio(base(), L.plan(base(), ahora(26, 6, 0)), 'e0', ahora(26, 6, 0)), null);
});

test('ocioParaEstudio no usa el día de la evaluación si es examen (se estudia hasta el día antes)', () => {
  const st = estado({ compromisos: [{ name: 'Trabajo', days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '20:00' },
                                    { name: 'Series', type: 'ocio', days: [4], start: '20:00', end: '23:00' }],
    evaluaciones: [{ course: 'Física', date: '2026-10-29', time: '09:00', hours: 2 }] });
  assert.equal(L.ocioParaEstudio(st, L.plan(st, ahora(26, 6, 0)), 'e0', ahora(26, 6, 0)), null);  // el ocio es el jueves, el día del examen
});

test('con el rato de ocio liberado, el plan sí pone estudio ahí', () => {
  const st = conOcio(), p = L.plan(st, ahora(26, 6, 0)), o = L.ocioParaEstudio(st, p, 'e0', ahora(26, 6, 0));
  const lib = { ...st, exceptions: [{ id: 'l', date: o.date, start: L.fmt(o.s), end: L.fmt(o.e), label: 'Sin Series', libre: true, ref: o.ref }] };
  const p2 = L.plan(lib, ahora(26, 6, 0));
  assert.ok(p2.blocks.some(b => b.date === o.date && b.s === o.s && b.e === o.e));
  assert.equal(p2.unmet.e0, 120);
});

test('Gratis: reubicarCongelado saca el bloque que quedó en el ocio y lo pone en otro hueco sin mover lo demás', () => {
  const st = base(), lunes = ahora(26, 6, 0), p = L.plan(st, lunes);
  const f = { week: '2026-10-26', at: '2026-10-26', initial: true, sig: '', blocks: p.blocks, unmet: p.unmet, evalIds: ['e0'] };
  const b = p.blocks[0];
  const ocio = { ...st, exceptions: [{ id: 'x', date: b.date, start: L.fmt(b.s), end: L.fmt(b.e), label: 'Cumpleaños', cat: 'ocio' }] };
  const c = L.bloquesQueChocan(ocio, f, lunes, L.esOcio);
  assert.equal(c.length, 1);
  const r = L.reubicarCongelado(ocio, f, c, lunes);
  assert.equal(r.blocks.reduce((a, x) => a + x.e - x.s, 0), p.blocks.reduce((a, x) => a + x.e - x.s, 0));
  for (const x of p.blocks.slice(1)) assert.ok(r.blocks.some(y => y.date === x.date && y.s === x.s), 'lo demás no se mueve');
  assert.equal(L.bloquesQueChocan(ocio, { ...f, blocks: r.blocks }, lunes).length, 0);
  assert.equal(L.planCongelado(ocio, { ...f, blocks: r.blocks }, lunes).unmet.e0, 0);
});

test('Gratis: si no hay otro hueco, lo que no entra queda como «falta»', () => {
  const st = estado({ compromisos: [{ name: 'Trabajo', days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '20:00' }],
    evaluaciones: [{ course: 'Física', date: '2026-10-28', time: '09:00', hours: 2 }] });
  const lunes = ahora(26, 6, 0), p = L.plan(st, lunes);
  const f = { week: '2026-10-26', at: '2026-10-26', initial: true, sig: '', blocks: p.blocks, unmet: p.unmet, evalIds: ['e0'] };
  const todo = { ...st, exceptions: p.blocks.map((b, i) => ({ id: 'x' + i, date: b.date, start: '20:00', end: '23:00', label: 'Series', cat: 'ocio' })) };
  const c = L.bloquesQueChocan(todo, f, lunes, L.esOcio);
  const r = L.reubicarCongelado(todo, f, c, lunes);
  assert.equal(r.nuevos.length, 0);
  assert.equal(L.planCongelado(todo, { ...f, blocks: r.blocks }, lunes).unmet.e0, 120);
});

test('bloquesQueChocan con filtro solo mira el ocio', () => {
  const st = base(), lunes = ahora(26, 6, 0), p = L.plan(st, lunes), b = p.blocks[0];
  const f = { week: '2026-10-26', at: '2026-10-26', initial: true, sig: '', blocks: p.blocks, unmet: p.unmet, evalIds: ['e0'] };
  const cita = { ...st, exceptions: [{ id: 'x', date: b.date, start: L.fmt(b.s), end: L.fmt(b.e), label: 'Cita', cat: 'otro' }] };
  assert.equal(L.bloquesQueChocan(cita, f, lunes).length, 1);
  assert.equal(L.bloquesQueChocan(cita, f, lunes, L.esOcio).length, 0);
});
