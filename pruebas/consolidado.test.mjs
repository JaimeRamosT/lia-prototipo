// Consolidado de matrícula (PDF): leerConsolidado() saca cursos y horarios de los trozos de texto del PDF.
// items-ejemplo.json sale de consolidado-ejemplo.pdf (sin datos reales) con pdf.js, igual que en la app:
// nombres en dos líneas, horarios partidos en dos líneas y un horario que cruza de página.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { L } from './logica.mjs';

const items = JSON.parse(readFileSync(new URL('./consolidado/items-ejemplo.json', import.meta.url), 'utf8'));

test('lee los tres cursos con sus horarios', () => {
  const { cursos } = L.leerConsolidado(items);
  assert.deepEqual(cursos.map(c => c.nombre), ['Cálculo Diferencial e Integral', 'Estadística Aplicada', 'Comunicación Oral']);
  const h = c => c.horarios.map(x => `${x.dia} ${x.inicio}-${x.fin}`);
  assert.deepEqual(h(cursos[0]), ['1 20:00-22:00', '3 20:00-22:00', '6 11:00-13:00']);
  assert.deepEqual(h(cursos[1]), ['1 18:00-20:00', '2 20:00-22:00', '4 18:00-20:00'], 'el jueves cruza a la página 2');
  assert.deepEqual(h(cursos[2]), ['2 07:00-08:30', '5 17:00-19:00'], 'la hora de fin en la línea siguiente');
  assert.deepEqual([cursos[1].horarios[0].tipo, cursos[1].horarios[0].virtual], ['Teoría', true]);
});

test('no lee el nombre ni el código del alumno', () => {
  const txt = JSON.stringify(L.leerConsolidado(items));
  assert.ok(!/Estudiante|000000000|Ana/.test(txt));
});

test('un curso es una rutina de clases con un horario por par de horas', () => {
  const r = L.rutinaDeCurso(L.leerConsolidado(items).cursos[0]);
  assert.deepEqual(r, { name: 'Cálculo Diferencial e Integral', type: 'clase', tramos: [
    { days: [1, 3], start: '20:00', end: '22:00' }, { days: [6], start: '11:00', end: '13:00' }] });
});

test('sin horarios o con datos raros, no inventa nada', () => {
  assert.deepEqual(L.leerConsolidado([]).cursos, []);
  assert.deepEqual(L.leerConsolidado(null).cursos, []);
  assert.deepEqual(L.leerConsolidado([{ s: 'Constancia de estudios', x: 50, y: 50 }, { s: 'Lunes feriado', x: 300, y: 80 }]).cursos, []);
  assert.deepEqual(L.leerConsolidado([{ s: 'Física', x: 100, y: 100 }, { s: 'Lunes 25:00-26:00', x: 400, y: 100 }]).cursos, [], 'horas imposibles');
});

test('un formato simple de una fila por horario también funciona', () => {
  const fila = (y, curso, horario) => [{ s: curso, x: 60, y }, { s: horario, x: 320, y }];
  const r = L.leerConsolidado([{ s: 'Curso', x: 60, y: 20 }, { s: 'Horario', x: 320, y: 20 },
    ...fila(40, 'Química General', 'Martes 08:00 - 10:00'), ...fila(60, 'Química General', 'Jueves 08:00 - 10:00'), ...fila(80, 'Inglés III', 'Sábado 9:00-11:00')]);
  assert.deepEqual(r.cursos.map(c => [c.nombre, c.horarios.map(h => h.dia + ' ' + h.inicio).join(', ')]),
    [['Química General', '2 08:00, 4 08:00'], ['Inglés III', '6 09:00']], 'el mismo curso en dos filas queda como uno');
});
