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

// Evaluaciones y entregas. Sin hora, Lía la pregunta (decisión 4): ni 09:00 ni 23:59 por su cuenta.
const EVALS = [
  ['trabajo final de marketing para el viernes', 'entrega', 'Trabajo final de Marketing', '2026-10-30', 'hora'],
  ['informe de laboratorio el jueves', 'entrega', 'Informe de Laboratorio', '2026-10-29', 'hora'],
  ['proyecto de software el 20/11', 'entrega', 'Proyecto de Software', '2026-11-20', 'hora'],
  ['monografía de historia para el 5 de noviembre', 'entrega', 'Monografía de Historia', '2026-11-05', 'hora'],
  ['tarea de algoritmos para el domingo', 'entrega', 'Tarea de Algoritmos', '2026-11-01', 'hora'],
  ['entrego el informe de Marketing el viernes', 'entrega', 'Informe de Marketing', '2026-10-30', 'hora'],
  ['tengo examen de estadística el lunes', 'examen', 'Estadística', '2026-11-02', 'hora'],
  ['parcial de Cálculo el jueves a las 9', 'parcial', 'Cálculo', '2026-10-29', null],
  ['entrego el ensayo de filosofía el viernes a medianoche', 'entrega', 'Ensayo de Filosofía', '2026-10-30', null],
];
const itemDe = r => (r.intent === 'add' ? r.items[0] : r.borrador.items[r.borrador.i]);
for (const [frase, tipo, curso, fecha, falta] of EVALS) {
  test(`evaluación: «${frase}» → ${tipo} «${curso}»${falta ? `, pregunta la ${falta}` : ''}`, () => {
    const r = L.interpret(frase, estado(), ahora());
    assert.equal(r.intent, falta ? 'pregunta' : 'add');
    const it = itemDe(r);
    assert.deepEqual([it.kind, it.type, it.course, it.date, L.faltaDe(it)], ['eval', tipo, curso, fecha, falta]);
  });
}
test('«el otro jueves» es el de la semana siguiente', () => {
  assert.equal(itemDe(L.interpret('el otro jueves entrego el ensayo de filosofía', estado(), ahora())).date, '2026-11-05');
  assert.equal(itemDe(L.interpret('el jueves entrego el ensayo de filosofía', estado(), ahora())).date, '2026-10-29');
});
test('dos evaluaciones en una frase comparten la fecha (y Lía pregunta la hora de cada una)', () => {
  const r = L.interpret('parcial de Contabilidad I y final de Economía el viernes', estado(), ahora());
  assert.deepEqual(r.borrador.items.map(i => [i.type, i.course, i.date]), [['parcial', 'Contabilidad I', '2026-10-30'], ['final', 'Economía', '2026-10-30']]);
  assert.equal(r.texto, '¿A qué hora es tu parcial de Contabilidad I del viernes?');
});
test('parcial y entrega en la misma frase: pregunta solo lo que le falta a la entrega', () => {
  const r = L.interpret('tengo parcial de cálculo el jueves 9am y entrego el informe el viernes', estado(), ahora());
  assert.deepEqual(r.borrador.items.map(i => [i.type, i.course, i.date, i.time]), [['parcial', 'Cálculo', '2026-10-29', '09:00'], ['entrega', 'Informe', '2026-10-30', '']]);
  assert.deepEqual([r.borrador.i, r.texto], [1, '¿A qué hora vence tu informe?']);
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

// Estudio que ya hiciste
for (const [frase, evalId, fecha, min] of [
  ['ayer estudié 2 horas de cálculo', 'e0', '2026-10-25', 120],
  ['hoy repasé media hora de física', 'e1', '2026-10-26', 30],
  ['estudié una hora y media de cálculo', 'e0', '2026-10-26', 90],
  ['ayer estudié 45 minutos de Física II', 'e1', '2026-10-25', 45],
]) {
  test(`estudio hecho: «${frase}» → ${min} min`, () => {
    const r = L.interpret(frase, EJEMPLO(), ahora());
    assert.equal(r.intent, 'log');
    assert.deepEqual([r.evalId, r.date, r.min, r.error], [evalId, fecha, min, undefined]);
  });
}
test('«ayer estudié 2 horas» sin decir de qué pregunta por la evaluación, con las próximas como respuestas rápidas', () => {
  const r = L.interpret('ayer estudié 2 horas', EJEMPLO(), ahora());
  assert.deepEqual([r.intent, r.texto], ['pregunta', '¿Para qué evaluación estudiaste?']);
  assert.deepEqual(r.opciones.map(o => o.t), ['Parcial de Cálculo II', 'Práctica de Física II']);
  assert.deepEqual(r.borrador.items[0], { kind: 'log', evalId: '', course: '', date: '2026-10-25', min: 120 });
});
test('«estudié para el parcial de cálculo» sin decir cuánto pregunta el tiempo (no crea otro parcial)', () => {
  const r = L.interpret('estudié para el parcial de cálculo', EJEMPLO(), ahora());
  assert.deepEqual([r.intent, r.texto], ['pregunta', '¿Cuánto tiempo estudiaste para Cálculo II?']);
});

// ---------- Categorías de rutinas (iteración 2) ----------
for (const [frase, tipo, nombre, ini, fin, dias] of [
  ['almuerzo de lunes a viernes de 1 a 2', 'comida', 'Almuerzo', '13:00', '14:00', [1, 2, 3, 4, 5]],
  ['gimnasio martes y jueves de 7 a 8 de la noche', 'deporte', 'Gimnasio', '19:00', '20:00', [2, 4]],
  ['voy a un curso de inglés los sábados de 9 a 12', 'curso', 'Curso de inglés', '09:00', '12:00', [6]],
  ['siesta de lunes a viernes de 3 a 4', 'ocio', 'Siesta', '15:00', '16:00', [1, 2, 3, 4, 5]],
  ['cuido a mi hermano los martes de 5 a 7', 'casa', 'Cuidar a la familia', '17:00', '19:00', [2]],
  ['tomo el bus de lunes a viernes de 7 a 8 de la mañana', 'traslado', 'Traslado', '07:00', '08:00', [1, 2, 3, 4, 5]],
  ['fútbol los domingos de 10 a 12', 'deporte', 'Fútbol', '10:00', '12:00', [0]],
]) {
  test(`categoría: «${frase}» → ${tipo} «${nombre}»`, () => {
    const r = L.interpret(frase, estado(), ahora());
    assert.equal(r.intent, 'add', JSON.stringify(r));
    const it = r.items[0];
    assert.deepEqual([it.kind, it.type, it.name, it.start, it.end, it.days, it.error], ['commit', tipo, nombre, ini, fin, dias, undefined]);
  });
}
test('«hoy no voy al gimnasio» libera la rutina por su nombre aunque sea de otra categoría', () => {
  const st = estado({ compromisos: [{ name: 'Gym', type: 'deporte', days: LUN_A_VIE, start: '20:00', end: '21:00' }, { name: 'Gimnasio', type: 'otro', days: LUN_A_VIE, start: '06:00', end: '07:00' }] });
  const r = L.interpret('hoy no voy al gimnasio', st, ahora());
  assert.equal(r.intent, 'except');
  assert.deepEqual(r.exs.map(x => x.ref), ['c1']);
});
test('«hoy no voy al fútbol» sin una rutina con ese nombre libera la de su categoría', () => {
  const st = estado({ compromisos: [{ name: 'Pichanga', type: 'deporte', days: LUN_A_VIE, start: '20:00', end: '21:00' }] });
  const r = L.interpret('hoy no voy al fútbol', st, ahora());
  assert.equal(r.intent, 'except');
  assert.deepEqual(r.exs.map(x => [x.ref, x.label]), [['c0', 'Sin Pichanga']]);
});
test('tipoPorNombre(): la categoría que sugiere el nombre de una rutina', () => {
  assert.equal(L.tipoPorNombre('Almuerzo'), 'comida');
  assert.equal(L.tipoPorNombre('Gimnasio Smart Fit'), 'deporte');
  assert.equal(L.tipoPorNombre('Inglés en el ICPNA'), 'curso');
  assert.equal(L.tipoPorNombre('Reunión del grupo'), null);
  assert.equal(L.tipoPorNombre(''), null);
});
test('un tipo de rutina que la app no conoce se trata como «Otro»', () => {
  assert.equal(L.tipoRutina('submarinismo'), 'otro');
  assert.equal(L.tipoRutina('comida'), 'comida');
  const st = estado({ compromisos: [{ name: 'Algo nuevo', type: 'submarinismo', days: LUN_A_VIE, start: '20:00', end: '21:00' }] });
  assert.equal(L.busyFor(st, '2026-10-26')[0].kind, 'otro');
});
