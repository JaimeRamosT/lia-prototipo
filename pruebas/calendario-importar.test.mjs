// Google Calendar → LIA (docs/calendario.md): leer el iCal de la «dirección secreta» (leerIcs), convertirlo en rutinas,
// evaluaciones, eventos de un día y ratos libres (deCalendario) y juntarlo con lo guardado (fusionarGcal).
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado } from './logica.mjs';

const HOY = '2026-10-26';
const ics = (...eventos) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', 'X-WR-TIMEZONE:America/Lima',
  'BEGIN:VTIMEZONE', 'TZID:America/Lima', 'BEGIN:STANDARD', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0500', 'DTSTART:19700101T000000', 'END:STANDARD', 'END:VTIMEZONE',
  ...eventos.flatMap(e => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n') + '\r\n';
const LIMA = 'TZID=America/Lima';

// Un calendario como el de una estudiante: clases, trabajo, deporte, comidas, evaluaciones y algunos que no entran.
const CAL = ics(
  [`DTSTART;${LIMA}:20260824T080000`, `DTEND;${LIMA}:20260824T100000`, 'RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20261212T045959Z;BYDAY=MO,WE',
    `EXDATE;${LIMA}:20261102T080000`, 'UID:calculo@google.com', 'SUMMARY:Cálculo II', 'STATUS:CONFIRMED', 'TRANSP:OPAQUE',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:This is an event reminder', 'TRIGGER:-P0DT0H10M0S', 'END:VALARM'],
  // La clase del miércoles 28 se pasó al jueves 29 de 10 a 12.
  [`DTSTART;${LIMA}:20261029T100000`, `DTEND;${LIMA}:20261029T120000`, `RECURRENCE-ID;${LIMA}:20261028T080000`, 'UID:calculo@google.com', 'SUMMARY:Cálculo II (recuperación)'],
  ['DTSTART:20261026T200000Z', 'DTEND:20261027T000000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'UID:trabajo@google.com', 'SUMMARY:Turno en la tienda'],
  // En UTC es martes a las 03:00; en Lima, lunes a las 22:00 hasta la medianoche.
  ['DTSTART:20261027T030000Z', 'DTEND:20261027T050000Z', 'RRULE:FREQ=WEEKLY;BYDAY=TU', 'UID:futbol@google.com', 'SUMMARY:Fútbol con amigos'],
  [`DTSTART;${LIMA}:20261001T130000`, `DTEND;${LIMA}:20261001T140000`, 'RRULE:FREQ=DAILY', 'UID:almuerzo@google.com', 'SUMMARY:Almuerzo'],
  [`DTSTART;${LIMA}:20261015T180000`, `DTEND;${LIMA}:20261015T190000`, 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TH', 'UID:tesis@google.com', 'SUMMARY:Reunión de tesis'],
  [`DTSTART;${LIMA}:20261005T090000`, `DTEND;${LIMA}:20261005T093000`, 'RRULE:FREQ=MONTHLY', 'UID:pension@google.com', 'SUMMARY:Pago de pensión'],
  [`DTSTART;${LIMA}:20261005T190000`, `DTEND;${LIMA}:20261005T200000`, 'RRULE:FREQ=MONTHLY;BYDAY=1MO', 'UID:delegados@google.com', 'SUMMARY:Reunión de delegados'],
  [`DTSTART;${LIMA}:20260801T100000`, `DTEND;${LIMA}:20260801T120000`, 'RRULE:FREQ=WEEKLY;UNTIL=20261001T000000Z', 'UID:ingles@google.com', 'SUMMARY:Inglés'],
  [`DTSTART;${LIMA}:20260901T170000`, `DTEND;${LIMA}:20260901T180000`, 'RRULE:FREQ=WEEKLY;COUNT=3', 'UID:oratoria@google.com', 'SUMMARY:Taller de oratoria'],
  [`DTSTART;${LIMA}:20261116T060000`, `DTEND;${LIMA}:20261116T070000`, 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'UID:natacion@google.com', 'SUMMARY:Natación'],
  [`DTSTART;${LIMA}:20261105T090000`, `DTEND;${LIMA}:20261105T110000`, 'UID:fisica@google.com', 'SUMMARY:Parcial de Física 1'],
  [`DTSTART;${LIMA}:20261110T190000`, `DTEND;${LIMA}:20261110T210000`, 'UID:pc2@google.com', 'SUMMARY:PC2 - Estadística'],
  [`DTSTART;${LIMA}:20261201T080000`, `DTEND;${LIMA}:20261201T110000`, 'UID:final@google.com', 'SUMMARY:Examen final de Química'],
  ['DTSTART;VALUE=DATE:20261112', 'DTEND;VALUE=DATE:20261113', 'UID:informe@google.com', 'SUMMARY:Entrega del informe de Química'],
  ['DTSTART;VALUE=DATE:20261103', 'DTEND;VALUE=DATE:20261104', 'UID:cumple-ana@google.com', 'SUMMARY:Cumpleaños de Ana'],
  [`DTSTART;${LIMA}:20261028T160000`, `DTEND;${LIMA}:20261028T170000`, 'UID:dentista@google.com', 'SUMMARY:Cita con el dentista'],
  [`DTSTART;${LIMA}:20261031T200000`, `DTEND;${LIMA}:20261031T230000`, 'UID:lucia@google.com', 'SUMMARY:Cumpleaños de Lucía'],
  [`DTSTART;${LIMA}:20261027T090000`, `DTEND;${LIMA}:20261027T100000`, 'UID:cancelado@google.com', 'SUMMARY:Reunión cancelada', 'STATUS:CANCELLED'],
  [`DTSTART;${LIMA}:20261027T120000`, `DTEND;${LIMA}:20261027T121500`, 'UID:luz@google.com', 'SUMMARY:Pagar la luz', 'TRANSP:TRANSPARENT'],
  [`DTSTART;${LIMA}:20261020T090000`, `DTEND;${LIMA}:20261020T100000`, 'UID:pasado@google.com', 'SUMMARY:Algo que ya pasó'],
  [`DTSTART;${LIMA}:20261120T060000`, `DTEND;${LIMA}:20261122T200000`, 'UID:cusco@google.com', 'SUMMARY:Viaje a Cusco'],
  [`DTSTART;${LIMA}:20261030T220000`, `DTEND;${LIMA}:20261031T060000`, 'UID:noche@google.com', 'SUMMARY:Turno extra de noche'],
  ['DTSTART;TZID=Europe/Madrid:20261027T180000', 'DTEND;TZID=Europe/Madrid:20261027T190000', 'UID:madrid@google.com', 'SUMMARY:Llamada con Madrid'],
  ['DTSTART;TZID="SA Pacific Standard Time":20261029T070000', 'DTEND;TZID="SA Pacific Standard Time":20261029T073000', 'UID:outlook@x', 'SUMMARY:Desayuno de trabajo'],
  ['DTSTART:20261030T150000', 'DTEND:20261030T160000', 'UID:flotante@google.com', 'SUMMARY:Reunión\\, grupo 3\\; aula 204'],
  [`DTSTART;${LIMA}:20261029T200000`, `DTEND;${LIMA}:20261029T210000`, 'UID:sintitulo@google.com'],
  [`DTSTART;${LIMA}:20261027T180000`, 'DURATION:PT1H30M', 'UID:largo@google.com', 'SUMMARY:Asesoría con la profesora de Programación orientada',
    '  a objetos'],  // al doblar una línea se quita solo el primer espacio
);

const leer = () => L.deCalendario(L.leerIcs(CAL), HOY);
const rutina = (c, k) => c.rutinas.find(r => r.gcal === 'r:' + k);
const evento = (c, k) => c.eventos.find(e => e.gcal === 'e:' + k);

test('leerIcs: líneas dobladas, textos escapados y la alarma no pisa los datos del evento', () => {
  const evs = L.leerIcs(CAL);
  const largo = evs.find(e => e.uid === 'largo@google.com');
  assert.equal(largo.titulo, 'Asesoría con la profesora de Programación orientada a objetos');
  assert.equal(largo.dur, 90);
  assert.equal(evs.find(e => e.uid === 'flotante@google.com').titulo, 'Reunión, grupo 3; aula 204');
  const calculo = evs.find(e => e.uid === 'calculo@google.com' && !e.rid);
  assert.equal(calculo.titulo, 'Cálculo II', 'DESCRIPTION de la alarma no cuenta');
  assert.deepEqual(calculo.rrule.byday, [1, 3]);
  assert.deepEqual(calculo.exdates, [{ f: '2026-11-02', min: 480 }]);
  assert.deepEqual(L.leerIcs('esto no es un calendario'), []);
});

test('horas de Lima: UTC, Lima, flotante, otra zona y nombres de Windows', () => {
  const c = leer();
  assert.deepEqual([rutina(c, 'trabajo@google.com').start, rutina(c, 'trabajo@google.com').end], ['15:00', '19:00']);
  assert.deepEqual([evento(c, 'madrid@google.com').date, evento(c, 'madrid@google.com').start, evento(c, 'madrid@google.com').end], ['2026-10-27', '12:00', '13:00']);
  assert.deepEqual([evento(c, 'outlook@x').start, evento(c, 'outlook@x').end], ['07:00', '07:30']);
  assert.deepEqual([evento(c, 'flotante@google.com').start, evento(c, 'flotante@google.com').label], ['15:00', 'Reunión, grupo 3; aula 204']);
  assert.equal(evento(c, 'sintitulo@google.com').label, 'Ocupado');
});

test('lo que se repite cada semana o cada día es una rutina, con su categoría por el título', () => {
  const c = leer();
  assert.deepEqual(rutina(c, 'calculo@google.com'), { gcal: 'r:calculo@google.com', name: 'Cálculo II', type: 'otro', days: [1, 3], start: '08:00', end: '10:00', hasta: '2026-12-11' }, 'termina con el ciclo (UNTIL en hora de Lima)');
  assert.equal(rutina(c, 'trabajo@google.com').type, 'trabajo');
  assert.deepEqual(rutina(c, 'trabajo@google.com').days, [1, 2, 3, 4, 5]);
  const f = rutina(c, 'futbol@google.com');
  assert.deepEqual([f.type, f.days, f.start, f.end], ['deporte', [1], '22:00', '00:00'], 'el día se corre al pasar a hora de Lima');
  const a = rutina(c, 'almuerzo@google.com');
  assert.deepEqual([a.type, a.days], ['comida', [0, 1, 2, 3, 4, 5, 6]]);
  assert.ok(!rutina(c, 'ingles@google.com'), 'terminó (UNTIL)');
  assert.ok(!rutina(c, 'oratoria@google.com'), 'terminó (COUNT)');
  assert.deepEqual([rutina(c, 'natacion@google.com').desde, rutina(c, 'natacion@google.com').hasta], ['2026-11-16', undefined], 'empieza más adelante: no ocupa horas antes');
  assert.equal(rutina(c, 'trabajo@google.com').hasta, undefined, 'sin fin');
});

test('una serie corta no es una rutina para siempre: lleva su fecha de fin', () => {
  const c = L.deCalendario(L.leerIcs(ics(
    [`DTSTART;${LIMA}:20261027T070000`, `DTEND;${LIMA}:20261027T080000`, 'RRULE:FREQ=DAILY;COUNT=3', 'UID:tres@g', 'SUMMARY:Curso intensivo'],
    [`DTSTART;${LIMA}:20261019T180000`, `DTEND;${LIMA}:20261019T200000`, 'RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO', 'UID:dos@g', 'SUMMARY:Taller de Excel'],
    [`DTSTART;${LIMA}:20261124T100000`, `DTEND;${LIMA}:20261124T120000`, 'RRULE:FREQ=WEEKLY;UNTIL=20261209T050000Z;BYDAY=TU', 'UID:luego@g', 'SUMMARY:Laboratorio'],
    [`DTSTART;${LIMA}:20270301T100000`, `DTEND;${LIMA}:20270301T120000`, 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'UID:lejos@g', 'SUMMARY:Ciclo 2027-1'],
  )), HOY);
  const r = k => c.rutinas.find(x => x.gcal === 'r:' + k);
  assert.deepEqual([r('tres@g').days, r('tres@g').desde, r('tres@g').hasta], [[0, 1, 2, 3, 4, 5, 6], '2026-10-27', '2026-10-29']);
  assert.deepEqual([r('dos@g').desde, r('dos@g').hasta], [undefined, '2026-11-02'], 'quedan el 26-oct y el 2-nov');
  assert.deepEqual([r('luego@g').desde, r('luego@g').hasta], ['2026-11-24', '2026-12-09']);
  assert.ok(!r('lejos@g'), 'empieza después de los próximos 60 días');
  // Fuera de sus fechas no ocupa horas.
  const s = estado({ compromisos: c.rutinas.map(({ gcal, ...x }, i) => ({ id: 'g' + i, ...x })) });
  const ocupa = f => L.busyFor(s, f).some(b => b.label === 'Curso intensivo');
  assert.deepEqual(['2026-10-26', '2026-10-27', '2026-10-29', '2026-10-30'].map(ocupa), [false, true, true, false]);
});

test('fechas excluidas y clases movidas: libre ese día y, si se movió, un evento de un día', () => {
  const c = leer();
  assert.deepEqual(c.libres.find(l => l.gcal === 'l:calculo@google.com:2026-11-02'), { gcal: 'l:calculo@google.com:2026-11-02', rutina: 'r:calculo@google.com', date: '2026-11-02', start: '08:00', end: '10:00' });
  assert.ok(c.libres.some(l => l.gcal === 'l:calculo@google.com:2026-10-28'));
  assert.deepEqual(evento(c, 'calculo@google.com:2026-10-28'), { gcal: 'e:calculo@google.com:2026-10-28', date: '2026-10-29', start: '10:00', end: '12:00', label: 'Cálculo II (recuperación)', cat: 'otro' });
});

test('repeticiones que no son semanales: días sueltos de los próximos 60 días; las complejas no se traen', () => {
  const c = leer();
  assert.deepEqual(c.eventos.filter(e => e.gcal.startsWith('e:tesis@')).map(e => e.date), ['2026-10-29', '2026-11-12', '2026-11-26', '2026-12-10', '2026-12-24']);
  assert.deepEqual(c.eventos.filter(e => e.gcal.startsWith('e:pension@')).map(e => e.date), ['2026-11-05', '2026-12-05']);
  assert.ok(!c.eventos.some(e => e.gcal.includes('delegados')));
  assert.equal(c.omitidos.repeticiones, 1);
});

test('evaluaciones por el título, con el curso; una entrega de todo el día vence a las 23:59', () => {
  const c = leer(), v = k => c.evals.find(e => e.gcal === 'v:' + k);
  assert.deepEqual(v('fisica@google.com'), { gcal: 'v:fisica@google.com', type: 'parcial', course: 'Física 1', date: '2026-11-05', time: '09:00' });
  assert.deepEqual([v('pc2@google.com').type, v('pc2@google.com').course], ['practica', 'Estadística']);
  assert.deepEqual([v('final@google.com').type, v('final@google.com').course], ['final', 'Química']);
  assert.deepEqual([v('informe@google.com').type, v('informe@google.com').course, v('informe@google.com').time], ['entrega', 'Informe de Química', '23:59']);
  assert.equal(c.evals.length, 4);
});

test('eventos de un día y lo que no se trae', () => {
  const c = leer();
  assert.deepEqual(evento(c, 'dentista@google.com'), { gcal: 'e:dentista@google.com', date: '2026-10-28', start: '16:00', end: '17:00', label: 'Cita con el dentista', cat: 'otro' });
  assert.equal(evento(c, 'lucia@google.com').cat, 'ocio');
  assert.deepEqual([evento(c, 'noche@google.com').start, evento(c, 'noche@google.com').end, evento(c, 'noche@google.com').cat], ['22:00', '06:00', 'trabajo'], 'pasa la medianoche');
  for (const k of ['cancelado', 'luz', 'pasado', 'cusco', 'cumple-ana']) assert.ok(!c.eventos.some(e => e.gcal.includes(k)), k);
  assert.deepEqual([c.omitidos.todoElDia, c.omitidos.largos, c.omitidos.disponibles], [1, 1, 1]);
});

test('lo que ya está en LIA se reconoce', () => {
  const s = estado({ compromisos: [{ id: 'c1', name: 'Calculo II', type: 'clase', days: [1, 3], start: '08:00', end: '10:00' }],
    evaluaciones: [{ id: 'e1', type: 'parcial', course: 'física 1', date: '2026-11-05' }] });
  const c = leer();
  assert.ok(L.yaEnLia(s, rutina(c, 'calculo@google.com')));
  assert.ok(!L.yaEnLia(s, rutina(c, 'trabajo@google.com')));
  assert.ok(L.yaEnLia(s, c.evals.find(e => e.gcal === 'v:fisica@google.com')));
  assert.ok(!L.yaEnLia(s, evento(c, 'dentista@google.com')));
});

// ---------- Juntar con lo guardado ----------
let n = 0;
const nuevoId = () => 'g' + (++n);
const aplicar = (s, r) => ({ ...s, commitments: r.commitments, exceptions: r.exceptions, evals: r.evals, done: r.done, gcal: r.gcal });

test('primera vez: entra lo elegido; lo no elegido no vuelve a proponerse', () => {
  n = 0;
  const c = leer(), s = estado({ compromisos: [{ id: 'mio', name: 'Inglés', type: 'curso', days: [6], start: '09:00', end: '11:00' }] });
  const elegidos = new Set(['r:calculo@google.com', 'l:calculo@google.com:2026-11-02', 'l:calculo@google.com:2026-10-28', 'e:calculo@google.com:2026-10-28', 'v:fisica@google.com', 'e:dentista@google.com']);
  const r = L.fusionarGcal(s, c, HOY, { elegidos, nuevoId, cupoEvals: Infinity });
  const calc = r.commitments.find(x => x.gcal === 'r:calculo@google.com');
  assert.deepEqual({ ...calc, gh: undefined }, { id: calc.id, name: 'Cálculo II', type: 'otro', days: [1, 3], start: '08:00', end: '10:00', hasta: '2026-12-11', gcal: 'r:calculo@google.com', gh: undefined });
  assert.ok(calc.gh, 'guarda la huella para saber si la cambias en LIA');
  assert.ok(r.commitments.some(x => x.id === 'mio'), 'lo propio no se toca');
  const libre = r.exceptions.find(x => x.gcal === 'l:calculo@google.com:2026-11-02');
  assert.deepEqual([libre.libre, libre.ref, libre.start, libre.end, libre.label], [true, calc.id, '08:00', '10:00', 'Sin Cálculo II']);
  const fis = r.evals.find(x => x.gcal === 'v:fisica@google.com');
  assert.deepEqual([fis.type, fis.course, fis.date, fis.time, fis.hours], ['parcial', 'Física 1', '2026-11-05', '09:00', 5]);
  assert.deepEqual(r.nuevasEvals, [fis.id]);
  assert.equal(r.commitments.length, 2);
  assert.ok(r.gcal.ignorar.includes('r:trabajo@google.com') && r.gcal.ignorar.includes('v:pc2@google.com'));
  // La segunda lectura, igual a la primera, no cambia nada y no trae lo que no se eligió.
  const s2 = aplicar(s, r), r2 = L.fusionarGcal(s2, c, HOY, { nuevoId, cupoEvals: Infinity });
  assert.deepEqual(r2.cambios, { nuevos: 0, cambiados: 0, quitados: 0 });
  assert.deepEqual(r2.commitments, s2.commitments);
  assert.deepEqual(r2.exceptions, s2.exceptions);
});

test('después: lo nuevo entra, lo cambiado se actualiza y lo borrado en Google (futuro) se quita', () => {
  n = 0;
  const c = leer(), s0 = estado(), r = L.fusionarGcal(s0, c, HOY, { nuevoId, cupoEvals: Infinity }), s = aplicar(s0, r);
  const idCalc = s.commitments.find(x => x.gcal === 'r:calculo@google.com').id;
  s.done = [{ id: 'd1', evalId: s.evals.find(e => e.gcal === 'v:fisica@google.com').id, date: '2026-10-27', start: '19:00', min: 60 }];
  // En Google: Cálculo pasa a las 9; se borran el parcial de Física y el turno; aparece un evento nuevo.
  const c2 = structuredClone(c);
  c2.rutinas.find(x => x.gcal === 'r:calculo@google.com').start = '09:00';
  c2.rutinas = c2.rutinas.filter(x => x.gcal !== 'r:trabajo@google.com');
  c2.evals = c2.evals.filter(x => x.gcal !== 'v:fisica@google.com');
  c2.eventos.push({ gcal: 'e:nuevo@google.com', date: '2026-11-03', start: '18:00', end: '19:00', label: 'Charla de empleabilidad', cat: 'otro' });
  const r2 = L.fusionarGcal(s, c2, HOY, { nuevoId, cupoEvals: Infinity });
  const calc = r2.commitments.find(x => x.gcal === 'r:calculo@google.com');
  assert.deepEqual([calc.id, calc.start], [idCalc, '09:00'], 'mismo id: lo estudiado y las excepciones siguen');
  assert.ok(!r2.commitments.some(x => x.gcal === 'r:trabajo@google.com'));
  assert.ok(!r2.evals.some(x => x.gcal === 'v:fisica@google.com'));
  assert.deepEqual(r2.done, [], 'lo estudiado para una evaluación que ya no existe se va con ella');
  assert.ok(r2.exceptions.some(x => x.gcal === 'e:nuevo@google.com'));
  assert.deepEqual(r2.cambios, { nuevos: 1, cambiados: 1, quitados: 2 }, 'quitados: el turno y el parcial');
});

test('lo que cambias o borras en LIA se queda como lo dejaste', () => {
  n = 0;
  const c = leer(), s0 = estado(), s = aplicar(s0, L.fusionarGcal(s0, c, HOY, { nuevoId, cupoEvals: Infinity }));
  s.commitments.find(x => x.gcal === 'r:calculo@google.com').type = 'clase';          // la cambió a Clases
  s.exceptions = s.exceptions.filter(x => x.gcal !== 'e:dentista@google.com');          // la borró
  const c2 = structuredClone(c);
  c2.rutinas.find(x => x.gcal === 'r:calculo@google.com').start = '09:00';
  c2.eventos.find(x => x.gcal === 'e:dentista@google.com').start = '15:00';
  const r = L.fusionarGcal(s, c2, HOY, { nuevoId, cupoEvals: Infinity });
  const calc = r.commitments.find(x => x.gcal === 'r:calculo@google.com');
  assert.deepEqual([calc.type, calc.start], ['clase', '08:00']);
  assert.ok(!r.exceptions.some(x => x.gcal === 'e:dentista@google.com'), 'no vuelve');
  assert.ok(r.gcal.ignorar.includes('r:calculo@google.com') && r.gcal.ignorar.includes('e:dentista@google.com'));
  // Aunque en Google se borre, lo que cambiaste en LIA no se quita.
  const c3 = structuredClone(c2);
  c3.rutinas = c3.rutinas.filter(x => x.gcal !== 'r:calculo@google.com');
  assert.ok(L.fusionarGcal(aplicar(s, r), c3, HOY, { nuevoId, cupoEvals: Infinity }).commitments.some(x => x.gcal === 'r:calculo@google.com'));
});

test('lo que ya pasó no se quita; al quitarse una rutina se van sus ratos libres', () => {
  n = 0;
  const c = leer(), s0 = estado(), s = aplicar(s0, L.fusionarGcal(s0, c, HOY, { nuevoId, cupoEvals: Infinity }));
  // Una semana después, la cita del dentista (28-oct) ya pasó y Google ya no la manda en la ventana.
  const c2 = structuredClone(c);
  c2.eventos = c2.eventos.filter(x => x.gcal !== 'e:dentista@google.com');
  c2.rutinas = c2.rutinas.filter(x => x.gcal !== 'r:calculo@google.com');
  c2.libres = c2.libres.filter(x => x.rutina !== 'r:calculo@google.com');
  const r = L.fusionarGcal(s, c2, '2026-11-02', { nuevoId, cupoEvals: Infinity });
  assert.ok(r.exceptions.some(x => x.gcal === 'e:dentista@google.com'), 'pasado: se queda');
  assert.ok(!r.exceptions.some(x => x.gcal && x.gcal.startsWith('l:calculo@')), 'sus libres se van con la rutina');
});

test('en las siguientes lecturas, lo nuevo que ya tienes en LIA no entra dos veces', () => {
  n = 0;
  const c = leer(), s0 = estado({ compromisos: [{ id: 'mio', name: 'Turno en la tienda', type: 'trabajo', days: [1, 2, 3, 4, 5], start: '15:00', end: '19:00' }],
    evaluaciones: [{ id: 'e1', type: 'parcial', course: 'Física 1', date: '2026-11-05' }] });
  const r = L.fusionarGcal(s0, c, HOY, { nuevoId, cupoEvals: Infinity });
  assert.equal(r.commitments.filter(x => x.name === 'Turno en la tienda').length, 1);
  assert.equal(r.evals.filter(x => x.course === 'Física 1').length, 1);
  assert.ok(r.gcal.ignorar.includes('r:trabajo@google.com') && r.gcal.ignorar.includes('v:fisica@google.com'));
  // La primera vez, si la persona lo marca igual, entra: lo decidió ella.
  const r2 = L.fusionarGcal(s0, c, HOY, { nuevoId, cupoEvals: Infinity, elegidos: new Set(['r:trabajo@google.com']) });
  assert.equal(r2.commitments.filter(x => x.name === 'Turno en la tienda').length, 2);
});

test('Gratis: las evaluaciones entran hasta el cupo y las demás esperan', () => {
  n = 0;
  const c = leer(), r = L.fusionarGcal(estado(), c, HOY, { nuevoId, cupoEvals: 1 });
  assert.deepEqual(r.evals.map(e => e.gcal), ['v:fisica@google.com'], 'la más próxima');
  assert.equal(r.sinCupo, 3);
  assert.ok(!r.gcal.ignorar.includes('v:pc2@google.com'), 'no se ignora: entra cuando haya cupo o con Pro');
});

test('lo ignorado de días que ya pasaron se olvida', () => {
  const s = estado();
  s.gcal = { url: 'x', ignorar: ['e:a@g:2026-10-01', 'e:b@g:2026-11-30', 'r:c@g', 'l:d@g:2026-10-25'], traidos: [] };
  const r = L.fusionarGcal(s, { rutinas: [], eventos: [], libres: [], evals: [], omitidos: {} }, HOY, { nuevoId, cupoEvals: Infinity });
  assert.deepEqual(r.gcal.ignorar.sort(), ['e:b@g:2026-11-30', 'r:c@g']);
  assert.equal(r.gcal.url, 'x');
});
