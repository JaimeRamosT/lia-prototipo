// Vista de ciclo (16 semanas) y alerta de semana pesada («Qué sigue», 3-nov, «Hacer ya»).
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00. Trabajo de lunes a viernes de 15:00 a 19:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const TRABAJO = { name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '15:00', end: '19:00' };
const EVALS = [
  { course: 'Historia', date: '2026-11-04', hours: 3 },                      // semana del 2 nov: 1 evaluación
  { course: 'Física', date: '2026-11-10' }, { course: 'Química', date: '2026-11-12' },  // semana del 9 nov: 2
  { course: 'Cálculo', date: '2026-11-16' }, { course: 'Inglés', date: '2026-11-18', type: 'entrega' }, { course: 'Economía', date: '2026-11-20' },  // del 16 nov: 3
];
const conPlan = (opc = {}) => { const s = estado({ compromisos: [TRABAJO], evaluaciones: EVALS, ...opc }); return { s, p: L.plan(s, ahora()) }; };

test('el ciclo empieza esta semana, en la de la primera evaluación pasada o en el lunes que elijas', () => {
  const { s } = conPlan();
  assert.equal(L.inicioCiclo(s, ahora()), '2026-10-26');
  const pasada = estado({ evaluaciones: [{ course: 'Arte', date: '2026-10-07' }] });
  assert.equal(L.inicioCiclo(pasada, ahora()), '2026-10-05');
  const elegido = estado({ ajustes: { cicloInicio: '2026-08-26' } });
  assert.equal(L.inicioCiclo(elegido, ahora()), '2026-08-24', 'siempre un lunes');
  // Sin elegir, nunca tan atrás que esta semana quede fuera de las 16.
  const vieja = estado({ evaluaciones: [{ course: 'Arte', date: '2026-01-07' }] });
  assert.equal(L.inicioCiclo(vieja, ahora()), '2026-07-13');
});

test('cada semana trae sus evaluaciones, sus horas y un nivel', () => {
  const { s, p } = conPlan(), ss = L.cargaCiclo(s, p, '2026-10-26');
  assert.equal(ss.length, 16);
  assert.deepEqual(ss.slice(0, 5).map(w => [w.lunes, w.evals.length, w.nivel]), [
    ['2026-10-26', 0, 'ligera'], ['2026-11-02', 1, 'ligera'], ['2026-11-09', 2, 'media'], ['2026-11-16', 3, 'pesada'], ['2026-11-23', 0, 'ligera'],
  ]);
  assert.equal(ss[0].trabajo, 5 * 4 * 60, '20 h de trabajo de lunes a viernes');
  assert.ok(ss[0].estudio > 0, 'hay estudio agendado esta semana');
  assert.deepEqual(ss[3].evals.map(e => e.course), ['Cálculo', 'Inglés', 'Economía']);
});

test('una sola evaluación sin horas suficientes también hace pesada la semana', () => {
  const s = estado({ compromisos: [TRABAJO], evaluaciones: [{ course: 'Tesis', date: '2026-10-28', hours: 60 }] });
  const w = L.cargaCiclo(s, L.plan(s, ahora()), '2026-10-26')[0];
  assert.equal(w.nivel, 'pesada');
  assert.deepEqual(w.sinHueco.map(e => e.course), ['Tesis']);
});

test('la alerta mira esta semana y las 3 siguientes, y dice cuánto estudio hay antes', () => {
  const { s, p } = conPlan(), w = L.semanaPesada(s, p, ahora());
  assert.equal(w.lunes, '2026-11-16');
  assert.equal(w.estaSemana, false);
  assert.ok(w.antes >= 60, 'ya hay estudio para esas evaluaciones antes del 16');
  // Cuatro semanas antes, todavía no avisa.
  const antes = new Date(2026, 9, 19, 10);
  assert.equal(L.semanaPesada(s, L.plan(s, antes), antes), null);
  // Sin semanas pesadas, nada.
  const tranquila = estado({ compromisos: [TRABAJO], evaluaciones: EVALS.slice(0, 3) });
  assert.equal(L.semanaPesada(tranquila, L.plan(tranquila, ahora()), ahora()), null);
});
