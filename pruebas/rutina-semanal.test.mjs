// Un «evento semanal» es una rutina (iteración 3, revisión de Coconut del 4-nov-2026). «Crea un evento semanal de
// almuerzo, de lunes a viernes de 1:00 pm a 2:30 pm» antes anotaba solo el lunes, como algo de un solo día.
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora } from './logica.mjs';

const leer = (frase, s = estado()) => L.interpret(frase, s, ahora());
const rutina = r => { assert.equal(r.intent, 'add', JSON.stringify(r)); assert.equal(r.items.length, 1); return r.items[0]; };

test('la frase de la revisión: una rutina «Almuerzo» de lunes a viernes, de 13:00 a 14:30, en Comidas', () => {
  assert.ok(L.COMMIT_TYPES.comida, 'existe la categoría de comidas');
  assert.deepEqual(rutina(leer('Crea un evento semanal de almuerzo, de lunes a viernes de 1:00 pm a 2:30 pm')),
    { kind: 'commit', type: 'comida', name: 'Almuerzo', days: [1, 2, 3, 4, 5], start: '13:00', end: '14:30' });
});

// [frase, días]
const DIAS = [
  ['crea un evento semanal de almuerzo todos los días de semana de 1 a 2:30', [1, 2, 3, 4, 5]],
  ['almuerzo todos los días hábiles de 1 a 2:30', [1, 2, 3, 4, 5]],
  ['crea un evento semanal de almuerzo de lunes a jueves de 1 a 2:30', [1, 2, 3, 4]],
  ['crea un evento semanal de almuerzo lunes, miércoles y viernes de 1 a 2:30', [1, 3, 5]],
  ['crea un evento de almuerzo los sábados y domingos de 1 a 2:30', [6, 0]],
  ['evento semanal: almuerzo de lunes a viernes de 1 a 2:30', [1, 2, 3, 4, 5]],
];
for (const [frase, dias] of DIAS) {
  test(`días de una rutina: «${frase}»`, () => {
    const it = rutina(leer(frase));
    assert.deepEqual([it.type, it.name, it.days, it.start, it.end], ['comida', 'Almuerzo', dias, '13:00', '14:30']);
  });
}

test('parseDays(): «días de semana» y «días hábiles» son de lunes a viernes; «todos los días», toda la semana', () => {
  assert.deepEqual(L.parseDays('todos los dias de semana'), [1, 2, 3, 4, 5]);
  assert.deepEqual(L.parseDays('los dias habiles'), [1, 2, 3, 4, 5]);
  assert.deepEqual(L.parseDays('dias laborables'), [1, 2, 3, 4, 5]);
  assert.deepEqual(L.parseDays('todos los dias'), [0, 1, 2, 3, 4, 5, 6]);
});

test('una rutina con nombre propio: «reunión de equipo todos los martes»', () => {
  assert.deepEqual(rutina(leer('crea una rutina de reunión de equipo todos los martes de 9 a 10 de la noche')),
    { kind: 'commit', type: 'otro', name: 'Reunión de equipo', days: [2], start: '21:00', end: '22:00' });
  assert.deepEqual(rutina(leer('los jueves tengo cita con la psicóloga de 5 a 6')),
    { kind: 'commit', type: 'otro', name: 'Cita con la psicóloga', days: [4], start: '17:00', end: '18:00' });
  // Sin nombre: «Evento», con los días y las horas, solo si se pide crearla.
  assert.deepEqual(rutina(leer('crea un evento semanal de lunes a viernes de 7 a 8 de la noche')),
    { kind: 'commit', type: 'otro', name: 'Evento', days: [1, 2, 3, 4, 5], start: '19:00', end: '20:00' });
  assert.notEqual(leer('mi rutina de lunes a viernes es de 8 a 6').intent, 'add');
});

test('una rutina sin días pregunta los días; sin horas, el horario', () => {
  const sinDias = leer('crea un evento semanal de almuerzo de 1 a 2:30');
  assert.equal(sinDias.intent, 'pregunta');
  assert.equal(L.faltaDe(sinDias.borrador.items[0]), 'dias');
  const sinHoras = leer('crea un evento semanal de almuerzo de lunes a viernes');
  assert.equal(L.faltaDe(sinHoras.borrador.items[0]), 'horario');
});

test('una rutina con hora de inicio y sin fin: Lía pregunta hasta qué hora (no inventa la franja)', () => {
  const s = estado(), r = leer('cena todos los días a las 8 de la noche', s);
  assert.equal(r.intent, 'pregunta');
  const it = r.borrador.items[0];
  assert.deepEqual([it.kind, it.name, it.days, it.start, it.end], ['commit', 'Cena', [0, 1, 2, 3, 4, 5, 6], '20:00', '']);
  assert.equal(r.texto, '«Cena» empieza a las 20:00. ¿Hasta qué hora es?');
  assert.deepEqual(r.opciones.map(o => o.t), ['Hasta las 20:30', 'Hasta las 21:00', 'Hasta las 22:00', 'Otra hora']);
  const fin = L.respuestaBorrador(r.borrador, 'hasta las 9', s, ahora());
  assert.deepEqual(rutina(fin), { kind: 'commit', type: 'comida', name: 'Cena', days: [0, 1, 2, 3, 4, 5, 6], start: '20:00', end: '21:00' });
  // Con una parte del día y sin hora, sigue la franja del formulario.
  assert.deepEqual(rutina(leer('los martes juego fútbol en la tarde')).start, '14:00');
});

test('algo de un solo día sigue siendo de un solo día', () => {
  const r = leer('el sábado tengo un evento de 4 a 6');
  assert.equal(r.intent, 'except');
  assert.equal(r.exs[0].date, '2026-10-31');
  assert.deepEqual(leer('el lunes tengo una reunión de 1 a 2').exs[0], { date: '2026-11-02', start: '13:00', end: '14:00', label: 'Reunión', cat: 'otro' });
  assert.equal(leer('mañana almuerzo con mi familia de 1 a 3').intent, 'except');
  // «Los lunes» es todas las semanas.
  assert.deepEqual(rutina(leer('los lunes tengo reunión de equipo de 9 a 10')).days, [1]);
});
