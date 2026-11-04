// Una evaluación nueva se liga al curso que ya existe (iteración 3, revisión de Coconut del 4-nov-2026): «parcial de
// cálculo» → «Cálculo I» si esa clase existe, sin importar tildes ni mayúsculas. Así queda con el nombre exacto del
// curso y con el color de su clase. Incluye la entrega de la revisión («una entrega de un avance del proyecto de
// emprendimiento este viernes a las 5»), que antes Lía leía como estudio hecho.
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora } from './logica.mjs';

const CLASES = [
  { id: 'k1', name: 'Cálculo I', type: 'clase', days: [1, 3], start: '08:00', end: '10:00' },
  { id: 'k2', name: 'Emprendimiento', type: 'clase', days: [6], start: '14:00', end: '17:00' },
  { id: 'k3', name: 'Estadística Aplicada', type: 'clase', days: [2], start: '18:00', end: '20:00' },
  { id: 'k4', name: 'Matemática Básica', type: 'clase', days: [4], start: '08:00', end: '10:00' },
  { id: 'k5', name: 'Trabajo', type: 'trabajo', days: [1, 2, 3, 4, 5], start: '15:00', end: '19:00' },
  { id: 'k6', name: 'Clases', type: 'clase', days: [5], start: '08:00', end: '12:00' },
];
const EVALS = [
  { id: 'e1', type: 'practica', course: 'Física II', date: '2026-11-03', time: '19:00' },
  { id: 'e2', type: 'entrega', course: 'Informe de Química', date: '2026-10-30', time: '23:59' },
];
const base = (extra = {}) => estado({ compromisos: CLASES, evaluaciones: EVALS, ...extra });
const leer = (frase, s = base()) => L.interpret(frase, s, ahora());
const evaluacion = r => { assert.equal(r.intent, 'add', JSON.stringify(r)); assert.equal(r.items.length, 1); return r.items[0]; };

test('cursoParecido(): sin tildes ni mayúsculas, con números romanos o arábigos', () => {
  const s = base();
  assert.equal(L.cursoParecido('calculo', s), 'Cálculo I');
  assert.equal(L.cursoParecido('CÁLCULO 1', s), 'Cálculo I');
  assert.equal(L.cursoParecido('Cálculo 2', s), null, 'otro número es otro curso');
  assert.equal(L.cursoParecido('emprendimiento', s), 'Emprendimiento');
  assert.equal(L.cursoParecido('estadistica', s), 'Estadística Aplicada');
  assert.equal(L.cursoParecido('mate', s), 'Matemática Básica', 'una abreviatura de 4 letras o más');
  assert.equal(L.cursoParecido('fisica', s), 'Física II', 'el curso de una evaluación que ya está');
  assert.equal(L.cursoParecido('Química', s), null, 'el informe es una entrega con nombre propio, no un curso');
  assert.equal(L.cursoParecido('historia', s), null);
  assert.equal(L.cursoParecido('calculo integral', s), null, 'lo que no coincide no se adivina');
  assert.equal(L.cursoParecido('trabajo', s), null, 'solo clases y evaluaciones, no otras rutinas');
  assert.equal(L.cursoParecido('clases', s), null);
});

test('cursoParecido(): si dos cursos se parecen igual, no elige', () => {
  const s = estado({ compromisos: [CLASES[0], { id: 'k9', name: 'Cálculo II', type: 'clase', days: [5], start: '08:00', end: '10:00' }] });
  assert.equal(L.cursoParecido('calculo', s), null);
  assert.equal(L.cursoParecido('calculo ii', s), 'Cálculo II');
  // El nombre exacto gana a uno que solo lo contiene.
  const t = estado({ compromisos: [CLASES[0], { id: 'k8', name: 'Cálculo', type: 'clase', days: [5], start: '08:00', end: '10:00' }] });
  assert.equal(L.cursoParecido('cálculo', t), 'Cálculo');
});

test('una evaluación nueva por chat se liga al curso que ya existe', () => {
  assert.equal(evaluacion(leer('parcial de cálculo el viernes a las 9')).course, 'Cálculo I');
  assert.equal(evaluacion(leer('tengo examen de EMPRENDIMIENTO el sábado a las 10')).course, 'Emprendimiento');
  assert.equal(evaluacion(leer('pc de estadística el martes 3 a las 7 de la noche')).course, 'Estadística Aplicada');
  assert.equal(evaluacion(leer('final de historia el 20 de noviembre a las 9')).course, 'Historia', 'sin curso parecido, el que dijo');
});

test('la respuesta a «¿De qué curso?» y lo que entiende la IA también se ligan', () => {
  const s = base(), r = leer('el miércoles tengo examen a las 9', s);
  assert.equal(L.faltaDe(r.borrador.items[0]), 'curso');
  assert.equal(evaluacion(L.respuestaBorrador(r.borrador, 'de calculo', s, ahora())).course, 'Cálculo I');
  const ia = L.validarIA({ intent: 'add', texto: 'ok', evaluaciones: [{ tipo: 'parcial', curso: 'calculo', fecha: '2026-10-30', hora: '09:00' }] }, s, ahora());
  assert.equal(evaluacion(ia).course, 'Cálculo I');
});

test('la entrega de la revisión: entrega de Emprendimiento este viernes a las 17:00 (nunca una búsqueda)', () => {
  const frase = 'Tengo una entrega de un avance del proyecto de emprendimiento este viernes a las 5';
  const esperado = { kind: 'eval', type: 'entrega', course: 'Emprendimiento', date: '2026-10-30', time: '17:00', hours: 4 };
  assert.deepEqual(evaluacion(leer(frase)), esperado, 'con la clase de Emprendimiento');
  assert.deepEqual(evaluacion(leer(frase, estado())), esperado, 'sin evaluaciones ni clases');
  assert.deepEqual(evaluacion(leer(frase, estado({ evaluaciones: EVALS }))), esperado, 'con otras evaluaciones');
  assert.equal(evaluacion(leer('el viernes entrego el primer avance del informe de marketing a las 11 de la noche', estado())).course, 'Marketing');
  // «Vence» no es parte del nombre.
  assert.equal(evaluacion(leer('mi entrega del trabajo final de marketing vence el 20/11 a medianoche', estado())).course, 'Trabajo final de Marketing');
  // Sin el avance, una entrega con nombre propio sigue igual.
  assert.equal(evaluacion(leer('tengo que entregar el proyecto de emprendimiento el viernes a las 5', estado())).course, 'Proyecto de Emprendimiento');
  // Y con la clase, se liga al curso.
  assert.equal(evaluacion(leer('tengo que entregar el proyecto de emprendimiento el viernes a las 5')).course, 'Emprendimiento');
});

test('«avancé» sigue siendo estudio hecho; «un avance» es lo que se entrega', () => {
  const s = estado({ evaluaciones: EVALS });
  assert.equal(L.interpret('hoy avancé 45 minutos del informe de química', s, ahora()).intent, 'log');
  assert.equal(L.interpret('ayer avancé 2 horas de física', s, ahora()).intent, 'log');
  assert.equal(L.interpret('hice un avance de 2 horas en física', s, ahora()).intent, 'log', 'con cuánto, es estudio');
  assert.notEqual(L.interpret('el viernes presento el avance de física a las 5', s, ahora()).intent, 'log');
});

test('«¿Cuándo es…?» responde por la evaluación que nombra', () => {
  assert.deepEqual(leer('¿cuándo es la práctica de física?'), { intent: 'aviso', texto: 'Tu práctica de Física II es el martes 3 de noviembre a las 19:00.' });
  assert.deepEqual(leer('¿a qué hora es mi pc de física?'), { intent: 'aviso', texto: 'Tu práctica de Física II es el martes 3 de noviembre a las 19:00.' });
  assert.deepEqual(leer('¿para cuándo es el informe de química?'), { intent: 'aviso', texto: 'Tu informe de Química vence el viernes 30 de octubre a las 23:59.' });
  assert.deepEqual(leer('¿cuándo es el parcial de historia?'), { intent: 'aviso', texto: 'No encontré tu parcial de Historia entre tus evaluaciones próximas.' });
  // Sin curso: la próxima evaluación, como siempre.
  assert.equal(leer('¿cuándo es mi próximo examen?').intent, 'next');
  assert.equal(leer('¿cuándo es mi próximo parcial?').intent, 'next');
});
