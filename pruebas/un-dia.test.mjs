// Una rutina con un día concreto es algo de un solo día: «mañana tengo clase a las 4pm» no es una rutina semanal.
// Reportado por Coconut el 29-oct: Lía preguntaba «¿Qué días tienes clases?» y no lo guardaba.
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const base = () => estado({ compromisos: [{ name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '08:00', end: '13:00' }] });
const leer = (f, s = base()) => L.interpret(f, s, ahora());

test('«mañana tengo clase a las 4pm»: algo de mañana desde las 16:00 y Lía pregunta hasta qué hora', () => {
  const s = base(), r = leer('mañana tengo clase a las 4pm', s);
  assert.equal(r.intent, 'pregunta');
  assert.equal(r.texto, 'Anoto la clase de mañana a las 16:00. ¿Hasta qué hora es?');
  assert.deepEqual(r.opciones.map(o => o.t), ['Hasta las 17:00', 'Hasta las 18:00', 'Hasta las 19:00', 'Otra hora']);
  const it = r.borrador.items[0];
  assert.deepEqual([it.kind, it.date, it.start, it.end, it.label, it.cat], ['evento', '2026-10-27', '16:00', '', 'Clase', 'clase']);
  const b = { ...r.borrador, at: ahora().getTime() };
  for (const [resp, fin] of [['hasta las 6', '18:00'], ['a las 7', '19:00'], ['6 pm', '18:00'], ['hasta las 10 de la noche', '22:00']]) {
    const x = L.respuestaBorrador(b, resp, s, ahora());
    assert.equal(x.intent, 'except', resp);
    assert.deepEqual([x.ex.date, x.ex.start, x.ex.end, x.ex.label], ['2026-10-27', '16:00', fin, 'Clase'], resp);
  }
  // Una respuesta rápida también la completa.
  const rapida = L.continuarBorrador({ ...b, items: [{ ...b.items[0], ...r.opciones[1].set }] }, s, ahora());
  assert.deepEqual([rapida.intent, rapida.ex.start, rapida.ex.end], ['except', '16:00', '18:00']);
});

test('con el horario completo se anota de una vez', () => {
  const cases = [
    ['mañana tengo clase de 4 a 6 de la tarde', '2026-10-27', '16:00', '18:00', 'Clase'],
    ['el 5 de noviembre tengo clase de 3 a 5', '2026-11-05', '15:00', '17:00', 'Clase'],
    ['pasado mañana tengo taller de 6 a 8', '2026-10-28', '18:00', '20:00', 'Taller'],
    ['hoy tengo clase en la noche', '2026-10-26', '19:00', '23:00', 'Clase'],
  ];
  for (const [f, fecha, ini, fin, label] of cases) {
    const r = leer(f);
    assert.equal(r.intent, 'except', f);
    assert.deepEqual([r.ex.date, r.ex.start, r.ex.end, r.ex.label, !!r.ex.libre], [fecha, ini, fin, label, false], f);
  }
});

test('sin hora: Lía pregunta de qué hora a qué hora', () => {
  const r = leer('mañana tengo clase');
  assert.equal(r.intent, 'pregunta');
  assert.equal(r.texto, 'Anoto la clase de mañana. ¿De qué hora a qué hora es?');
});

test('si ese día ya tiene esa rutina a esa hora, lo dice y no anota nada', () => {
  const s = estado({ compromisos: [{ name: 'Clases', type: 'clase', days: [2], start: '14:00', end: '18:00' }] });
  const r = leer('mañana tengo clase a las 4pm', s);
  assert.equal(r.intent, 'aviso');
  assert.equal(r.texto, 'Martes 27 de octubre ya tienes Clases de 14:00 a 18:00 en tu horario.');
});

test('las rutinas semanales siguen siendo semanales', () => {
  for (const [f, dias] of [['clases de lunes a viernes de 8 a 1', LUN_A_VIE], ['el sábado tengo clase de 9 a 11', [6]], ['clases los lunes de 8 a 10', [1]], ['taller todos los martes de 6 a 8', [2]]]) {
    const r = leer(f);
    assert.equal(r.intent, 'add', f);
    assert.deepEqual(r.items[0].days, dias, f);
  }
});

test('un cambio del horario de siempre no se lee como algo nuevo', () => {
  assert.notEqual(leer('mañana entro a la chamba recién a las 5').intent, 'except');
  assert.equal(leer('mañana no tengo clases', estado({ compromisos: [{ name: 'Clases', type: 'clase', days: [2], start: '14:00', end: '18:00' }] })).intent, 'except');
  assert.equal(leer('tengo examen mañana a las 9').borrador.items[0].kind, 'eval');
});
