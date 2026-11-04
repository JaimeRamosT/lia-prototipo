// Cambiar la hora de una rutina (iteración 3): «el miércoles entro a clases a las 9 en vez de las 8» cambia ese día;
// «mi clase de inglés ahora es de 10 a 12» es para siempre y se cambia en Perfil. Antes la segunda creaba otra rutina.
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const base = () => estado({ compromisos: [
  { id: 'c1', name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' },
  { id: 'c2', name: 'Clases', type: 'clase', days: LUN_A_VIE, start: '08:00', end: '12:00' },
  { id: 'c3', name: 'Inglés', type: 'otro', days: [6], start: '09:00', end: '11:00' },
] });
const leer = (frase, s = base()) => L.interpret(frase, s, ahora());

test('«en vez de»: la hora vieja no se confunde con la nueva', () => {
  assert.deepEqual(leer('el miércoles entro a clases a las 9 en vez de las 8').exs,
    [{ date: '2026-10-28', start: '08:00', end: '09:00', label: 'Entrada más tarde', libre: true, ref: 'c2' }]);
  assert.deepEqual(leer('el jueves en vez de entrar a las 3 a trabajar entro a las 5').exs,
    [{ date: '2026-10-29', start: '15:00', end: '17:00', label: 'Entrada más tarde', libre: true, ref: 'c1' }]);
});

test('«en vez de las 9»: la rutina es la que empieza a esa hora, aunque no se nombre', () => {
  const s = estado({ compromisos: [{ id: 'm', name: 'Prácticas', type: 'otro', days: LUN_A_VIE, start: '09:00', end: '13:00' }] });
  assert.deepEqual(leer('el lunes entro a las 10 en vez de las 9', s).exs,
    [{ date: '2026-11-02', start: '09:00', end: '10:00', label: 'Entrada más tarde', libre: true, ref: 'm' }]);
  // Si ese día nada empieza a esa hora, lo dice en vez de cambiar otra cosa.
  assert.deepEqual(leer('el lunes entro a las 10 en vez de las 9'), { intent: 'aviso', texto: 'El lunes 2 no tienes nada que empiece a las 9:00 a. m.' });
});

test('un cambio para siempre de una rutina se hace en Perfil: no crea otra rutina', () => {
  const r = leer('mi clase de inglés ahora es de 10 a 12');
  assert.equal(r.intent, 'aviso', JSON.stringify(r));
  assert.match(r.texto, /^Para cambiar el horario de «Inglés» para siempre, ábrela en Perfil, en «Tus rutinas»\./);
  assert.match(leer('cambia mi trabajo de los viernes, ahora salgo a las 8').texto, /«Trabajo»/);
  assert.match(leer('mueve mis clases de los martes a las 9').texto, /«Clases»/);
  // Solo las rutinas de esos días: Emprendimiento (sábados) también es una clase, pero no se nombra.
  const dos = estado({ compromisos: [...base().commitments, { id: 'c4', name: 'Emprendimiento', type: 'clase', days: [6], start: '14:00', end: '17:00' }] });
  assert.match(leer('mueve mis clases de los martes a las 9', dos).texto, /^Para cambiar el horario de «Clases» para siempre/);
  // Con el día de la semana nuevo también es para siempre (antes creaba otra rutina «Clases» el sábado).
  assert.match(leer('mi clase de inglés ahora es el sábado de 10 a 12').texto, /«Inglés» para siempre/);
  const gym = estado({ compromisos: [{ id: 'g', name: 'Gimnasio', type: 'deporte', days: [1, 3], start: '19:00', end: '21:00' }] });
  assert.match(leer('mueve el gimnasio al jueves', gym).texto, /«Gimnasio» para siempre/);
  // Un solo día sigue siendo de un solo día.
  assert.equal(leer('este viernes salgo del trabajo a las 8').intent, 'except');
  assert.equal(leer('me cambiaron el horario de clases, ahora entro a las 9').intent, 'aviso');
});
