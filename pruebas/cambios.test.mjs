// Cambiar o quitar una evaluación que ya está desde el chat («me cambiaron el examen de cálculo al viernes»,
// «ya no tengo el parcial de física»). Antes Lía las leía como evaluaciones nuevas y las duplicaba.
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const conEvaluaciones = (extra = []) => estado({
  compromisos: [
    { name: 'Clases', type: 'clase', days: LUN_A_VIE, start: '08:00', end: '13:00' },
    { name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' },
  ],
  evaluaciones: [
    { course: 'Cálculo II', type: 'parcial', date: '2026-11-02', time: '10:00' },    // e0
    { course: 'Física', type: 'parcial', date: '2026-11-04', time: '18:00' },        // e1
    { course: 'Química', type: 'practica', date: '2026-11-03', time: '20:00' },      // e2
    { course: 'Informe de Economía', type: 'entrega', date: '2026-11-06', time: '23:59' }, // e3
    ...extra,
  ],
});
const leer = (frase, s = conEvaluaciones()) => L.interpret(frase, s, ahora());

// [frase, id, fecha nueva ('' = la misma), hora nueva ('' = la misma)]
const MOVER = [
  ['me cambiaron el examen de cálculo al viernes a las 8', 'e0', '2026-10-30', '08:00'],
  ['me cambiaron el parcial de cálculo para el 9 de noviembre', 'e0', '2026-11-09', ''],
  ['pasaron mi parcial de física para el 6 de noviembre', 'e1', '2026-11-06', ''],
  ['el parcial de física ahora es el viernes a las 6 de la tarde', 'e1', '2026-10-30', '18:00'],
  ['me cambiaron la hora del examen de cálculo a las 8 de la noche', 'e0', '', '20:00'],
  ['postergaron la pc de química al 10 de noviembre', 'e2', '2026-11-10', ''],
  ['me movieron la entrega del informe de economía al viernes 13 de noviembre', 'e3', '2026-11-13', ''],
  ['el examen de cálculo ya no es el lunes, es el martes a las 9', 'e0', '2026-10-27', '09:00'],
  ['cancelaron el parcial de física del miércoles y lo pasaron al jueves a las 10', 'e1', '2026-10-29', '10:00'],
];
for (const [frase, id, fecha, hora] of MOVER) {
  test(`cambiar: «${frase}»`, () => {
    const r = leer(frase);
    assert.equal(r.intent, 'cambiaEval', JSON.stringify(r));
    assert.deepEqual([r.evalId, r.date, r.time], [id, fecha, hora]);
  });
}

test('sin fecha nueva, Lía la pregunta y la respuesta completa el cambio', () => {
  const s = conEvaluaciones();
  const r = leer('me cambiaron el examen de cálculo', s);
  assert.equal(r.intent, 'pregunta');
  assert.equal(r.texto, '¿Para cuándo es ahora tu parcial de Cálculo II?');
  assert.equal(L.faltaDe(r.borrador.items[0]), 'fecha');
  assert.deepEqual(r.opciones.map(o => o.t), ['Mar 27', 'Mié 28', 'Jue 29', 'Otra fecha']);
  const b = { ...r.borrador, at: ahora().getTime() };
  const conFecha = L.respuestaBorrador(b, 'al viernes a las 8', s, ahora());
  assert.deepEqual([conFecha.intent, conFecha.evalId, conFecha.date, conFecha.time], ['cambiaEval', 'e0', '2026-10-30', '08:00']);
  const soloHora = L.respuestaBorrador(b, 'a las 8 de la noche', s, ahora());
  assert.deepEqual([soloHora.intent, soloHora.date, soloHora.time], ['cambiaEval', '', '20:00']);
  // Una respuesta rápida de fecha deja la hora de siempre.
  const rapida = L.continuarBorrador({ ...b, items: [{ ...b.items[0], date: '2026-10-28' }] }, s, ahora());
  assert.deepEqual([rapida.intent, rapida.date, rapida.time], ['cambiaEval', '2026-10-28', '']);
});

test('si la frase solo dice la fecha que ya tenía, pregunta la nueva', () => {
  for (const frase of ['me cambiaron el parcial del lunes', 'ya no es el lunes el examen de cálculo']) {
    const r = leer(frase);
    assert.equal(r.intent, 'pregunta', frase);
    assert.equal(r.borrador.items[0].evalId, 'e0', frase);
    assert.equal(L.faltaDe(r.borrador.items[0]), 'fecha', frase);
  }
});

test('«el cambio de fecha del examen de cálculo es el viernes»', () => {
  const r = leer('el cambio de fecha del examen de cálculo es el viernes');
  assert.deepEqual([r.intent, r.evalId, r.date], ['cambiaEval', 'e0', '2026-10-30']);
});

// [frase, id]
const QUITAR = [
  ['ya no tengo el parcial de física', 'e1'],
  ['cancelaron el examen de cálculo', 'e0'],     // «examen» vale para su parcial
  ['se canceló la pc de química', 'e2'],
  ['el parcial de física ya no va', 'e1'],
  ['borra la entrega del informe de economía', 'e3'],
  ['suspendieron el parcial del miércoles', 'e1'], // sin curso: por tipo y fecha
];
for (const [frase, id] of QUITAR) {
  test(`quitar: «${frase}»`, () => {
    const r = leer(frase);
    assert.deepEqual([r.intent, r.evalId], ['quitaEval', id], JSON.stringify(r));
  });
}

test('con dos evaluaciones posibles, Lía pregunta cuál con respuestas rápidas', () => {
  const s = conEvaluaciones([{ course: 'Química', type: 'practica', date: '2026-11-10', time: '20:00' }]);   // e4: PC2
  const r = leer('ya no tengo la pc de química', s);
  assert.equal(r.intent, 'pregunta');
  assert.equal(r.texto, '¿Cuál de estas evaluaciones quito?');
  assert.deepEqual(r.opciones.map(o => o.t), ['Práctica de Química · mar 3 nov', 'Práctica de Química · mar 10 nov']);
  const b = { ...r.borrador, at: ahora().getTime() };
  const elegida = L.continuarBorrador({ ...b, items: [{ ...b.items[0], ...r.opciones[1].set }] }, s, ahora());
  assert.deepEqual([elegida.intent, elegida.evalId], ['quitaEval', 'e4']);
  // También vale responder con palabras: «la del 10 de noviembre».
  const escrita = L.respuestaBorrador(b, 'la del 10 de noviembre', s, ahora());
  assert.deepEqual([escrita.intent, escrita.evalId], ['quitaEval', 'e4']);
});

test('si no encuentra la evaluación que se canceló, lo dice y no quita nada', () => {
  const r = leer('ya no tengo el parcial de historia');
  assert.equal(r.intent, 'aviso');
  assert.equal(r.texto, 'No encontré tu parcial de Historia entre tus evaluaciones próximas, así que no hay nada que quitar.');
});

test('una evaluación que ya pasó no se cambia ni se quita', () => {
  const s = conEvaluaciones([{ course: 'Historia', type: 'parcial', date: '2026-10-20', time: '10:00' }]);
  assert.equal(leer('ya no tengo el parcial de historia', s).intent, 'aviso');
});

test('si cambió una evaluación que no está registrada, se lee como nueva', () => {
  const r = leer('me cambiaron el examen de historia al viernes a las 9');
  assert.equal(r.intent, 'add');
  assert.deepEqual([r.items[0].course, r.items[0].date, r.items[0].time], ['Historia', '2026-10-30', '09:00']);
});

// Frases que se parecen pero no cambian una evaluación: deben seguir como antes.
const NO_SON = [
  ['ya no tengo tiempo para el examen de cálculo', null],
  ['tengo examen de cálculo el lunes y me cambiaron el turno', null],
  ['estudié 2 horas para el examen que me cambiaron', 'pregunta'],   // «¿Para qué evaluación estudiaste?», como antes
  ['cancelaron mi clase de mañana', 'except'],
  ['me cambiaron el horario de clases, ahora entro a las 9', null],
  ['¿qué pasa si no estudio para el examen de cálculo?', null],
  ['tengo parcial de estadística el viernes a las 10', 'add'],
];
for (const [frase, esperada] of NO_SON) {
  test(`no es un cambio: «${frase}»`, () => {
    const s = conEvaluaciones();
    assert.equal(L.cambioDeEval(frase, s, ahora()), null);
    const r = leer(frase, s);
    assert.ok(!['cambiaEval', 'quitaEval'].includes(r.intent), JSON.stringify(r));
    if (esperada) assert.equal(r.intent, esperada);
  });
}
