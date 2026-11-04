// Cruces lado a lado (iteración 3, docs/iteracion-3.md §5): columnasCruces() reparte en columnas lo que pasa a la vez,
// con el algoritmo de columnas de Google Calendar, y gruposCruce() junta lo que se toca para las listas.
// itemsCalendario() da lo de un día del calendario (de 0:00 a 24:00) para la cuadrícula de Semana.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const h = t => L.toMin(t);
const it = (id, s, e, extra = {}) => ({ id, s: h(s), e: h(e), ...extra });
const por = (lista, id) => lista.find(x => x.id === id);
const seCruzan = (a, b) => a.s < b.e && b.s < a.e;

test('dos actividades que no se tocan van solas, cada una a todo el ancho', () => {
  const r = L.columnasCruces([it('a', '09:00', '10:00'), it('b', '11:00', '12:00')]);
  assert.deepEqual(r.map(x => [x.id, x.col, x.cols, x.span]), [['a', 0, 1, 1], ['b', 0, 1, 1]]);
  assert.notEqual(por(r, 'a').grupo, por(r, 'b').grupo);
});

test('dos a la vez van lado a lado, en dos columnas del mismo grupo', () => {
  const r = L.columnasCruces([it('trabajo', '09:00', '18:00'), it('cita', '10:00', '11:00')]);
  assert.deepEqual(r.map(x => [x.id, x.col, x.cols]), [['trabajo', 0, 2], ['cita', 1, 2]]);
  assert.equal(por(r, 'trabajo').grupo, por(r, 'cita').grupo);
});

test('si una termina justo cuando empieza la otra, no se cruzan', () => {
  const r = L.columnasCruces([it('a', '09:00', '10:00'), it('b', '10:00', '11:00')]);
  assert.deepEqual(r.map(x => x.cols), [1, 1]);
});

test('a la misma hora, la más larga va primero (columna izquierda)', () => {
  const r = L.columnasCruces([it('corta', '09:00', '10:00'), it('larga', '09:00', '18:00')]);
  assert.equal(por(r, 'larga').col, 0);
  assert.equal(por(r, 'corta').col, 1);
});

test('una cadena (A con B, B con C) es un solo grupo y reusa la columna que se liberó', () => {
  const r = L.columnasCruces([it('a', '09:00', '11:00'), it('b', '10:00', '12:00'), it('c', '11:30', '13:00')]);
  assert.deepEqual(r.map(x => [x.id, x.col, x.cols]), [['a', 0, 2], ['b', 1, 2], ['c', 0, 2]]);
  assert.equal(new Set(r.map(x => x.grupo)).size, 1);
});

test('tres a la vez necesitan tres columnas', () => {
  const r = L.columnasCruces([it('a', '09:00', '12:00'), it('b', '09:00', '10:00'), it('c', '09:30', '10:30')]);
  assert.deepEqual(r.map(x => x.cols), [3, 3, 3]);
  assert.deepEqual(new Set(r.map(x => x.col)), new Set([0, 1, 2]));
});

test('una actividad se estira a las columnas de la derecha que están libres en su horario', () => {
  // a ocupa 9-12; b y c ocupan las columnas 1 y 2 temprano; d (11-12) cae en la columna 1 y puede usar también la 2.
  const r = L.columnasCruces([it('a', '09:00', '12:00'), it('b', '09:00', '10:00'), it('c', '09:00', '10:30'), it('d', '11:00', '12:00')]);
  const d = por(r, 'd');
  assert.equal(d.cols, 3);
  assert.equal(d.col, 1);
  assert.equal(d.span, 2);
  assert.equal(por(r, 'a').span, 1);
});

test('devuelve copias en orden de inicio, con los datos de cada una, sin tocar la lista original', () => {
  const lista = [it('b', '11:00', '12:00', { label: 'Almuerzo' }), it('a', '09:00', '10:00', { label: 'Clases' })];
  const copia = JSON.parse(JSON.stringify(lista));
  const r = L.columnasCruces(lista);
  assert.deepEqual(r.map(x => [x.id, x.label]), [['a', 'Clases'], ['b', 'Almuerzo']]);
  assert.deepEqual(lista, copia);
  assert.deepEqual(L.columnasCruces([]), []);
  assert.deepEqual(L.columnasCruces([null, { s: 'x', e: 3 }]), []);
});

test('con cualquier horario, dos que se cruzan nunca quedan en la misma columna ni se pisan al estirarse', () => {
  let semilla = 7;
  const azar = n => { semilla = (semilla * 16807) % 2147483647; return semilla % n; };
  for (let vuelta = 0; vuelta < 300; vuelta++) {
    const n = 1 + azar(8), lista = [];
    for (let i = 0; i < n; i++) { const s = 360 + azar(60) * 15, dur = 15 + azar(16) * 15; lista.push({ id: 'x' + i, s, e: s + dur }); }
    const r = L.columnasCruces(lista);
    assert.equal(r.length, n);
    for (const a of r) {
      assert.ok(a.col >= 0 && a.col < a.cols && a.span >= 1 && a.col + a.span <= a.cols, 'columna dentro del grupo');
      for (const b of r) {
        if (a === b || !seCruzan(a, b)) continue;
        assert.equal(a.grupo, b.grupo, 'lo que se cruza va en el mismo grupo');
        const pisan = a.col < b.col + b.span && b.col < a.col + a.span;
        assert.ok(!pisan, `${a.id} y ${b.id} se pisan`);
      }
    }
  }
});

test('gruposCruce junta lo que se toca, con su inicio, su fin y sus columnas', () => {
  const g = L.gruposCruce([it('a', '09:00', '11:00'), it('b', '10:00', '12:00'), it('c', '14:00', '15:00')]);
  assert.equal(g.length, 2);
  assert.deepEqual([g[0].s, g[0].e, g[0].cols, g[0].items.map(x => x.id)], [h('09:00'), h('12:00'), 2, ['a', 'b']]);
  assert.deepEqual([g[1].cols, g[1].items.map(x => x.id)], [1, ['c']]);
});

test('itemsCalendario: un evento de un día a la hora del trabajo aparece junto al trabajo', () => {
  const st = estado({
    compromisos: [{ name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '09:00', end: '18:00' }],
    excepciones: [{ id: 'x1', date: '2026-10-26', start: '10:00', end: '11:00', label: 'Cita médica', cat: 'otro' }],
  });
  const lista = L.itemsCalendario(st, { blocks: [] }, '2026-10-26');
  assert.deepEqual(lista.map(x => [x.label, L.fmt(x.s), L.fmt(x.e)]), [['Trabajo', '09:00', '18:00'], ['Cita médica', '10:00', '11:00']]);
  const g = L.gruposCruce(lista);
  assert.equal(g.length, 1);
  assert.equal(g[0].cols, 2);
});

test('itemsCalendario: lo que pasa la medianoche se corta a las 24:00 y sigue al día siguiente', () => {
  const st = estado({ compromisos: [{ name: 'Turno noche', type: 'trabajo', days: [1], start: '22:00', end: '06:00' }], ajustes: { sleep: '00:30' } });
  const P = { blocks: [{ evalId: 'e0', date: '2026-10-27', s: 1410, e: 1470 }] };   // martes de 23:30 a 00:30
  st.evals.push({ id: 'e0', type: 'parcial', course: 'Cálculo', date: '2026-10-30', time: '09:00', hours: 5 });
  const lun = L.itemsCalendario(st, P, '2026-10-26');
  assert.deepEqual(lun.map(x => [x.label, x.s, x.e]), [['Turno noche', 1320, 1440]]);
  const mar = L.itemsCalendario(st, P, '2026-10-27');
  assert.deepEqual(mar.map(x => [x.label, x.s, x.e]), [['Turno noche', 0, 360], ['Estudiar Cálculo', 1410, 1440]]);
  const mie = L.itemsCalendario(st, P, '2026-10-28');
  assert.deepEqual(mie.map(x => [x.label, x.s, x.e]), [['Estudiar Cálculo', 0, 30]]);
  assert.ok(mie[0].block && mie[0].block.date === '2026-10-27', 'el bloque sigue siendo el del martes (para tocarlo)');
});

test('ahora() de las pruebas sigue siendo un lunes (las fechas de arriba dependen de eso)', () => {
  assert.equal(ahora().getDay(), 1);
});
