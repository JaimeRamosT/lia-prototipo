// Lectura de frases: interpret() convierte lo que escribe la persona en horarios, evaluaciones o cambios del día.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

// Horarios fijos: [frase, inicio, fin, días]
const HORARIOS = [
  ['trabajo de lunes a viernes de 10 de la noche a 6 de la mañana', '22:00', '06:00', [1, 2, 3, 4, 5]],
  ['trabajo de 10pm a 6am de lunes a viernes', '22:00', '06:00'],
  ['trabajo de lunes a viernes de 22 a 6', '22:00', '06:00'],
  ['clases los martes y jueves de 6:30 a 10:30 pm', '18:30', '22:30', [2, 4]],
  ['voy al gym lunes miércoles y viernes de 5 a 7 am', '05:00', '07:00', [1, 3, 5]],
  ['trabajo de 9 a 6 de lunes a viernes', '09:00', '18:00'],
  ['trabajo de lunes a viernes de 3 a 9 de la noche', '15:00', '21:00'],
  ['tengo clases lunes miércoles y viernes de 7 a 10 de la noche', '19:00', '22:00'],
  ['trabajo los sábados de 6 a 2', '06:00', '14:00', [6]],
  ['clases de lunes a viernes de 8 a 1', '08:00', '13:00'],
  ['trabajo de lunes a viernes de 4 a 12', '16:00', '00:00'],
  ['trabajo de 8am a 5pm de lunes a sábado', '08:00', '17:00', [1, 2, 3, 4, 5, 6]],
  ['turno de 6 a 8 de la mañana los domingos', '06:00', '08:00', [0]],
  ['trabajo de lunes a viernes de 3 a 7', '15:00', '19:00'],
];
for (const [frase, ini, fin, dias] of HORARIOS) {
  test(`horario: «${frase}» → ${ini}–${fin}`, () => {
    const r = L.interpret(frase, estado(), ahora());
    assert.equal(r.intent, 'add');
    const it = r.items[0];
    assert.equal(it.error, undefined, it.error);
    assert.equal(it.kind, 'commit');
    assert.equal(it.start, ini);
    assert.equal(it.end, fin);
    if (dias) assert.deepEqual(it.days, dias);
  });
}

test('una excepción de noche guarda el fin al día siguiente', () => {
  const r = L.interpret('hoy no puedo de 10 de la noche a 2 de la madrugada', estado(), ahora());
  assert.equal(r.intent, 'except');
  assert.equal(r.ex.start, '22:00');
  assert.equal(r.ex.end, '02:00');
});

test('«libera mi sábado» con hora de dormir 00:30 bloquea hasta las 00:30', () => {
  const r = L.interpret('libera mi sábado', estado({ ajustes: { sleep: '00:30' } }), ahora());
  assert.equal(r.intent, 'except');
  assert.equal(r.ex.date, '2026-10-31');
  assert.equal(r.ex.start, '07:00');
  assert.equal(r.ex.end, '00:30');
});

test('evaluación a las 7 de la noche', () => {
  const r = L.interpret('pc2 de Física el miércoles a las 7 de la noche', estado(), ahora());
  assert.equal(r.items[0].time, '19:00');
  assert.equal(r.items[0].date, '2026-10-28');
});

// ---------- Horario de ejemplo para los cambios del día ----------
const EJEMPLO = () => estado({
  compromisos: [
    { name: 'Clases en la U', type: 'clase', days: LUN_A_VIE, start: '08:00', end: '13:00' },
    { name: 'Trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' },
    { name: 'Trabajo', days: [6], start: '09:00', end: '13:00' },
    { name: 'Gimnasio', type: 'otro', days: [1, 3, 5], start: '20:00', end: '21:00' },
  ],
  evaluaciones: [{ course: 'Cálculo II', date: '2026-10-29', hours: 5 }, { course: 'Física II', type: 'practica', date: '2026-11-02', time: '14:00', hours: 3 }],
});
const cambio = (frase, cuando = ahora()) => { const r = L.interpret(frase, EJEMPLO(), cuando); assert.equal(r.intent, 'except', JSON.stringify(r)); return r.exs; };

// Salir más tarde o más temprano del trabajo: la hora se entiende según el horario de ese día.
const SALIDAS = [
  ['hoy salgo del trabajo a las 9', ahora(26, 7, 30), '2026-10-26', '19:00', '21:00'],
  ['mañana salgo del trabajo a las 10', ahora(), '2026-10-27', '19:00', '22:00'],
  ['hoy me quedo hasta las 10 en el trabajo', ahora(26, 7, 30), '2026-10-26', '19:00', '22:00'],
  ['hoy salgo del trabajo a la 1 de la mañana', ahora(), '2026-10-26', '19:00', '01:00'],
  ['el sábado salgo del trabajo a las 3', ahora(), '2026-10-31', '13:00', '15:00'],
];
for (const [frase, cuando, fecha, ini, fin] of SALIDAS) {
  test(`cambio: «${frase}» → ${fecha} ${ini}–${fin}`, () => {
    const [ex] = cambio(frase, cuando);
    assert.deepEqual([ex.date, ex.start, ex.end, !!ex.libre], [fecha, ini, fin, false]);
  });
}
test('«hoy salgo temprano del trabajo, a las 5» libera de 17:00 a 19:00', () => {
  const [ex] = cambio('hoy salgo temprano del trabajo, a las 5');
  assert.deepEqual([ex.date, ex.start, ex.end, ex.libre, ex.ref], ['2026-10-26', '17:00', '19:00', true, 'c1']);
});

// Una parte del día ocupada
for (const [frase, fecha, ini, fin] of [
  ['mañana no puedo estudiar en la tarde', '2026-10-27', '12:00', '19:00'],
  ['hoy no puedo en la noche', '2026-10-26', '19:00', '23:00'],
  ['el viernes estoy ocupado en la mañana', '2026-10-30', '07:00', '12:00'],
]) {
  test(`parte del día: «${frase}» → ${ini}–${fin}`, () => {
    const [ex] = cambio(frase);
    assert.deepEqual([ex.date, ex.start, ex.end], [fecha, ini, fin]);
  });
}

// Un compromiso que ese día no va: se libera solo esa vez
for (const [frase, fecha, ref, ini, fin] of [
  ['cancelaron mi clase de mañana', '2026-10-27', 'c0', '08:00', '13:00'],
  ['mañana no tengo clases', '2026-10-27', 'c0', '08:00', '13:00'],
  ['hoy no voy a trabajar', '2026-10-26', 'c1', '15:00', '19:00'],
  ['el viernes no hay clases', '2026-10-30', 'c0', '08:00', '13:00'],
  ['hoy no voy al gimnasio', '2026-10-26', 'c3', '20:00', '21:00'],
]) {
  test(`libre: «${frase}»`, () => {
    const [ex] = cambio(frase);
    assert.deepEqual([ex.date, ex.ref, ex.start, ex.end, ex.libre], [fecha, ref, ini, fin, true]);
  });
}
test('«no tengo clases el domingo» avisa que ese día no hay clases', () => {
  const r = L.interpret('no tengo clases el domingo', EJEMPLO(), ahora());
  assert.equal(r.intent, 'aviso');
  assert.match(r.texto, /no tienes clases/i);
});

// Compromisos de un solo día
for (const [frase, fecha, ini, fin, nombre] of [
  ['el sábado tengo un cumpleaños de 4 a 9', '2026-10-31', '16:00', '21:00', 'Cumpleaños'],
  ['mañana tengo cita médica de 10 a 12', '2026-10-27', '10:00', '12:00', 'Cita médica'],
]) {
  test(`un día: «${frase}»`, () => {
    const [ex] = cambio(frase);
    assert.deepEqual([ex.date, ex.start, ex.end, ex.label], [fecha, ini, fin, nombre]);
  });
}

