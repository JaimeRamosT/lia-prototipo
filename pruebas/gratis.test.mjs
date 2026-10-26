// Plan Gratis: se arma una vez por semana y no se reacomoda solo. planCongelado() cuenta con honestidad lo que falta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const semana = () => estado({
  compromisos: [
    { name: 'Clases', type: 'clase', days: LUN_A_VIE, start: '08:00', end: '13:00' },
    { name: 'Trabajo', days: LUN_A_VIE, start: '15:00', end: '21:00' },
  ],
  evaluaciones: [
    { course: 'Cálculo', date: '2026-10-29', hours: 5 },
    { course: 'Física', type: 'practica', date: '2026-10-28', time: '19:00', hours: 3 },
  ],
});
// Lo que guarda la app al armar la semana (armWeek).
const armar = (st, cuando) => { const p = L.plan(st, cuando);
  return { week: '2026-10-26', at: L.ymd(cuando), initial: true, sig: '', blocks: p.blocks, unmet: p.unmet, evalIds: st.evals.map(e => e.id) }; };
const lunes = ahora(26, 7, 0), miercoles = ahora(28, 7, 0);
const suma = bs => bs.reduce((a, b) => a + b.e - b.s, 0);
const futuros = (f, id, t) => f.blocks.filter(b => b.evalId === id && b.date >= t);

test('los bloques que pasaron sin estudiarse vuelven a faltar (antes decía «el resto ya está en tu horario»)', () => {
  const st = semana(), f = armar(st, lunes);
  const p = L.planCongelado(st, f, miercoles);
  assert.ok(p.perdidos.length > 0, 'hubo bloques el lunes y el martes');
  assert.ok(p.perdidos.every(b => b.date < '2026-10-28'));
  for (const e of st.evals) assert.equal(p.unmet[e.id], e.hours * 60 - suma(futuros(f, e.id, '2026-10-28')), e.course);
  assert.ok(p.unmet.e0 > f.unmet.e0, 'falta más de lo que faltaba el lunes');
  assert.ok(p.unmet.e1 > 0, 'la práctica de Física perdió sus bloques del lunes y del martes');
});

test('marcar como estudiado un bloque que pasó lo saca de los pendientes', () => {
  const st = semana(), f = armar(st, lunes), antes = L.planCongelado(st, f, miercoles);
  const b = antes.perdidos[0];
  st.done.push({ id: 'h1', evalId: b.evalId, date: b.date, start: L.fmt(b.s), min: b.e - b.s });
  const p = L.planCongelado(st, f, miercoles);
  assert.ok(!p.perdidos.some(x => L.claveBloque(x) === L.claveBloque(b)));
  assert.equal(p.unmet[b.evalId], antes.unmet[b.evalId] - (b.e - b.s));
});

test('un bloque que no pudiste estudiar ya no se pregunta, pero su tiempo sigue pendiente', () => {
  const st = semana(), f = armar(st, lunes), antes = L.planCongelado(st, f, miercoles);
  const b = antes.perdidos[0];
  const p = L.planCongelado(st, { ...f, vistos: [L.claveBloque(b)] }, miercoles);
  assert.equal(p.perdidos.length, antes.perdidos.length - 1);
  assert.deepEqual(p.unmet, antes.unmet);
});

test('un bloque de hoy cuenta como agendado hasta que termina', () => {
  const st = semana(), f = armar(st, lunes);
  const hoy = f.blocks.find(b => b.date === '2026-10-27');
  const [h, m] = [Math.floor(hoy.s / 60), hoy.s % 60];
  const durante = L.planCongelado(st, f, ahora(27, h, m + 5));
  assert.ok(!durante.perdidos.some(x => L.claveBloque(x) === L.claveBloque(hoy)));
  const despues = L.planCongelado(st, f, ahora(27, Math.floor(hoy.e / 60), hoy.e % 60));
  assert.ok(despues.perdidos.some(x => L.claveBloque(x) === L.claveBloque(hoy)));
  assert.equal(despues.unmet[hoy.evalId] - durante.unmet[hoy.evalId], hoy.e - hoy.s);
});

test('una evaluación agregada a mitad de semana queda «sin agendar», no «sin hueco»', () => {
  const st = semana(), f = armar(st, lunes);
  st.evals.push({ id: 'e9', type: 'entrega', course: 'Informe', date: '2026-10-30', time: '23:59', hours: 4 });
  const p = L.planCongelado(st, f, miercoles);
  assert.equal(p.unplanned.e9, 240);
  assert.equal(p.unmet.e9, undefined);
});

test('si la evaluación se adelanta, los bloques que quedaron después ya no cuentan', () => {
  const st = semana(), f = armar(st, lunes);
  st.evals[0].date = '2026-10-27';  // el parcial de Cálculo pasa al martes: se estudia hasta el lunes en la noche
  const p = L.planCongelado(st, f, ahora(26, 22, 0));
  assert.ok(p.blocks.filter(b => b.evalId === 'e0').every(b => b.date <= '2026-10-26'));
});

test('lo estudiado después de medianoche (guardado con la fecha del día siguiente) cubre su bloque', () => {
  const st = semana(), f = { week: '2026-10-26', at: '2026-10-26', initial: true, sig: '', unmet: {}, evalIds: ['e0', 'e1'],
    blocks: [{ evalId: 'e0', date: '2026-10-26', s: 1450, e: 1510 }] };
  st.done.push({ id: 'h1', evalId: 'e0', date: '2026-10-27', start: '00:10', min: 60 });
  const p = L.planCongelado(st, f, ahora(27, 10, 0));
  assert.equal(p.perdidos.length, 0);
});
