// Lía con IA en la app: lo que se envía (contextoIA, historialIA) y cómo se revisa la respuesta (validarIA).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';
import * as F from '../supabase/functions/lia-ia/logica.js';

const lunes = ahora(26, 10);  // lunes 26 de octubre de 2026, 10:00
const base = () => estado({
  compromisos: [
    { name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' },
    { name: 'Clases', type: 'clase', days: LUN_A_VIE, start: '08:00', end: '12:00' },
    { name: 'Inglés', type: 'otro', days: [6], start: '09:00', end: '11:00' },
  ],
  evaluaciones: [
    { course: 'Cálculo II', type: 'parcial', date: '2026-10-29' },
    { course: 'Química', type: 'entrega', date: '2026-10-30', time: '23:59' },
    { course: 'Historia', type: 'examen', date: '2026-10-01' },
  ],
  ajustes: { name: 'Andrea' },
});

test('contextoIA lleva fecha con zona, horario y evaluaciones recientes, pero nunca el nombre', () => {
  const c = L.contextoIA(base(), lunes);
  assert.match(c.ahora, /^2026-10-26T10:00:00[+-]\d{2}:\d{2}$/);
  assert.equal(c.despierto, '07:00');
  assert.deepEqual(c.evaluaciones.map(e => [e.id, e.curso, e.tipo, e.fecha]), [['e0', 'Cálculo II', 'parcial', '2026-10-29'], ['e1', 'Química', 'entrega', '2026-10-30']]);
  assert.deepEqual(c.compromisos[0], { id: 'c0', nombre: 'Trabajo', tipo: 'trabajo', dias: LUN_A_VIE, inicio: '15:00', fin: '19:00' });
  assert.ok(!JSON.stringify(c).includes('Andrea'));
});

test('historialIA toma los últimos seis mensajes y marca quién habló', () => {
  const chat = Array.from({ length: 9 }, (_, i) => ({ from: i % 2 ? 'lia' : 'me', text: 'm' + i }));
  assert.deepEqual(L.historialIA(chat), ['m3', 'm4', 'm5', 'm6', 'm7', 'm8'].map((t, i) => ({ de: i % 2 ? 'yo' : 'lia', texto: t })));
});

test('add: evaluaciones completas pasan; las malas se descartan', () => {
  const r = L.validarIA({ intent: 'add', texto: 'ok', evaluaciones: [
    { tipo: 'practica', curso: 'física', fecha: '2026-10-29', hora: '19:00' },
    { tipo: 'parcial', curso: 'Estadística', fecha: '2026-11-02', hora: '09:00', horas: 7.3 },
    { tipo: 'examen', curso: 'Pasado', fecha: '2026-10-20', hora: '09:00' },
    { tipo: 'concierto', curso: 'Rock', fecha: '2026-10-30', hora: '20:00' },
    { tipo: 'final', curso: 'Álgebra', fecha: '2026-02-30', hora: '09:00' },
  ] }, base(), lunes);
  assert.equal(r.intent, 'add');
  assert.deepEqual(r.items, [
    { kind: 'eval', type: 'practica', course: 'Física', date: '2026-10-29', time: '19:00', hours: 3 },
    { kind: 'eval', type: 'parcial', course: 'Estadística', date: '2026-11-02', time: '09:00', hours: 7.5 },
  ]);
  assert.deepEqual(L.validarIA({ intent: 'add', texto: 'x', evaluaciones: [{ tipo: 'nada' }] }, base(), lunes), { intent: 'help' });
});

test('add: sin hora, sin fecha o sin curso, la app pregunta en vez de inventar (decisión 4)', () => {
  const sinHora = L.validarIA({ intent: 'add', texto: 'ok', evaluaciones: [{ tipo: 'entrega', curso: 'Informe de Química', fecha: '2026-11-05' }] }, base(), lunes);
  assert.equal(sinHora.intent, 'pregunta');
  assert.equal(sinHora.texto, '¿A qué hora vence tu informe de Química?');
  assert.deepEqual(sinHora.opciones.map(o => o.t), ['23:59', 'Otra hora']);
  assert.deepEqual(sinHora.borrador.items[0], { kind: 'eval', type: 'entrega', course: 'Informe de Química', date: '2026-11-05', time: '', hours: 4 });
  // Una hora mal escrita cuenta como que no vino.
  assert.equal(L.validarIA({ intent: 'add', texto: 'ok', evaluaciones: [{ tipo: 'parcial', curso: 'X', fecha: '2026-11-02', hora: '9:00' }] }, base(), lunes).intent, 'pregunta');
  const sinFecha = L.validarIA({ intent: 'add', texto: 'ok', evaluaciones: [{ tipo: 'examen', curso: 'Inglés' }] }, base(), lunes);
  assert.equal(sinFecha.texto, '¿Qué día es tu examen de Inglés?');
  const sinCurso = L.validarIA({ intent: 'add', texto: 'ok', evaluaciones: [{ tipo: 'final', curso: '   ', fecha: '2026-11-30', hora: '09:00' }] }, base(), lunes);
  assert.match(sinCurso.texto, /^¿De qué curso es tu final del lun 30 nov\?$/);
});

test('add: compromisos con días únicos y ordenados; sin días o sin horario, pregunta', () => {
  const r = L.validarIA({ intent: 'add', texto: 'ok', compromisos: [
    { tipo: 'trabajo', nombre: 'chamba en la tienda', dias: [5, 1, 1, 9, -1], inicio: '18:00', fin: '23:00' },
    { tipo: 'clase', nombre: '', dias: [2, 4], inicio: '07:00', fin: '09:00' },
  ] }, base(), lunes);
  assert.deepEqual(r.items, [
    { kind: 'commit', type: 'trabajo', name: 'Chamba en la tienda', days: [1, 5], start: '18:00', end: '23:00' },
    { kind: 'commit', type: 'clase', name: 'Clases', days: [2, 4], start: '07:00', end: '09:00' },
  ]);
  const dias = L.validarIA({ intent: 'add', texto: 'ok', compromisos: [{ tipo: 'deporte', nombre: 'Gym', dias: [], inicio: '06:00', fin: '07:00' }] }, base(), lunes);
  assert.deepEqual([dias.intent, dias.texto, dias.opciones.map(o => o.t).join('|')], ['pregunta', '¿Qué días tienes gym?', 'Lun a Vie|Fines de semana|Otros días']);
  const horario = L.validarIA({ intent: 'add', texto: 'ok', compromisos: [{ tipo: 'trabajo', nombre: 'Turno', dias: [1], inicio: '10:00', fin: '10:00' }] }, base(), lunes);
  assert.deepEqual([horario.intent, horario.texto], ['pregunta', '¿De qué hora a qué hora tienes turno?']);
});

test('except: liberar usa el horario real del compromiso y solo si ese día le toca', () => {
  const r = L.validarIA({ intent: 'except', texto: 'ok', cambios: [
    { fecha: '2026-10-27', libera: true, compromisoId: 'c1', inicio: '00:00', fin: '23:59' },
    { fecha: '2026-10-27', libera: true, compromisoId: 'c1' },
    { fecha: '2026-11-01', libera: true, compromisoId: 'c1' },
    { fecha: '2026-10-27', libera: true, compromisoId: 'c9' },
    { fecha: '2026-10-26', libera: false, inicio: '19:00', fin: '22:00', motivo: 'trabajo (más tarde)' },
    { fecha: '2026-10-31', libera: false, inicio: '15:00', fin: '19:00' },
    { fecha: '2026-10-31', libera: false, inicio: '15:00' },
    { fecha: '2027-06-01', libera: false, inicio: '10:00', fin: '12:00' },
  ] }, base(), lunes);
  assert.equal(r.intent, 'except');
  assert.deepEqual(r.exs, [
    { date: '2026-10-27', start: '08:00', end: '12:00', label: 'Sin Clases', libre: true, ref: 'c1' },
    { date: '2026-10-26', start: '19:00', end: '22:00', label: 'Trabajo (más tarde)', cat: 'trabajo' },
    { date: '2026-10-31', start: '15:00', end: '19:00', label: 'Ocupado', cat: 'otro' },
  ]);
  assert.equal(r.ex, r.exs[0]);
});

test('except: algo de un día sin horas queda como borrador y la app pregunta, con su categoría', () => {
  const r = L.validarIA({ intent: 'except', texto: 'ok', cambios: [{ fecha: '2026-10-31', libera: false, motivo: 'cumpleaños de Ana' }] }, base(), lunes);
  assert.deepEqual([r.intent, r.texto], ['pregunta', 'Anoto el cumpleaños de Ana del sábado. ¿De qué hora a qué hora es?']);
  assert.deepEqual(r.borrador.items[0], { kind: 'evento', date: '2026-10-31', start: '', end: '', label: 'Cumpleaños de Ana', cat: 'ocio' });
});

test('except: salir antes o entrar más tarde libera solo el tramo, si está dentro del compromiso', () => {
  const r = L.validarIA({ intent: 'except', texto: 'ok', cambios: [
    { fecha: '2026-10-28', libera: true, compromisoId: 'c0', inicio: '17:00', fin: '19:00' },
    { fecha: '2026-10-29', libera: true, compromisoId: 'c1', inicio: '08:00', fin: '10:00' },
    { fecha: '2026-10-30', libera: true, compromisoId: 'c0', inicio: '14:00', fin: '17:00' },
    { fecha: '2026-10-30', libera: true, compromisoId: 'c1', inicio: '10:00', fin: '09:00' },
  ] }, base(), lunes);
  assert.deepEqual(r.exs, [
    { date: '2026-10-28', start: '17:00', end: '19:00', label: 'Salida temprano', libre: true, ref: 'c0' },
    { date: '2026-10-29', start: '08:00', end: '10:00', label: 'Sin Clases', libre: true, ref: 'c1' },
    { date: '2026-10-30', start: '15:00', end: '19:00', label: 'Sin Trabajo', libre: true, ref: 'c0' },
    { date: '2026-10-30', start: '08:00', end: '12:00', label: 'Sin Clases', libre: true, ref: 'c1' },
  ]);
  const noche = estado({ compromisos: [{ name: 'Turno', type: 'trabajo', days: LUN_A_VIE, start: '22:00', end: '06:00' }] });
  assert.deepEqual(L.validarIA({ intent: 'except', texto: 'ok', cambios: [{ fecha: '2026-10-27', libera: true, compromisoId: 'c0', inicio: '23:00', fin: '23:30' }] }, noche, lunes).exs,
    [{ date: '2026-10-27', start: '22:00', end: '06:00', label: 'Sin Turno', libre: true, ref: 'c0' }]);
});

test('log: con una evaluación que existe, una fecha reciente y minutos razonables; si falta algo, pregunta', () => {
  const ok = L.validarIA({ intent: 'log', texto: 'ok', estudio: { evaluacionId: 'e0', fecha: '2026-10-25', minutos: 90 } }, base(), lunes);
  assert.deepEqual(ok, { intent: 'log', evalId: 'e0', course: 'Cálculo II', date: '2026-10-25', min: 90 });
  for (const estudio of [{ evaluacionId: 'e0', fecha: '2026-10-27', minutos: 90 }, { evaluacionId: 'e0', fecha: '2026-09-01', minutos: 60 }])
    assert.deepEqual(L.validarIA({ intent: 'log', texto: 'x', estudio }, base(), lunes), { intent: 'help' }, JSON.stringify(estudio));
  const cual = L.validarIA({ intent: 'log', texto: 'x', estudio: { evaluacionId: 'e9', fecha: '2026-10-25', minutos: 90 } }, base(), lunes);
  assert.deepEqual([cual.intent, cual.texto, cual.opciones.map(o => o.t).join('|')], ['pregunta', '¿Para qué evaluación estudiaste?', 'Parcial de Cálculo II|Entrega de Química']);
  for (const minutos of [2, 12.5, undefined])
    assert.equal(L.validarIA({ intent: 'log', texto: 'x', estudio: { evaluacionId: 'e0', fecha: '2026-10-25', minutos } }, base(), lunes).texto, '¿Cuánto tiempo estudiaste para Cálculo II?');
  // Sin fecha, es de hoy.
  assert.equal(L.validarIA({ intent: 'log', texto: 'x', estudio: { evaluacionId: 'e0', minutos: 30 } }, base(), lunes).date, '2026-10-26');
});

test('agenda, progreso, próxima evaluación, preguntas y temas ajenos', () => {
  assert.deepEqual(L.validarIA({ intent: 'agenda', texto: '', fecha: '2026-10-31' }, base(), lunes), { intent: 'agenda', date: '2026-10-31' });
  assert.deepEqual(L.validarIA({ intent: 'agenda', texto: '', fecha: 'mañana' }, base(), lunes), { intent: 'agenda', date: '2026-10-26' });
  for (const i of ['progress', 'next', 'replan']) assert.deepEqual(L.validarIA({ intent: i, texto: 'x' }, base(), lunes), { intent: i });
  assert.deepEqual(L.validarIA({ intent: 'pregunta', texto: '¿De qué curso es el examen?' }, base(), lunes), { intent: 'aviso', texto: '¿De qué curso es el examen?' });
  // Con lo que entendió, la pregunta de la IA va con las respuestas rápidas de la app (si pregunta lo mismo que falta).
  const p = L.validarIA({ intent: 'pregunta', falta: 'curso', texto: '¿De qué curso es el examen del viernes?', evaluaciones: [{ tipo: 'examen', fecha: '2026-10-30' }] }, base(), lunes);
  assert.deepEqual([p.intent, p.texto, p.borrador.items[0].date], ['pregunta', '¿De qué curso es el examen del viernes?', '2026-10-30']);
  const otra = L.validarIA({ intent: 'pregunta', falta: 'fecha', texto: '¿Qué día?', evaluaciones: [{ tipo: 'examen', curso: 'Inglés', fecha: '2026-10-30' }] }, base(), lunes);
  assert.equal(otra.texto, '¿A qué hora es tu examen de Inglés del viernes?');
  assert.deepEqual(L.validarIA({ intent: 'fuera', texto: 'Eso no lo sé hacer.\u0000' }, base(), lunes), { intent: 'aviso', texto: 'Eso no lo sé hacer.' });
  for (const r of [null, 'texto', { intent: 'pregunta', texto: '' }, { intent: 'borrar_todo', texto: 'listo' }, { intent: 'help', texto: '?' }])
    assert.deepEqual(L.validarIA(r, base(), lunes), { intent: 'help' }, JSON.stringify(r));
});

test('los tipos del esquema de la función coinciden con los de la app', () => {
  assert.deepEqual([...F.TIPOS_EVAL].sort(), Object.keys(L.EVAL_TYPES).sort());
  assert.deepEqual([...F.TIPOS_COMPROMISO].sort(), Object.keys(L.COMMIT_TYPES).sort());
});

test('los ejemplos de las instrucciones de Gemini pasan la revisión de la app', () => {
  // El contexto que describen los ejemplos: c1 Trabajo y c2 Clases de lunes a viernes, e1 Parcial de Cálculo II el jueves 29.
  const s = estado({ compromisos: [{ name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' }, { name: 'Clases', type: 'clase', days: LUN_A_VIE, start: '08:00', end: '12:00' }],
    evaluaciones: [{ course: 'Química', type: 'parcial', date: '2026-11-20' }, { course: 'Cálculo II', type: 'parcial', date: '2026-10-29' }] });
  s.commitments.forEach((c, i) => { c.id = 'c' + (i + 1); });
  s.evals[1].id = 'e1';
  const ejemplos = [...F.INSTRUCCIONES.matchAll(/^- "(.+?)" → (\{.+\})$/gm)];
  assert.ok(ejemplos.length >= 6, `hay ${ejemplos.length} ejemplos`);
  for (const [, frase, json] of ejemplos) {
    const r = L.validarIA(JSON.parse(json), s, lunes);
    assert.notEqual(r.intent, 'help', frase);
  }
});
