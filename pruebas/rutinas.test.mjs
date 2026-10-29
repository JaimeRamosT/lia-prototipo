// Rutinas con varios horarios y cosas de un solo día (iteración 2).
// Cada horario de una rutina es un compromiso y los de una misma rutina comparten «grupo»: los datos siguen en v:1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, choca } from './logica.mjs';

// Clases en dos horarios (lun-mié-vie en la mañana y mar-jue en la tarde) y un trabajo aparte.
const conGrupo = () => estado({
  compromisos: [
    { id: 'a', grupo: 'g1', name: 'Clases', type: 'clase', days: [1, 3, 5], start: '08:00', end: '12:00' },
    { id: 'b', grupo: 'g1', name: 'Clases', type: 'clase', days: [2, 4], start: '14:00', end: '18:00' },
    { id: 'c', name: 'Trabajo', type: 'trabajo', days: [1, 2, 3, 4, 5], start: '19:00', end: '22:00' },
  ],
  evaluaciones: [{ course: 'Cálculo', date: '2026-10-30', time: '09:00', hours: 6 }],
});

test('agruparRutinas junta los horarios de una rutina y deja sola a la que no tiene grupo', () => {
  const g = L.agruparRutinas(conGrupo().commitments);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].tramos.map(t => t.id), ['a', 'b']);
  assert.equal(g[0].grupo, 'g1');
  assert.equal(g[0].name, 'Clases');
  assert.equal(g[1].grupo, null);
  assert.deepEqual(g[1].tramos.map(t => t.id), ['c']);
});

test('agruparRutinas respeta el orden de aparición aunque los horarios de un grupo no estén juntos', () => {
  const cs = [{ id: 'x', grupo: 'g', name: 'Inglés', type: 'curso', days: [1], start: '07:00', end: '08:00' },
              { id: 'y', name: 'Almuerzo', type: 'comida', days: [1], start: '13:00', end: '14:00' },
              { id: 'z', grupo: 'g', name: 'Inglés', type: 'curso', days: [6], start: '09:00', end: '12:00' }];
  const g = L.agruparRutinas(cs);
  assert.deepEqual(g.map(r => r.name), ['Inglés', 'Almuerzo']);
  assert.deepEqual(g[0].tramos.map(t => t.id), ['x', 'z']);
});

test('el plan respeta cada horario de una rutina en su día', () => {
  const st = conGrupo(), p = L.plan(st, ahora(26, 6, 0));
  assert.ok(p.blocks.length > 0);
  for (const [fecha, s, e] of [['2026-10-26', 480, 720], ['2026-10-28', 480, 720], ['2026-10-27', 840, 1080], ['2026-10-29', 840, 1080]])
    assert.ok(!choca(p.blocks, fecha, s, e), `estudio encima de Clases el ${fecha}`);
  const martes = L.busyFor(st, '2026-10-27').filter(b => b.ref === 'a' || b.ref === 'b');
  assert.deepEqual(martes.map(b => [b.ref, b.s, b.e, b.kind]), [['b', 840, 1080, 'clase']]);
});

test('crucesTramo encuentra lo que se cruza el mismo día y no cuenta lo que solo se toca', () => {
  const cs = conGrupo().commitments;
  assert.deepEqual(L.crucesTramo(cs, { days: [1], start: '11:00', end: '13:00' }, []).map(c => c.id), ['a']);
  assert.deepEqual(L.crucesTramo(cs, { days: [1], start: '12:00', end: '14:00' }, []), []);  // termina cuando empieza
  assert.deepEqual(L.crucesTramo(cs, { days: [6], start: '08:00', end: '12:00' }, []), []);  // otro día
});

test('crucesTramo no avisa de los horarios de la misma rutina', () => {
  const cs = conGrupo().commitments;
  assert.deepEqual(L.crucesTramo(cs, { days: [1], start: '09:00', end: '20:00' }, ['a', 'b']).map(c => c.id), ['c']);
});

test('crucesTramo ve lo que pasa la medianoche, en los dos sentidos', () => {
  const cs = [{ id: 'temprano', name: 'Gimnasio', type: 'deporte', days: [2], start: '05:00', end: '06:30' },
              { id: 'turno', name: 'Turno noche', type: 'trabajo', days: [0], start: '22:00', end: '03:00' }];
  // Un turno de lunes que termina a las 06:00 del martes choca con el gimnasio del martes.
  assert.deepEqual(L.crucesTramo(cs, { days: [1], start: '23:00', end: '06:00' }, []).map(c => c.id), ['temprano']);
  // El turno del domingo sigue el lunes hasta las 03:00: un horario del lunes a la 01:00 se cruza.
  assert.deepEqual(L.crucesTramo(cs, { days: [1], start: '01:00', end: '02:00' }, []).map(c => c.id), ['turno']);
  // Si empieza a las 03:00 del lunes, ya no.
  assert.deepEqual(L.crucesTramo(cs, { days: [1], start: '03:00', end: '04:00' }, []), []);
});

test('crucesTramo no opina mientras el horario está incompleto', () => {
  const cs = conGrupo().commitments;
  assert.deepEqual(L.crucesTramo(cs, { days: [], start: '08:00', end: '12:00' }, []), []);
  assert.deepEqual(L.crucesTramo(cs, { days: [1], start: '', end: '12:00' }, []), []);
  assert.deepEqual(L.crucesTramo(cs, { days: [1], start: '10:00', end: '10:00' }, []), []);
});

test('algo de un solo día ocupa con su categoría, también lo que sigue después de medianoche', () => {
  const st = estado({ excepciones: [{ id: 'x1', date: '2026-10-30', start: '21:00', end: '01:00', label: 'Cumpleaños de Ana', cat: 'ocio' }] });
  const vie = L.busyFor(st, '2026-10-30').find(b => b.ref === 'x1');
  const sab = L.busyFor(st, '2026-10-31').find(b => b.ref === 'x1');
  assert.deepEqual([vie.s, vie.e, vie.kind, vie.cat], [1260, 1500, 'excepcion', 'ocio']);
  assert.deepEqual([sab.s, sab.e, sab.cat, sab.cola], [0, 60, 'ocio', true]);
});

test('el estudio no cae encima de algo de un solo día', () => {
  const st = estado({
    compromisos: [{ name: 'Trabajo', days: [1, 2, 3, 4, 5], start: '09:00', end: '13:00' }],
    evaluaciones: [{ course: 'Física', date: '2026-10-28', time: '19:00', hours: 4 }],
    excepciones: [{ id: 'x2', date: '2026-10-27', start: '14:00', end: '19:00', label: 'Cita médica', cat: 'otro' }],
  });
  const p = L.plan(st, ahora(26, 7, 0));
  assert.ok(!choca(p.blocks, '2026-10-27', 840, 1140));
});

// Gratis: lo armado queda fijo; una rutina o algo de un día que cae encima de un bloque se detecta para avisarlo.
test('bloquesQueChocan encuentra el bloque armado que quedó debajo de algo nuevo, y nada más', () => {
  const st = estado({
    compromisos: [{ name: 'Trabajo', days: [1, 2, 3, 4, 5], start: '15:00', end: '19:00' }],
    evaluaciones: [{ course: 'Cálculo', date: '2026-10-30', time: '09:00', hours: 4 }],
  });
  const lunes = ahora(26, 7, 0), p = L.plan(st, lunes);
  const f = { week: '2026-10-26', at: '2026-10-26', initial: true, sig: '', blocks: p.blocks, unmet: p.unmet, evalIds: ['e0'] };
  assert.deepEqual(L.bloquesQueChocan(st, f, lunes), []);  // recién armado no choca con nada
  const b = p.blocks[0];
  const encima = { ...st, exceptions: [{ id: 'x', date: b.date, start: L.fmt(b.s), end: L.fmt(b.s + 30), label: 'Cita', cat: 'otro' }] };
  assert.deepEqual(L.bloquesQueChocan(encima, f, lunes).map(x => x.date + x.s), [b.date + b.s]);
  const alLado = { ...st, exceptions: [{ id: 'x', date: b.date, start: L.fmt(b.e), end: L.fmt(b.e + 30), label: 'Cita', cat: 'otro' }] };
  assert.deepEqual(L.bloquesQueChocan(alLado, f, lunes), []);  // empieza cuando termina el bloque
  // Un bloque que ya pasó no cuenta.
  const despues = new Date(L.fromYmd(b.date).getTime() + (b.e + 5) * 60000);
  assert.ok(!L.bloquesQueChocan(encima, f, despues).some(x => x.date === b.date && x.s === b.s));
});

test('bloquesQueChocan ve el bloque de después de medianoche contra lo del día siguiente', () => {
  const st = estado({ evaluaciones: [{ course: 'Física', date: '2026-10-30', time: '09:00', hours: 2 }],
    compromisos: [{ name: 'Gimnasio', type: 'deporte', days: [3], start: '00:00', end: '01:00' }] });
  const f = { week: '2026-10-26', at: '2026-10-26', initial: true, sig: '', unmet: {}, evalIds: ['e0'],
    blocks: [{ evalId: 'e0', date: '2026-10-27', s: 1440, e: 1500 }] };  // martes 24:00–25:00 = miércoles 00:00–01:00
  assert.equal(L.bloquesQueChocan(st, f, ahora(26, 7, 0)).length, 1);
  const otroDia = { ...st, commitments: [{ ...st.commitments[0], days: [4] }] };
  assert.equal(L.bloquesQueChocan(otroDia, f, ahora(26, 7, 0)).length, 0);
});
