// avisosDe(): qué recordatorios se programan en el teléfono (LIA Pro, docs/notificaciones.md).
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00 (hora local).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const base = (extra = {}) => estado({
  compromisos: [{ name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' }],
  evaluaciones: [
    { course: 'Cálculo II', type: 'parcial', date: '2026-10-28', time: '10:00' },          // e0, miércoles
    { course: 'Informe de Química', type: 'entrega', date: '2026-10-30', time: '23:59' },   // e1, viernes
  ],
  ...extra,
});
// Hora local de un aviso, para comparar sin depender de la zona de la computadora.
const local = a => { const d = new Date(a.cuando); return `${L.ymd(d)} ${L.fmt(d.getHours() * 60 + d.getMinutes())}`; };
const de = (lista, tipo) => lista.filter(a => a.tipo === tipo);
const plan = s => L.plan(s, ahora());

test('examen: la noche anterior a las 20:00 y 2 horas antes', () => {
  const s = base(), a = L.avisosDe(s, plan(s), ahora());
  const manana = de(a, 'examen_manana'), pronto = de(a, 'examen_pronto');
  assert.deepEqual(manana.map(x => [x.ref, local(x)]), [['e0', '2026-10-27 20:00'], ['e1', '2026-10-29 20:00']]);
  assert.deepEqual(pronto.map(x => [x.ref, local(x)]), [['e0', '2026-10-28 08:00'], ['e1', '2026-10-30 21:59']]);
  assert.equal(manana[0].titulo, 'Mañana: parcial de Cálculo II');
  assert.equal(manana[0].cuerpo, 'A las 10:00. Repasa lo justo y duerme bien.');
  assert.equal(manana[1].titulo, 'Mañana vence: informe de Química');
  assert.equal(pronto[0].titulo, 'En 2 horas: parcial de Cálculo II');
});

test('examen temprano: sin aviso de «2 horas antes» si cae antes de despertar', () => {
  const s = base({ evaluaciones: [{ course: 'Física', date: '2026-10-28', time: '08:00' }] });
  const a = L.avisosDe(s, plan(s), ahora());
  assert.equal(de(a, 'examen_pronto').length, 0);   // serían las 06:00 y se despierta a las 07:00
  assert.equal(de(a, 'examen_manana').length, 1);
});

test('lo que ya pasó no se programa', () => {
  const s = base({ evaluaciones: [{ course: 'Física', date: '2026-10-26', time: '11:00' }] });   // hoy, en una hora
  const a = L.avisosDe(s, plan(s), ahora());
  assert.equal(de(a, 'examen_manana').length, 0);
  assert.equal(de(a, 'examen_pronto').length, 0);   // las 09:00 ya pasaron
});

test('antes de cada sesión: 15 minutos antes, salvo lo ya estudiado', () => {
  const s = base(), p = plan(s), a = L.avisosDe(s, p, ahora()), ses = de(a, 'sesion');
  const futuros = p.blocks.filter(b => new Date(2026, 9, 26 + L.dayDiff('2026-10-26', b.date), 0, b.s - 15) > ahora());
  assert.equal(ses.length, futuros.length);
  const b = futuros[0], x = ses[0];
  assert.equal(x.titulo, `En 15 min: estudia ${s.evals.find(e => e.id === b.evalId).course}`);
  assert.equal(local(x), `${b.date} ${L.fmt(b.s - 15)}`);
  assert.match(x.cuerpo, new RegExp(`^De ${L.fmt(b.s)} a ${L.fmt(b.e)}, para tu `));
  // Si ya marcó ese bloque, no hay aviso.
  const s2 = { ...s, done: [{ id: 'd1', evalId: b.evalId, date: b.date, start: L.fmt(b.s), min: b.e - b.s }] };
  assert.equal(de(L.avisosDe(s2, p, ahora()), 'sesion').length, ses.length - 1);
});

test('resumen de la mañana a la hora de despertar, solo los días con estudio o evaluación', () => {
  const s = base(), p = plan(s), a = de(L.avisosDe(s, p, ahora()), 'resumen');
  for (const x of a) assert.match(local(x), / 07:00$/);
  const mie = a.find(x => x.ref === 'r2026-10-28');
  assert.ok(mie, 'el miércoles hay parcial');
  assert.match(mie.cuerpo, /Parcial de Cálculo II a las 10:00\./);
  const conEstudio = a.find(x => /^Hoy estudias/.test(x.titulo));
  assert.ok(conEstudio && / a las \d\d:\d\d/.test(conEstudio.cuerpo), conEstudio && conEstudio.cuerpo);
  const dias = new Set(p.blocks.map(b => b.date).concat(['2026-10-28', '2026-10-30']).filter(f => f > '2026-10-26'));
  assert.deepEqual(new Set(a.map(x => x.ref.slice(1))), dias);
});

test('estudio sin marcar: 30 minutos antes de dormir, en los días con bloques', () => {
  const s = base(), p = plan(s), a = de(L.avisosDe(s, p, ahora()), 'sin_marcar');
  assert.ok(a.length > 0);
  for (const x of a) assert.match(local(x), / 22:30$/);
  // Con hora de dormir 00:30, el aviso es a medianoche.
  const s2 = base({ ajustes: { sleep: '00:30' } }), a2 = de(L.avisosDe(s2, plan(s2), ahora()), 'sin_marcar');
  assert.match(local(a2[0]), / 00:00$/);
});

test('cada tipo se puede apagar, y nada va más allá de 8 días', () => {
  const s = base(), p = plan(s);
  const solo = L.avisosDe(s, p, ahora(), { sesion: false, resumen: false, sinMarcar: false });
  assert.deepEqual([...new Set(solo.map(a => a.tipo))].sort(), ['examen_manana', 'examen_pronto']);
  const lejos = base({ evaluaciones: [{ course: 'Final', date: '2026-11-20', time: '09:00' }] });
  assert.equal(de(L.avisosDe(lejos, plan(lejos), ahora()), 'examen_manana').length, 0);
});

test('al servidor solo van hora, tipo y una referencia sin nombres de cursos', () => {
  const s = base(), a = L.avisosDe(s, plan(s), ahora());
  for (const x of a) {
    assert.ok(['examen_manana', 'examen_pronto', 'sesion', 'resumen', 'sin_marcar'].includes(x.tipo));
    assert.ok(x.ref.length <= 60 && !/calculo|quimica|cálculo|química/i.test(x.ref), x.ref);
  }
  assert.ok(a.length <= 150);
});
