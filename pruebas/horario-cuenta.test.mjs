// Tu horario en tu cuenta (docs/horario-en-cuenta.md): qué se sube, cómo se aplica lo que viene de la cuenta
// y qué hace LIA en cada caso (subir, bajar o preguntar).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, LUN_A_VIE } from './logica.mjs';

const conTodo = () => ({
  ...estado({
    compromisos: [{ name: 'Trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' }],
    evaluaciones: [{ course: 'Cálculo', date: '2026-11-10' }],
    hechos: [{ id: 'h1', evalId: 'e0', date: '2026-11-03', start: '20:00', min: 60 }],
    excepciones: [{ id: 'x1', date: '2026-11-05', start: '15:00', end: '19:00', libre: true, ref: 'c0' }],
    ajustes: { avisos: { examen: true }, cicloInicio: '2026-08-24' },
  }),
  onboarded: true, completar: false, mode: 'own',
  chat: [{ from: 'yo', text: 'mañana no voy a trabajar' }], borrador: { intent: 'add' },
  sub: { tier: 'pro', until: '2026-12-01' }, cuenta: { id: 'u1', email: 'ana@correo.pe' },
  frozen: null,
});
const conGoogle = s => {
  s.commitments.push({ id: 'g1', gcal: 'r:ingles', name: 'Inglés', type: 'clase', days: [2, 4], start: '20:00', end: '22:00' });
  s.evals.push({ id: 'g2', gcal: 'v:fisica', type: 'parcial', course: 'Física', date: '2026-11-08', time: '09:00', hours: 5 });
  s.exceptions.push({ id: 'g3', gcal: 'l:ingles:2026-11-05', rutina: 'r:ingles', date: '2026-11-05', start: '20:00', end: '22:00', libre: true, ref: 'g1' });
  s.exceptions.push({ id: 'x2', date: '2026-11-12', start: '20:00', end: '22:00', libre: true, ref: 'g1', label: 'Inglés' });
  // Un evento de un día de Google y el rato que la persona decidió usar para estudiar («Sin Cumpleaños de Ana»).
  s.exceptions.push({ id: 'g4', gcal: 'e:cumple:2026-11-07', date: '2026-11-07', start: '16:00', end: '20:00', label: 'Cumpleaños de Ana', cat: 'ocio' });
  s.exceptions.push({ id: 'x3', date: '2026-11-07', start: '16:00', end: '18:00', libre: true, ref: 'g4', label: 'Sin Cumpleaños de Ana' });
  s.gcal = { url: 'https://calendar.google.com/secreta.ics', ignorar: ['v:otra:2026-11-09'], traidos: ['r:ingles', 'v:fisica'] };
  return s;
};

test('se sube el horario; nunca el chat, la cuenta, el plan ni lo que vino de Google', () => {
  const sub = L.horarioParaCuenta(conGoogle(conTodo()));
  assert.deepEqual(Object.keys(sub).sort(), ['commitments', 'completar', 'done', 'evals', 'exceptions', 'frozen', 'onboarded', 'settings', 'v']);
  assert.deepEqual(sub.commitments.map(c => c.id), ['c0']);
  assert.deepEqual(sub.evals.map(e => e.id), ['e0']);
  assert.deepEqual(sub.exceptions.map(x => x.id), ['x1'], 'sin los días libres de una rutina de Google');
  assert.equal(sub.settings.avisos, undefined, 'los avisos son de cada dispositivo');
  assert.equal(sub.settings.cicloInicio, '2026-08-24');
  assert.ok(!/gcal|secreta|Inglés|Física|Cumpleaños|mañana no voy/.test(JSON.stringify(sub)));
});

test('la firma no depende del orden de las claves (jsonb las reordena)', () => {
  const a = L.horarioParaCuenta(conTodo());
  const desordenar = v => Array.isArray(v) ? v.map(desordenar) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, desordenar(x)])) : v;
  assert.equal(L.firmaHorario(desordenar(a)), L.firmaHorario(a));
  const b = structuredClone(a); b.evals[0].date = '2026-11-11';
  assert.notEqual(L.firmaHorario(b), L.firmaHorario(a));
});

test('lo que viene de la cuenta reemplaza el horario y deja lo de Google, los avisos y el chat de aquí', () => {
  const aqui = conGoogle(conTodo());
  const cuenta = L.horarioParaCuenta(conTodo());
  cuenta.commitments = [{ id: 'c9', name: 'Clases', type: 'clase', days: [1, 3, 5], start: '08:00', end: '13:00' }];
  cuenta.settings = { ...cuenta.settings, wake: '06:00' };
  const s = L.aplicarHorario(aqui, cuenta);
  assert.deepEqual(s.commitments.map(c => c.id), ['c9', 'g1']);
  assert.deepEqual(s.evals.map(e => e.id), ['e0', 'g2']);
  assert.deepEqual(s.exceptions.map(x => x.id), ['x1', 'g3', 'x2', 'g4', 'x3']);
  assert.equal(s.settings.wake, '06:00');
  assert.deepEqual(s.settings.avisos, { examen: true });
  assert.equal(s.chat, aqui.chat);
  assert.equal(s.cuenta, aqui.cuenta);
  assert.equal(s.gcal, aqui.gcal);
  // Aplicar y volver a sacar da lo mismo que vino de la cuenta: después no hay nada que subir.
  assert.equal(L.firmaHorario(L.horarioParaCuenta(s)), L.firmaHorario(cuenta));
});

test('decidir: primera vez en un dispositivo', () => {
  const lleno = L.horarioParaCuenta(conTodo()), vacio = L.horarioParaCuenta({ ...estado(), onboarded: false });
  const cuenta = { rev: 4, datos: lleno, actualizado: '2026-11-03T22:10:00Z' };
  assert.equal(L.decidirHorario(vacio, cuenta, null, 'u1').accion, 'bajar', 'navegador vacío: trae la cuenta');
  assert.equal(L.decidirHorario(lleno, null, null, 'u1').accion, 'subir', 'cuenta vacía: sube');
  assert.equal(L.decidirHorario(vacio, null, null, 'u1').accion, 'nada');
  // Terminó la bienvenida sin rutinas (pero con sus ajustes): no se reemplaza sin preguntar.
  const ajustado = { ...vacio, onboarded: true, settings: { ...vacio.settings, sleep: '01:00' } };
  assert.deepEqual(L.decidirHorario(ajustado, cuenta, null, 'u1'), { accion: 'preguntar', motivo: 'primera-vez' });
  assert.equal(L.decidirHorario(lleno, cuenta, null, 'u1').accion, 'alinear', 'iguales: solo anota la versión');
  const otro = structuredClone(lleno); otro.evals[0].course = 'Química';
  assert.deepEqual(L.decidirHorario(otro, cuenta, null, 'u1'), { accion: 'preguntar', motivo: 'primera-vez' });
  // Lo que quedó de otra cuenta en este navegador nunca se sube sin preguntar.
  assert.deepEqual(L.decidirHorario(lleno, null, { uid: 'u2', rev: 3, firma: 'x' }, 'u1'), { accion: 'preguntar', motivo: 'cuenta-vacia' });
});

test('decidir: dispositivo que ya guardaba en la cuenta', () => {
  const s = L.horarioParaCuenta(conTodo()), f = L.firmaHorario(s), meta = { uid: 'u1', rev: 4, firma: f };
  const cambiado = structuredClone(s); cambiado.done = [];
  const enCuenta = (rev, datos = s) => ({ rev, datos, actualizado: '2026-11-03T22:10:00Z' });
  assert.equal(L.decidirHorario(s, enCuenta(4), meta, 'u1').accion, 'nada');
  assert.equal(L.decidirHorario(cambiado, enCuenta(4), meta, 'u1').accion, 'subir', 'cambié aquí');
  assert.equal(L.decidirHorario(s, enCuenta(6, cambiado), meta, 'u1').accion, 'bajar', 'cambió en otro lado');
  const otroLado = structuredClone(s); otroLado.evals = [];
  assert.deepEqual(L.decidirHorario(cambiado, enCuenta(6, otroLado), meta, 'u1'), { accion: 'preguntar', motivo: 'otro-dispositivo' });
  // Si los dos cambios terminaron iguales, no hay nada que preguntar.
  assert.equal(L.decidirHorario(cambiado, enCuenta(6, cambiado), meta, 'u1').accion, 'alinear');
  // Otro dispositivo dejó de guardarlo en la cuenta: aquí se queda la copia y se deja de subir.
  assert.equal(L.decidirHorario(cambiado, null, meta, 'u1').accion, 'apagar');
  // Apagado aquí: nada, aunque la cuenta tenga otra cosa.
  assert.equal(L.decidirHorario(cambiado, enCuenta(9, otroLado), { uid: 'u1', apagado: true }, 'u1').accion, 'nada');
  // Antes no había copia (rev 0): ahora que hay algo, se sube.
  assert.equal(L.decidirHorario(s, null, { uid: 'u1', rev: 0, firma: 'vacio' }, 'u1').accion, 'subir');
});

test('el resumen para elegir: rutinas, evaluaciones próximas y sus nombres', () => {
  const s = conTodo();
  s.evals.push({ id: 'e1', course: 'Física', date: '2026-11-06', type: 'parcial' }, { id: 'e2', course: 'Arte', date: '2026-10-01', type: 'parcial' });
  const r = L.resumenHorario(L.horarioParaCuenta(s), '2026-11-04');
  assert.deepEqual(r, { rutinas: 1, evals: 2, proximas: ['Física', 'Cálculo'], sesiones: 1 });
});
