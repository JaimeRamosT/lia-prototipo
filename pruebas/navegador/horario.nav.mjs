// Iteración 3 (docs/iteracion-3.md §5 y §6), en un iPhone, un Android y una computadora, con el reloj en el lunes 9 de
// noviembre de 2026: lo que pasa a la vez se ve lado a lado (sin pisarse) en Semana y en «Tu día», con «+N» desde 3;
// LIA avisa antes de guardar un duplicado o un cruce («Guardar igual» o «Volver», sin perder lo escrito); la evaluación
// se liga a un curso que ya existe; un solo botón «+»; y ya no hay recordatorios del navegador ni «Instalar LIA».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servir, lanzar, abrir, registrar, pestana, anchoDeMas, DISPOSITIVOS } from './ayuda.mjs';

let srv, nav;
before(async () => { srv = await servir(); nav = await lanzar(); });
after(async () => { await nav?.close(); await srv?.cerrar(); });

const LUNES = '2026-11-09';
const cita = { id: 'x1', date: LUNES, start: '10:00', end: '11:00', label: 'Cita médica', cat: 'otro' };
const tramite = { id: 'x2', date: LUNES, start: '10:30', end: '11:30', label: 'Trámite', cat: 'casa' };

// Registro con trabajo de lunes a viernes de 9:00 a 18:00 y un examen el viernes a las 19:00; luego, lo de un día que se pide.
async function preparar(disp, extra = []) {
  const { ctx, pg, errores } = await abrir(nav, 'about:blank', disp);
  await pg.addInitScript(() => { window.__permisos = 0; if (window.Notification) Notification.requestPermission = () => { window.__permisos++; return Promise.resolve('default'); }; });
  await pg.clock.install({ time: new Date('2026-11-09T08:00:00-05:00') });
  await pg.goto(srv.url);
  await registrar(pg, { rutinas: ['trabajo de lunes a viernes de 9 a 6'], evals: ['examen de cálculo el viernes a las 7 de la noche'] });   // después del trabajo: sin aviso
  await pg.evaluate(xs => { state.exceptions.push(...xs); save(); render(); }, extra);
  return { ctx, pg, errores };
}
const guardado = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')));
const pisan = (a, b) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
// El día de hoy en la cuadrícula: en el celular se ve solo el día elegido; en la computadora, los 7.
const hoyEnGrilla = pg => pg.locator('.grilla .g-dia[aria-label^="Lunes 9 de noviembre"]');
async function visible(loc, que) {
  await loc.scrollIntoViewIfNeeded();
  assert.ok(await loc.isVisible(), `${que} se ve`);
  const b = await loc.boundingBox();
  assert.ok(b.width >= 40 && b.height >= 20, `${que} tiene tamaño para leerse (${Math.round(b.width)}×${Math.round(b.height)})`);
  const n = await loc.locator('b').boundingBox();
  assert.ok(n && n.width >= 30, `el nombre de ${que} se ve`);
  return b;
}

for (const disp of Object.keys(DISPOSITIVOS)) {
  test(`${disp}: dos a la vez se ven lado a lado, sin pisarse, en Semana y en «Tu día»`, async () => {
    const { ctx, pg, errores } = await preparar(disp, [cita]);
    await pestana(pg, 'Semana');
    const dia = hoyEnGrilla(pg);
    const tr = await visible(dia.locator('[aria-label^="Trabajo"]'), 'Trabajo');
    const ci = await visible(dia.locator('[aria-label^="Cita médica"]'), 'Cita médica');
    assert.ok(!pisan(tr, ci), 'las cajas de la cuadrícula no se pisan');
    assert.ok(ci.y < tr.y + tr.height && tr.y < ci.y + ci.height, 'van a la misma altura: lado a lado');
    assert.match(await dia.locator('[aria-label^="Cita médica"]').getAttribute('aria-label'), /de 10:00 a 11:00\. A la vez con Trabajo/);
    assert.equal(await anchoDeMas(pg), false, 'Semana no se sale de la pantalla');
    await pestana(pg, 'Hoy');
    const fila = pg.getByRole('group', { name: /^A la vez: 2 actividades, de 09:00 a 18:00/ });
    const [a, b] = [fila.getByRole('button', { name: /^Trabajo/ }), fila.getByRole('button', { name: /^Cita médica/ })];
    const ba = await visible(a, 'Trabajo en Tu día'), bb = await visible(b, 'Cita médica en Tu día');
    assert.ok(!pisan(ba, bb) && bb.x > ba.x && bb.y < ba.y + ba.height, 'en Tu día también van lado a lado');
    await b.click();
    await pg.getByRole('dialog').getByRole('heading', { name: 'Editar' }).waitFor();
    assert.deepEqual(errores, []);
    await ctx.close();
  });

  test(`${disp}: con 3 a la vez se ve «+2» y, al tocarlo, la lista`, async () => {
    const { ctx, pg, errores } = await preparar(disp, [cita, tramite]);
    for (const vista of ['Semana', 'Hoy']) {
      await pestana(pg, vista);
      const mas = pg.getByRole('button', { name: 'Ver las 3 actividades a la vez, de 09:00 a 18:00' });
      await mas.scrollIntoViewIfNeeded();
      assert.match(await mas.innerText(), /\+2/);
      await mas.click();
      const hoja = pg.getByRole('dialog');
      await hoja.getByRole('heading', { name: '3 actividades a la vez' }).waitFor();
      const txt = await hoja.innerText();
      for (const n of ['Trabajo', 'Cita médica', 'Trámite']) assert.ok(txt.includes(n), `${vista}: la lista tiene ${n}`);
      await hoja.getByRole('button', { name: 'Cerrar' }).click();
    }
    assert.deepEqual(errores, []);
    await ctx.close();
  });

  test(`${disp}: el «+» avisa del cruce y del duplicado antes de guardar, con «Guardar igual» y «Volver»`, async () => {
    const { ctx, pg, errores } = await preparar(disp);
    await pestana(pg, 'Hoy');
    const mas = pg.getByRole('button', { name: 'Agregar', exact: true });
    await mas.click();
    const hoja = pg.getByRole('dialog');
    for (const op of ['Rutina semanal', 'Evento de un día', 'Evaluación', 'Importar consolidado']) await hoja.getByRole('button', { name: new RegExp(`^${op}`) }).waitFor();
    await hoja.getByRole('button', { name: /^Evento de un día/ }).click();
    const llenar = async (ini, fin) => { await pg.fill('#ev-label', 'Cita médica'); await pg.fill('#ev-date', LUNES); await pg.fill('#ev-start', ini); await pg.fill('#ev-end', fin); };
    await llenar('10:00', '11:00');
    await hoja.getByRole('button', { name: 'Guardar', exact: true }).click();
    await hoja.getByRole('alert').filter({ hasText: 'Se cruza con «Trabajo» (lunes, 9:00–18:00).' }).waitFor();
    assert.equal((await guardado(pg)).exceptions.length, 0, 'todavía no se guarda');
    // «Volver»: el formulario sigue con lo escrito.
    await hoja.getByRole('button', { name: 'Volver' }).click();
    assert.equal(await pg.inputValue('#ev-label'), 'Cita médica');
    assert.equal(await hoja.getByRole('alert').count(), 0);
    await hoja.getByRole('button', { name: 'Guardar', exact: true }).click();
    await hoja.getByRole('button', { name: 'Guardar igual' }).click();
    await pg.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal((await guardado(pg)).exceptions.filter(x => x.label === 'Cita médica').length, 1);
    // Lo mismo otra vez: ya está.
    await mas.click();
    await pg.getByRole('dialog').getByRole('button', { name: /^Evento de un día/ }).click();
    await llenar('10:00', '11:00');
    await pg.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
    await pg.getByRole('alert').filter({ hasText: 'Ya tienes «Cita médica» el lunes 9 de noviembre de 10:00 a 11:00.' }).waitFor();
    assert.equal(await anchoDeMas(pg), false, 'el aviso no se sale de la pantalla');
    await pg.getByRole('button', { name: 'Volver' }).click();
    await pg.fill('#ev-start', '19:00'); await pg.fill('#ev-end', '20:00');
    await pg.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
    await pg.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal((await guardado(pg)).exceptions.filter(x => x.label === 'Cita médica').length, 2, 'a otra hora, se guarda sin aviso');
    // Una evaluación igual a la que ya está.
    await mas.click();
    await pg.getByRole('dialog').getByRole('button', { name: /^Evaluación/ }).click();
    await pg.fill('#e-course', 'cálculo'); await pg.fill('#e-date', '2026-11-13'); await pg.fill('#e-time', '19:00');
    await pg.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
    await pg.getByRole('alert').filter({ hasText: 'Ya tienes «Examen de Cálculo» el viernes 13 de noviembre a las 19:00.' }).waitFor();
    await pg.getByRole('button', { name: 'Volver' }).click();
    assert.equal(await pg.inputValue('#e-course'), 'cálculo', 'lo escrito se queda');
    assert.equal((await guardado(pg)).evals.length, 1);
    assert.equal(await pg.evaluate(() => window.__permisos), 0, 'nunca pide permiso de notificaciones');
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}

test('Android: en el chat, la propuesta repetida pregunta «¿Lo guardo igual?» y «Volver» devuelve la frase', async () => {
  const { ctx, pg, errores } = await preparar('Android');
  // En Semana, el «+» propone el día que estás mirando.
  assert.ok(await pg.getByRole('button', { name: 'Agregar algo el lunes 9 de noviembre' }).isVisible());
  await pestana(pg, 'Hoy');
  const mas = pg.getByRole('button', { name: 'Agregar', exact: true });
  assert.ok(await mas.isVisible(), 'el «+» se ve en Hoy');
  const fab = await mas.boundingBox(), barra = await pg.locator('#tabs .tab').first().boundingBox();
  assert.ok(fab.y + fab.height <= barra.y, 'el «+» no tapa la barra de secciones');
  await pestana(pg, 'Lía');
  assert.equal(await mas.isVisible(), false, 'en el chat no hay «+» encima de la caja de texto');
  await pg.fill('#chat-in', 'parcial de cálculo el viernes a las 7 de la noche'); await pg.keyboard.press('Enter');
  const msg = pg.locator('.msg').last();
  await msg.getByText(/Ya tienes «Examen de Cálculo» el viernes 13 de noviembre a las 19:00\./).waitFor();
  assert.match(await msg.innerText(), /¿Lo guardo igual\?/);
  await msg.getByRole('button', { name: 'Volver' }).click();
  assert.equal(await pg.inputValue('#chat-in'), 'parcial de cálculo el viernes a las 7 de la noche');
  assert.equal((await guardado(pg)).evals.length, 1, 'no se guardó');
  assert.deepEqual(errores, []);
  await ctx.close();
});

for (const disp of ['iPhone', 'Computadora']) {
  test(`${disp}: la evaluación se liga a un curso que ya existe y se ve con el color de su clase`, async () => {
    const { ctx, pg, errores } = await preparar(disp);
    await pestana(pg, 'Hoy');
    await pg.evaluate(() => { state.commitments.push({ id: 'k1', name: 'Cálculo I', type: 'clase', days: [2, 4], start: '07:00', end: '09:00' }, { id: 'k2', name: 'Clases', type: 'clase', days: [6], start: '08:00', end: '12:00' }); save(); render(); });
    await pg.getByRole('button', { name: 'Agregar', exact: true }).click();
    await pg.getByRole('dialog').getByRole('button', { name: /^Evaluación/ }).click();
    const cursos = pg.getByRole('group', { name: 'Tus cursos' });
    assert.deepEqual(await cursos.getByRole('button').allInnerTexts(), ['Cálculo I'], 'solo los cursos, sin «Clases»');
    await cursos.getByRole('button', { name: 'Cálculo I' }).click();
    assert.equal(await pg.inputValue('#e-course'), 'Cálculo I');
    assert.equal(await cursos.getByRole('button', { name: 'Cálculo I' }).getAttribute('aria-pressed'), 'true');
    await pg.fill('#e-date', '2026-11-12'); await pg.fill('#e-time', '07:00');
    await pg.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
    await pg.getByRole('dialog').waitFor({ state: 'detached' });   // en horas de su clase, sin aviso
    assert.ok((await guardado(pg)).evals.some(e => e.course === 'Cálculo I' && e.date === '2026-11-12'));
    await pestana(pg, 'Semana');
    if (disp !== 'Computadora') await pg.getByRole('button', { name: /^Jueves 12/ }).click();
    const ev = pg.locator('.grilla .g-dia[aria-label^="Jueves 12"] [aria-label^="Parcial · Cálculo I"]');
    await ev.scrollIntoViewIfNeeded();
    assert.match(await ev.getAttribute('class'), /k-clase/, 'con el color de su clase');
    await pestana(pg, 'Evaluaciones');
    assert.match(await pg.getByRole('button', { name: /Parcial · Cálculo I/ }).locator('.sw').getAttribute('class'), /k-clase/);
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}

test('Android: Perfil ya no ofrece recordatorios del navegador ni instalar LIA, y sí importar el consolidado', async () => {
  const { ctx, pg, errores } = await preparar('Android');
  await pestana(pg, 'Perfil');
  const txt = await pg.locator('#view').innerText();
  assert.doesNotMatch(txt, /Activar recordatorios|Instalar LIA|Agregar a inicio|Instálala/);
  await pg.getByRole('button', { name: 'Importar mi consolidado de matrícula' }).click();
  await pg.getByRole('dialog').getByRole('heading', { name: 'Tu consolidado de matrícula' }).waitFor();
  assert.equal(await pg.evaluate(() => window.__permisos), 0);
  assert.deepEqual(errores, []);
  await ctx.close();
});
