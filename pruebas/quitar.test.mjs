// Quitar lo que hay un día a una hora (iteración 3, revisión de Coconut del 4-nov-2026). «Elimina el evento del lunes
// a la 1:00 pm» antes creaba un evento nuevo. Ahora Lía busca lo que hay ese día a esa hora y propone quitarlo:
// - un evento de un día se quita (quitaEvento, con confirmación);
// - una rutina pregunta si se quita solo ese día (se libera, como «no tengo clases mañana») o toda la rutina;
// - si no hay nada a esa hora, lo dice. Nunca crea nada.
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const RUTINAS = [
  { id: 'c1', name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' },
  { id: 'c2', name: 'Clases', type: 'clase', days: LUN_A_VIE, start: '08:00', end: '12:00' },
];
const ALMUERZO = { id: 'c3', name: 'Almuerzo', type: 'comida', days: LUN_A_VIE, start: '13:00', end: '14:30' };
const EVENTOS = [
  { id: 'x1', date: '2026-10-29', start: '10:00', end: '11:00', label: 'Reunión de grupo', cat: 'otro' },     // jueves, en medio de Clases
  { id: 'x2', date: '2026-10-27', start: '20:00', end: '21:00', label: 'Cita con el dentista', cat: 'otro' },  // martes en la noche
];
const base = ({ almuerzo = true, eventos = EVENTOS, extra = [] } = {}) => estado({
  compromisos: [...RUTINAS, ...(almuerzo ? [ALMUERZO] : []), ...extra],
  excepciones: eventos,
  evaluaciones: [{ id: 'e1', type: 'parcial', course: 'Cálculo II', date: '2026-10-29', time: '16:00' }],
});
const leer = (frase, s = base(), n = ahora()) => L.interpret(frase, s, n);
// Toca la respuesta rápida k, como la app (acciones.rapida).
const elegir = (r, k, s = base(), n = ahora()) => {
  const o = r.opciones[k];
  return L.continuarBorrador({ ...r.borrador, items: r.borrador.items.map((x, j) => (j === r.borrador.i ? { ...x, ...o.set } : x)) }, s, n);
};
const falta = r => (r.intent === 'pregunta' ? L.faltaDe(r.borrador.items[r.borrador.i]) : null);

test('la frase de la revisión con una rutina a esa hora: pregunta si solo ese lunes o toda la rutina', () => {
  const r = leer('Elimina el evento del lunes a la 1:00 pm');
  assert.equal(r.intent, 'pregunta', JSON.stringify(r));
  assert.equal(falta(r), 'alcance');
  assert.equal(r.texto, '«Almuerzo» es una rutina de lunes a viernes, de 13:00 a 14:30. ¿La quito solo el lunes 2 o toda la rutina?');
  assert.deepEqual(r.opciones.map(o => o.t), ['Solo el lun 2', 'Toda la rutina', 'Dejarlo así']);
  // Solo ese lunes: se libera ese día, como «el lunes no tengo almuerzo».
  const dia = elegir(r, 0);
  assert.equal(dia.intent, 'except');
  assert.deepEqual(dia.exs, [{ date: '2026-11-02', start: '13:00', end: '14:30', label: 'Sin Almuerzo', libre: true, ref: 'c3' }]);
  // Toda la rutina: la app pide confirmar antes de borrarla.
  assert.deepEqual(elegir(r, 1), { intent: 'quitaRutina', ids: ['c3'], name: 'Almuerzo' });
  assert.deepEqual(elegir(r, 2), { intent: 'aviso', texto: 'Listo, lo dejo como está.' });
});

test('la respuesta escrita también vale: «solo ese día», «toda la rutina», «déjalo»', () => {
  const s = base(), r = leer('Elimina el evento del lunes a la 1:00 pm', s);
  assert.equal(L.respuestaBorrador(r.borrador, 'solo ese día', s, ahora()).intent, 'except');
  assert.equal(L.respuestaBorrador(r.borrador, 'no, solo este lunes', s, ahora()).intent, 'except');
  assert.equal(L.respuestaBorrador(r.borrador, 'toda la rutina', s, ahora()).intent, 'quitaRutina');
  assert.equal(L.respuestaBorrador(r.borrador, 'todas las semanas', s, ahora()).intent, 'quitaRutina');
  assert.equal(L.respuestaBorrador(r.borrador, 'mejor déjalo', s, ahora()).intent, 'aviso');
  assert.equal(L.respuestaBorrador(r.borrador, 'el viernes tengo parcial de física a las 9', s, ahora()), null, 'otra cosa: se lee aparte');
});

test('si no hay nada a esa hora, lo dice (y no crea nada)', () => {
  const s = base({ almuerzo: false });
  // Con el lunes en la semana que viene (hoy es lunes), dice el número para no confundirlo con hoy.
  assert.deepEqual(leer('Elimina el evento del lunes a la 1:00 pm', s), { intent: 'aviso', texto: 'El lunes 2 a la 1:00 p. m. no tienes nada.' });
  // Desde el miércoles, «el lunes» ya se entiende solo.
  assert.deepEqual(leer('Elimina el evento del lunes a la 1:00 pm', s, ahora(28)), { intent: 'aviso', texto: 'El lunes a la 1:00 p. m. no tienes nada.' });
  assert.equal(leer('borra lo de mañana a las 6 de la mañana', s).texto, 'Mañana a las 6:00 a. m. no tienes nada.');
  assert.equal(leer('quita lo del domingo', s).texto, 'El domingo no tienes nada en tu horario.');
});

test('lo nombrado manda: si no está, lo dice con su nombre', () => {
  assert.equal(leer('quita el almuerzo del sábado').texto, 'No encontré «almuerzo» el sábado.');
  assert.equal(leer('borra la fiesta del viernes a las 8 de la noche').texto, 'No encontré «fiesta» el viernes a las 8:00 p. m.');
  // El martes (mañana) a las 3 de la tarde solo hay Trabajo, que no se llama así, y la reunión es el jueves.
  assert.equal(leer('borra la reunión del martes a las 3').texto, 'No encontré «reunión» mañana a las 3:00 p. m.');
  assert.equal(leer('borra la cita con el dentista del viernes').texto, 'No encontré «cita con el dentista» el viernes.');
  // Lo que se copia de un mensaje de Lía, con comillas, se lee igual.
  assert.equal(leer('quita «Reunión de grupo» del jueves').intent, 'quitaEvento');
});

test('un evento de un día a esa hora: propone quitarlo', () => {
  // La reunión empieza a las 10, en medio de Clases: lo que empieza a esa hora va antes que lo que solo la cruza.
  assert.deepEqual(leer('quita lo del jueves a las 10'), { intent: 'quitaEvento', exId: 'x1', date: '2026-10-29' });
  assert.deepEqual(leer('quita la reunión del jueves a las 10 am'), { intent: 'quitaEvento', exId: 'x1', date: '2026-10-29' });
  // «A las 8» puede ser de la noche: a las 8 de la mañana solo hay Clases, que no es una cita.
  assert.deepEqual(leer('cancela la cita de mañana a las 8'), { intent: 'quitaEvento', exId: 'x2', date: '2026-10-27' });
  // Con la hora mal dicha, lo nombrado ese día cuenta igual (la propuesta muestra su hora).
  assert.deepEqual(leer('borra la reunión del jueves a la 1'), { intent: 'quitaEvento', exId: 'x1', date: '2026-10-29' });
});

test('una evaluación a esa hora se quita como siempre (quitaEval)', () => {
  assert.deepEqual(leer('borra lo del jueves a las 4'), { intent: 'quitaEval', evalId: 'e1' });
  assert.deepEqual(leer('borra el parcial de cálculo'), { intent: 'quitaEval', evalId: 'e1' });
});

test('«a las 8» sin a. m. ni p. m.: si de mañana no hay nada, mira la noche', () => {
  const s = estado({ excepciones: [EVENTOS[1]] });
  assert.deepEqual(leer('cancela el evento de mañana a las 8', s), { intent: 'quitaEvento', exId: 'x2', date: '2026-10-27' });
  // Con Clases a las 8 de la mañana, es la rutina: pregunta si solo mañana.
  const r = leer('cancela el evento de mañana a las 8');
  assert.equal(falta(r), 'alcance');
  assert.deepEqual(r.opciones.map(o => o.t), ['Solo mañana', 'Toda la rutina', 'Dejarlo así']);
  assert.deepEqual(elegir(r, 0).exs, [{ date: '2026-10-27', start: '08:00', end: '12:00', label: 'Sin Clases', libre: true, ref: 'c2' }]);
});

test('«borra lo del martes a las 3»: la rutina que empieza a esa hora', () => {
  const r = leer('borra lo del martes a las 3');
  assert.equal(falta(r), 'alcance');
  // Hoy es lunes: «el martes» es mañana.
  assert.equal(r.texto, '«Trabajo» es una rutina de lunes a viernes, de 15:00 a 19:00. ¿La quito solo mañana o toda la rutina?');
  assert.deepEqual(elegir(r, 1), { intent: 'quitaRutina', ids: ['c1'], name: 'Trabajo' });
});

test('varias cosas a esa hora: pregunta cuál, con respuestas rápidas', () => {
  const s = base({ eventos: [...EVENTOS, { id: 'x3', date: '2026-11-02', start: '13:00', end: '14:00', label: 'Almuerzo con mi tía', cat: 'comida' }] });
  const r = leer('borra lo del lunes a la 1', s);
  assert.equal(falta(r), 'cual');
  assert.equal(r.texto, 'El lunes 2 a la 1:00 p. m. tienes varias cosas. ¿Cuál quito?');
  assert.deepEqual(r.opciones.map(o => o.t), ['Almuerzo (13:00–14:30)', 'Almuerzo con mi tía (13:00–14:00)']);
  assert.deepEqual(elegir(r, 1, s), { intent: 'quitaEvento', exId: 'x3', date: '2026-11-02' });
  const rut = elegir(r, 0, s);
  assert.equal(falta(rut), 'alcance');
  // Escrito: «el de mi tía».
  assert.equal(L.respuestaBorrador(r.borrador, 'el de mi tía', s, ahora()).intent, 'quitaEvento');
  // Lo nombrado ya decide cuál: «el almuerzo con mi tía».
  assert.deepEqual(leer('borra el almuerzo con mi tía del lunes', s), { intent: 'quitaEvento', exId: 'x3', date: '2026-11-02' });
});

test('con día pero sin hora: lo de ese día que se nombra', () => {
  const r = leer('saca mi clase del miércoles');
  assert.equal(falta(r), 'alcance');
  assert.deepEqual(elegir(r, 0).exs[0], { date: '2026-10-28', start: '08:00', end: '12:00', label: 'Sin Clases', libre: true, ref: 'c2' });
  assert.equal(falta(leer('borra la clase de mañana')), 'alcance');
  const sab = estado({ compromisos: [{ id: 'i1', name: 'Inglés', type: 'curso', days: [6], start: '09:00', end: '11:00' }] });
  assert.equal(leer('quita el inglés del sábado', sab).texto, '«Inglés» es una rutina de los sábados, de 09:00 a 11:00. ¿La quito solo el sábado o toda la rutina?');
  // Sin nombre: todo lo de ese día, en orden, para elegir.
  const todo = leer('borra lo del jueves');
  assert.equal(falta(todo), 'cual');
  assert.equal(todo.texto, 'El jueves tienes varias cosas. ¿Cuál quito?');
  assert.deepEqual(todo.opciones.map(o => o.t), ['Clases (08:00–12:00)', 'Reunión de grupo (10:00–11:00)', 'Almuerzo (13:00–14:30)', 'Trabajo (15:00–19:00)', 'Parcial de Cálculo II (16:00)']);
  assert.deepEqual(elegir(todo, 4), { intent: 'quitaEval', evalId: 'e1' });
});

test('por su nombre, sin día: el próximo evento con ese nombre', () => {
  assert.deepEqual(leer('elimina la reunión de grupo'), { intent: 'quitaEvento', exId: 'x1', date: '2026-10-29' });
  assert.deepEqual(leer('borra la cita con el dentista'), { intent: 'quitaEvento', exId: 'x2', date: '2026-10-27' });
  // Una rutina por su nombre se sigue quitando desde Perfil (decisión del 2-nov).
  assert.match(leer('borra el almuerzo').texto, /^Para quitar «Almuerzo» de tus rutinas, ábrela en Perfil/);
  assert.equal(leer('borra la fiesta').texto, 'No encontré «fiesta» en tu horario.');
});

test('«cancelaron» o «ya no tengo» un evento: si está se quita; si no, no se crea', () => {
  assert.deepEqual(leer('cancelaron la reunión del jueves'), { intent: 'quitaEvento', exId: 'x1', date: '2026-10-29' });
  assert.deepEqual(leer('ya no tengo la cita con el dentista'), { intent: 'quitaEvento', exId: 'x2', date: '2026-10-27' });
  assert.deepEqual(leer('ya no tengo la reunión del viernes'), { intent: 'aviso', texto: 'No encontré «reunión» el viernes.' });
  // Una rutina que no va ese día sigue como antes: se libera ese día, sin preguntar.
  assert.equal(leer('cancelaron mi clase de mañana').intent, 'except');
  // «No voy a poder ir» a un evento: antes lo anotaba como nuevo.
  assert.deepEqual(leer('no voy a poder ir a la reunión del jueves'), { intent: 'quitaEvento', exId: 'x1', date: '2026-10-29' });
  assert.deepEqual(leer('ya no voy a la reunión del jueves'), { intent: 'quitaEvento', exId: 'x1', date: '2026-10-29' });
  assert.equal(leer('mañana no voy a la chamba').intent, 'except', 'una rutina sigue como antes');
  assert.deepEqual(leer('no voy a ir al cumpleaños de Ana el sábado'), { intent: 'aviso', texto: 'No encontré «cumpleaños de Ana» el sábado.' });
  assert.deepEqual(leer('ya no tengo cita con el dentista mañana, así que puedo estudiar'), { intent: 'quitaEvento', exId: 'x2', date: '2026-10-27' });
});

test('«sacar cita» es pedirla, no quitarla', () => {
  const r = leer('tengo que sacar cita con el dentista');
  assert.equal(r.intent, 'pregunta');
  assert.equal(r.borrador.items[0].kind, 'evento');
  const c = leer('saca cita con el doctor para el jueves a las 4');
  assert.deepEqual([c.intent, c.exs[0].date, c.exs[0].start, c.exs[0].label], ['except', '2026-10-29', '16:00', 'Cita']);
});

test('lo ya liberado ese día no se ofrece; una rutina de madrugada se libera desde el día en que empieza', () => {
  const libre = estado({ compromisos: [ALMUERZO], excepciones: [{ id: 'l1', date: '2026-11-02', start: '13:00', end: '14:30', label: 'Sin Almuerzo', libre: true, ref: 'c3' }] });
  assert.equal(leer('Elimina el evento del lunes a la 1:00 pm', libre).intent, 'aviso');
  const noche = estado({ compromisos: [{ id: 'n1', name: 'Turno noche', type: 'trabajo', days: LUN_A_VIE, start: '22:00', end: '06:00' }] });
  const r = leer('quita lo del miércoles a las 2 de la madrugada', noche);
  assert.equal(falta(r), 'alcance');
  assert.deepEqual(elegir(r, 0, noche).exs[0], { date: '2026-10-27', start: '22:00', end: '06:00', label: 'Sin Turno noche', libre: true, ref: 'n1' });
});

test('una rutina con varios horarios se quita entera; solo ese día, solo el horario que se nombró', () => {
  const s = estado({ compromisos: [
    { id: 't1', grupo: 'g', name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '08:00', end: '12:00' },
    { id: 't2', grupo: 'g', name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '14:00', end: '18:00' },
  ] });
  const r = leer('borra lo del martes a las 2', s);
  assert.deepEqual(elegir(r, 0, s).exs[0], { date: '2026-10-27', start: '14:00', end: '18:00', label: 'Sin Trabajo', libre: true, ref: 't2' });
  assert.deepEqual(elegir(r, 1, s), { intent: 'quitaRutina', ids: ['t1', 't2'], name: 'Trabajo' });
});

test('lo que no es quitar algo del horario sigue como antes', () => {
  assert.equal(leer('mueve mi bloque de las 9 a las 10').intent, 'help');
  assert.equal(leer('el viernes tengo una reunión de 4 a 5').intent, 'except');
  assert.equal(leer('¿qué tengo el jueves?').intent, 'agenda');
});

test('textoQuitar() y sinLoQuitado(): lo que la app muestra y guarda al confirmar, sin tocar el estado', () => {
  const s = base({ eventos: [...EVENTOS, { id: 'l2', date: '2026-10-29', start: '10:00', end: '10:30', label: 'Sin Reunión de grupo', libre: true, ref: 'x1' },
    { id: 'l3', date: '2026-10-28', start: '13:00', end: '14:30', label: 'Sin Almuerzo', libre: true, ref: 'c3' }] });
  const antes = JSON.stringify(s);
  assert.equal(L.textoQuitar(s, { intent: 'quitaEvento', exId: 'x1' }), 'quitar «Reunión de grupo» del jue 29 oct (10:00–11:00)');
  assert.equal(L.textoQuitar(s, { intent: 'quitaRutina', ids: ['c3'], name: 'Almuerzo' }), 'quitar la rutina «Almuerzo» (de lunes a viernes, 13:00–14:30)');
  const sinX = L.sinLoQuitado(s, { intent: 'quitaEvento', exId: 'x1' });
  assert.deepEqual(sinX.exceptions.map(x => x.id), ['x2', 'l3']);
  assert.equal(sinX.commitments.length, 3);
  const sinC = L.sinLoQuitado(s, { intent: 'quitaRutina', ids: ['c3'] });
  assert.deepEqual(sinC.commitments.map(c => c.id), ['c1', 'c2']);
  assert.deepEqual(sinC.exceptions.map(x => x.id), ['x1', 'x2', 'l2']);
  assert.equal(JSON.stringify(s), antes, 'no cambia el estado');
});

test('fraseQuitar(): lo que dice Lía en el chat antes de quitar, con el día y la hora como se dicen', () => {
  const s = base({ eventos: [...EVENTOS, { id: 'x3', date: '2026-11-02', start: '13:00', end: '14:00', label: 'Reunión', cat: 'otro' },
    { id: 'x4', date: '2026-11-20', start: '08:30', end: '09:00', label: 'Trámite', cat: 'casa' },
    { id: 'x5', date: '2026-10-26', start: '00:30', end: '01:00', label: 'Llamada', cat: 'otro' }] });
  const antes = JSON.stringify(s), f = r => L.fraseQuitar(s, r, ahora());
  assert.equal(f({ intent: 'quitaEvento', exId: 'x3', date: '2026-11-02' }), 'Quito «Reunión» del lunes 2 a la 1:00 p. m.');
  assert.equal(f({ intent: 'quitaEvento', exId: 'x1' }), 'Quito «Reunión de grupo» del jueves 29 a las 10:00 a. m.');
  assert.equal(f({ intent: 'quitaEvento', exId: 'x2' }), 'Quito «Cita con el dentista» de mañana a las 8:00 p. m.');
  assert.equal(f({ intent: 'quitaEvento', exId: 'x5' }), 'Quito «Llamada» de hoy a las 12:30 a. m.');
  // Más allá de dos semanas, con el mes.
  assert.equal(f({ intent: 'quitaEvento', exId: 'x4' }), 'Quito «Trámite» del viernes 20 de noviembre a las 8:30 a. m.');
  assert.equal(f({ intent: 'quitaRutina', ids: ['c3'], name: 'Almuerzo' }), 'Quito la rutina «Almuerzo» completa.');
  // Lo que ya no está: nada que decir (la app avisa aparte).
  assert.equal(f({ intent: 'quitaEvento', exId: 'nada' }), '');
  assert.equal(f({ intent: 'quitaRutina', ids: ['c9'], name: 'Gimnasio' }), '');
  assert.equal(f({ intent: 'quitaEval', evalId: 'e1' }), '');
  assert.equal(JSON.stringify(s), antes, 'no cambia el estado');
});

test('noQuitado(): por WhatsApp, lo que ya no se pudo quitar se explica', () => {
  const s = base();
  assert.equal(L.noQuitado(s, { intent: 'quitaEvento', exId: 'x9', label: 'Reunión' }), 'No quité «Reunión»: ya no estaba en LIA.');
  assert.equal(L.noQuitado(s, { intent: 'quitaEvento', exId: 'x9' }), 'No quité ese evento: ya no estaba en LIA.');
  assert.equal(L.noQuitado(s, { intent: 'quitaRutina', ids: ['c9'], name: 'Gimnasio' }), 'No quité la rutina «Gimnasio»: ya no estaba en LIA.');
  // Si queda una parte (se editó en la app), no se quita a ciegas.
  assert.equal(L.noQuitado(s, { intent: 'quitaRutina', ids: ['c3', 'c9'], name: 'Almuerzo' }),
    'No quité la rutina «Almuerzo»: cambió desde que me lo pediste. Si quieres, quítala en Perfil, en «Tus rutinas».');
});

test('revisarPropuesta(): WhatsApp revisa lo que se va a quitar con el estado de ahora', () => {
  const s = base();
  assert.deepEqual(L.revisarPropuesta(s, { intent: 'quitaEvento', exId: 'x1' }, ahora(), 0), { ok: true });
  assert.deepEqual(L.revisarPropuesta(s, { intent: 'quitaEvento', exId: 'nada' }, ahora(), 0), { ok: false, motivo: 'sin_evento' });
  assert.deepEqual(L.revisarPropuesta(s, { intent: 'quitaRutina', ids: ['c3'] }, ahora(), 0), { ok: true });
  assert.deepEqual(L.revisarPropuesta(s, { intent: 'quitaRutina', ids: ['c9'] }, ahora(), 0), { ok: false, motivo: 'sin_rutina' });
  assert.deepEqual(L.revisarPropuesta(s, { intent: 'quitaRutina', ids: [] }, ahora(), 0), { ok: false, motivo: 'rara' });
});
