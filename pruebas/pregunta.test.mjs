// Lía pide lo que falta (iteración 2): una pregunta a la vez, con respuestas rápidas, y un borrador de 10 minutos.
// Nada se guarda sin hora (decisión 4 del 28-oct).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const st = () => estado({
  compromisos: [{ name: 'Trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' }],
  evaluaciones: [{ course: 'Cálculo II', date: '2026-10-29', hours: 5 }, { course: 'Física', type: 'practica', date: '2026-11-03', time: '19:00', hours: 3 }],
});
const n = ahora();  // lunes 26 de octubre, 10:00
// Conversa: la primera frase y luego las respuestas escritas. Devuelve cada paso.
function charla(...frases) {
  const s = st(), pasos = [];
  let r = L.interpret(frases[0], s, n); pasos.push(r);
  for (const q of frases.slice(1)) { r = L.respuestaBorrador(r.borrador, q, s, n); pasos.push(r); if (!r) break; }
  return pasos;
}
const fin = pasos => pasos[pasos.length - 1];

// [lo que cuentas, lo que Lía pregunta, sus respuestas rápidas]
const PREGUNTAS = [
  ['tengo examen el viernes', '¿De qué curso es tu examen del viernes?', ''],
  ['tengo examen de inglés', '¿Qué día es tu examen de Inglés?', 'Mar 27|Mié 28|Jue 29|Otra fecha'],
  ['parcial de cálculo el jueves', '¿A qué hora es tu parcial de Cálculo del jueves?', '08:00|14:00|19:00|Otra hora'],
  ['informe de química para el viernes', '¿A qué hora vence tu informe de Química?', '23:59|Otra hora'],
  ['tengo una tarea de algoritmos', '¿Para qué día es tu tarea de Algoritmos?', 'Mar 27|Mié 28|Jue 29|Otra fecha'],
  ['voy al gimnasio de 7 a 9', '¿Qué días tienes gimnasio?', 'Lun a Vie|Fines de semana|Otros días'],
  ['tengo clases los martes y jueves', '¿De qué hora a qué hora tienes clases?', 'Mañana (08:00–12:00)|Tarde (14:00–18:00)|Noche (19:00–22:00)|Otra hora'],
  ['el sábado tengo un cumpleaños', 'Anoto el cumpleaños del sábado. ¿De qué hora a qué hora es?', 'Tarde (15:00–19:00)|Noche (19:00–23:00)|Otra hora'],
  ['mañana tengo una cita', 'Anoto la cita de mañana. ¿De qué hora a qué hora es?', 'Tarde (15:00–19:00)|Noche (19:00–23:00)|Otra hora'],
  ['tengo una reunión', '¿Qué día es la reunión?', 'Mar 27|Mié 28|Jue 29|Otra fecha'],
  ['ayer estudié 2 horas', '¿Para qué evaluación estudiaste?', 'Parcial de Cálculo II|Práctica de Física'],
  ['estudié física', '¿Cuánto tiempo estudiaste para Física?', '30 min|1 h|2 h|Otro'],
];
for (const [frase, pregunta, rapidas] of PREGUNTAS) {
  test(`«${frase}» → «${pregunta}»`, () => {
    const r = L.interpret(frase, st(), n);
    assert.equal(r.intent, 'pregunta', JSON.stringify(r));
    assert.equal(r.texto, pregunta);
    assert.equal(r.opciones.map(o => o.t).join('|'), rapidas);
  });
}

test('lo que se dice con una parte del día ya tiene horario: no pregunta', () => {
  const ev = L.interpret('el sábado en la noche tengo un cumpleaños', st(), n);
  assert.deepEqual([ev.intent, ev.ex.start, ev.ex.end, ev.ex.cat], ['except', '19:00', '23:00', 'ocio']);
  const ru = L.interpret('gimnasio los martes por la tarde', st(), n);
  assert.deepEqual([ru.intent, ru.items[0].start, ru.items[0].end], ['add', '14:00', '18:00']);
});

test('las respuestas escritas completan el borrador, una pregunta a la vez', () => {
  assert.equal(fin(charla('tengo examen el viernes', 'es de estadística')).texto, '¿A qué hora es tu examen de Estadística del viernes?');
  let p = charla('tengo examen el viernes', 'de estadística', 'a las 10');
  assert.equal(p[1].texto, '¿A qué hora es tu examen de Estadística del viernes?');
  assert.deepEqual(fin(p).items, [{ kind: 'eval', type: 'examen', course: 'Estadística', date: '2026-10-30', time: '10:00', hours: 5 }]);
  p = charla('tengo examen de inglés', 'el jueves a las 9');  // una respuesta con dos datos
  assert.deepEqual([fin(p).intent, fin(p).items[0].date, fin(p).items[0].time], ['add', '2026-10-29', '09:00']);
  p = charla('el sábado tengo un cumpleaños', 'de 4 a 8');
  assert.deepEqual(fin(p).exs, [{ date: '2026-10-31', start: '16:00', end: '20:00', label: 'Cumpleaños', cat: 'ocio' }]);
  p = charla('tengo un cumpleaños', 'el sábado en la noche');
  assert.deepEqual([fin(p).ex.date, fin(p).ex.start, fin(p).ex.end], ['2026-10-31', '19:00', '23:00']);
  p = charla('voy al gimnasio de 7 a 9', 'martes y jueves');
  assert.deepEqual(fin(p).items[0].days, [2, 4]);
  p = charla('ayer estudié 2 horas', 'de cálculo');
  assert.deepEqual(fin(p), { intent: 'log', evalId: 'e0', course: 'Cálculo II', date: '2026-10-25', min: 120 });
  p = charla('informe de química para el viernes', 'a medianoche');
  assert.equal(fin(p).items[0].time, '23:59');
  p = charla('mañana tengo una cita', 'a las 5');  // una sola hora: una hora de duración
  assert.deepEqual([fin(p).ex.start, fin(p).ex.end], ['17:00', '18:00']);
});

test('una respuesta rápida completa el borrador sin volver a leer el texto', () => {
  const s = st(), r = L.interpret('parcial de cálculo el jueves', s, n), o = r.opciones[2];
  const b = { ...r.borrador, items: r.borrador.items.map((x, k) => (k === r.borrador.i ? { ...x, ...o.set } : x)) };
  assert.deepEqual(L.continuarBorrador(b, s, n).items[0].time, '19:00');
  assert.deepEqual(r.opciones.at(-1), { t: 'Otra hora', otra: true, ph: 'Escribe la hora, por ejemplo: a las 7 de la noche' });
});

test('si responde otra cosa, el borrador queda de lado; si no se entiende, no se completa', () => {
  const s = st(), r = L.interpret('parcial de cálculo el jueves', s, n);
  assert.equal(L.respuestaBorrador(r.borrador, 'trabajo de lunes a viernes de 3 a 7', s, n), null);
  assert.equal(L.respuestaBorrador(r.borrador, 'el sábado tengo un cumpleaños', s, n), null);
  assert.equal(L.respuestaBorrador(r.borrador, 'no sé', s, n), null);
  // Para «¿De qué curso?», una entrega con nombre sí es la respuesta.
  const e = L.interpret('tengo una entrega el viernes', s, n);
  assert.equal(L.respuestaBorrador(e.borrador, 'del informe de química', s, n).texto, '¿A qué hora vence tu informe de química?');
});

test('varias cosas en una frase: pregunta lo de cada una, en orden', () => {
  const p = charla('parcial de Contabilidad I y final de Economía el viernes', 'a las 9', 'a las 11');
  assert.equal(p[1].texto, '¿A qué hora es tu final de Economía del viernes?');
  assert.deepEqual(fin(p).items.map(i => [i.course, i.date, i.time]), [['Contabilidad I', '2026-10-30', '09:00'], ['Economía', '2026-10-30', '11:00']]);
});

test('los horarios de una misma rutina comparten los días que se dicen al final', () => {
  const r = L.interpret('trabajo de 8 a 12 y de 2 a 6 de lunes a viernes', st(), n);
  assert.deepEqual(r.items.map(i => [i.days.join(), i.start, i.end]), [['1,2,3,4,5', '08:00', '12:00'], ['1,2,3,4,5', '14:00', '18:00']]);
});

test('el borrador vale 10 minutos', () => {
  const b = { intent: 'add', items: [{ kind: 'eval', type: 'parcial', course: 'X', date: '2026-10-29', time: '' }], i: 0, at: n.getTime() };
  assert.equal(L.borradorVigente(b, new Date(n.getTime() + 9 * 60000)), true);
  assert.equal(L.borradorVigente(b, new Date(n.getTime() + 11 * 60000)), false);
  assert.equal(L.borradorVigente({ ...b, items: 'x' }, n), false);
  assert.equal(L.borradorVigente(null, n), false);
});

test('sin evaluaciones, «estudié 2 horas» no pregunta por una que no existe', () => {
  const r = L.interpret('ayer estudié 2 horas', estado(), n);
  assert.equal(r.intent, 'aviso');
});
