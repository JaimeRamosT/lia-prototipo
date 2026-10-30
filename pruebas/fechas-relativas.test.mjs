// Fechas dichas desde hoy: «en 2 semanas», «dentro de 10 días», «en un mes», «el lunes dentro de 3 semanas»,
// «el miércoles de la próxima semana». Pedido de Coconut el 29-oct.
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const base = () => estado({ compromisos: [{ name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '08:00', end: '13:00' }] });
const leer = (f, s = base()) => L.interpret(f, s, ahora());
const item = r => r.borrador?.items?.[r.borrador.i] || r.items?.[0] || r.ex;

test('evaluaciones en N semanas, días o meses', () => {
  const cases = [
    ['tengo examen de cálculo dentro de dos semanas a las 9', '2026-11-09', 'Cálculo'],
    ['el lunes dentro de 3 semanas tengo parcial de física a las 10', '2026-11-16', 'Física'],
    ['en 2 semanas el sábado tengo examen de cálculo a las 9', '2026-11-14', 'Cálculo'],
    ['dentro de 2 semanas el lunes tengo parcial de física a las 10', '2026-11-09', 'Física'],
    ['en un mes tengo examen de inglés a las 8', '2026-11-26', 'Inglés'],
    ['el miércoles de la próxima semana tengo examen de cálculo a las 9', '2026-11-04', 'Cálculo'],
    ['el martes de la semana que viene tengo pc de química a las 7 pm', '2026-11-03', 'Química'],
  ];
  for (const [f, fecha, curso] of cases) {
    const r = leer(f);
    assert.equal(r.intent, 'add', f);
    assert.deepEqual([r.items[0].date, r.items[0].course], [fecha, curso], f);
  }
});

test('sin hora, Lía pregunta la hora con la fecha ya puesta', () => {
  for (const [f, fecha, txt] of [
    ['tengo examen de cálculo en 2 semanas', '2026-11-09', '¿A qué hora es tu examen de Cálculo del lun 9 nov?'],
    ['faltan 3 semanas para mi final de cálculo', '2026-11-16', '¿A qué hora es tu final de Cálculo del lun 16 nov?'],
  ]) {
    const r = leer(f);
    assert.equal(r.intent, 'pregunta', f);
    assert.equal(r.texto, txt, f);
    assert.equal(item(r).date, fecha, f);
  }
  assert.equal(item(leer('dentro de 10 días entrego el informe de química')).date, '2026-11-05');
});

test('eventos y clases de un día en N semanas', () => {
  for (const [f, fecha, ini, fin, label] of [
    ['este mismo día en 2 semanas tengo una cita a las 4 pm', '2026-11-09', '16:00', '17:00', 'Cita'],
    ['dentro de una semana el viernes tengo fiesta de 8 a 11 de la noche', '2026-11-06', '20:00', '23:00', 'Fiesta'],
    ['en 2 semanas tengo clase de 3 a 5', '2026-11-09', '15:00', '17:00', 'Clase'],
  ]) {
    const r = leer(f);
    assert.equal(r.intent, 'except', f);
    assert.deepEqual([r.ex.date, r.ex.start, r.ex.end, r.ex.label], [fecha, ini, fin, label], f);
  }
  const ag = leer('¿qué tengo en 2 semanas?');
  assert.deepEqual([ag.intent, ag.date], ['agenda', '2026-11-09']);
});

test('«la próxima semana» sin día: Lía pregunta qué día de esa semana', () => {
  const s = base(), r = leer('la próxima semana tengo examen de historia', s);
  assert.equal(r.intent, 'pregunta');
  assert.equal(r.texto, '¿Qué día de la próxima semana es tu examen de Historia?');
  assert.deepEqual(r.opciones.map(o => o.t), ['Lun 2', 'Mar 3', 'Mié 4', 'Jue 5', 'Vie 6', 'Sáb 7', 'Otra fecha']);
  const b = { ...r.borrador, at: ahora().getTime() };
  // «El miércoles» es el de la próxima semana, no el de esta (hoy es lunes).
  const x = L.respuestaBorrador(b, 'el miércoles', s, ahora());
  assert.equal(item(x).date, '2026-11-04');
  // Una fecha con número se respeta tal cual.
  assert.equal(item(L.respuestaBorrador(b, 'el 10', s, ahora())).date, '2026-11-10');
  // Con un botón y la hora, la evaluación se guarda sin datos de más.
  const conDia = L.continuarBorrador({ ...b, items: [{ ...b.items[0], ...r.opciones[3].set }] }, s, ahora());
  const fin = L.respuestaBorrador({ ...conDia.borrador, at: ahora().getTime() }, 'a las 9', s, ahora());
  assert.equal(fin.intent, 'add');
  assert.deepEqual([fin.items[0].date, fin.items[0].time, 'semana' in fin.items[0]], ['2026-11-05', '09:00', false]);
});

test('lo que no es una fecha desde hoy', () => {
  const n = ahora();
  for (const f of ['en 2 horas', 'hace 2 semanas', 'en 20 semanas', 'estudie 2 dias', 'la proxima semana'])
    assert.equal(L.fechaRelativa(f, n), null, f);
  assert.notEqual(leer('cada 2 semanas tengo taller de 4 a 6').intent, 'except');
  // Fin de mes: «en un mes» desde el 31 de enero es el último día de febrero.
  assert.equal(L.fechaRelativa('en un mes', new Date(2027, 0, 31, 10)), '2027-02-28');
});
