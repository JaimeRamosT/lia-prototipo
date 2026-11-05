// Importar el consolidado de matrícula (PDF) en el registro y después, desde el «+», en un iPhone y un Android simulados.
// Usa pruebas/consolidado/consolidado-ejemplo.pdf (sin datos reales) y pdf.js de vendor/pdfjs, como en producción.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { servir, lanzar, abrir, registrar, pestana, anchoDeMas, CELULARES } from './ayuda.mjs';

const PDF = fileURLToPath(new URL('../consolidado/consolidado-ejemplo.pdf', import.meta.url));
let srv, nav;
before(async () => { srv = await servir(); nav = await lanzar(); });
after(async () => { await nav?.close(); await srv?.cerrar(); });

for (const celular of Object.keys(CELULARES)) {
  test(`${celular}: importa el consolidado en el registro y guarda los cursos como clases`, async () => {
    const { ctx, pg, errores } = await abrir(nav, srv.url, celular);
    await pg.getByRole('button', { name: 'Empezar con mis horarios' }).click();
    await pg.getByRole('button', { name: 'Importar mi consolidado de matrícula' }).click();
    await pg.setInputFiles('#cons-file', PDF);
    await pg.locator('.sheet').getByText(/Encontré 3 cursos/).waitFor({ timeout: 15000 });
    const hoja = await pg.locator('.sheet').innerText();
    assert.match(hoja, /Cálculo Diferencial e Integral/);
    assert.match(hoja, /Estadística Aplicada/);
    assert.ok(!/Estudiante de Prueba|000000000/.test(hoja), 'no muestra datos del alumno');
    assert.equal(await anchoDeMas(pg), false, 'la hoja no se sale de la pantalla');
    // Desmarca un curso y agrega los otros dos.
    await pg.getByRole('checkbox', { name: /Comunicación Oral/ }).uncheck();
    await pg.getByRole('button', { name: 'Agregar cursos' }).click();
    await pg.waitForTimeout(300);
    const cs = await pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')).commitments);
    assert.deepEqual([...new Set(cs.map(c => c.name))], ['Cálculo Diferencial e Integral', 'Estadística Aplicada']);
    assert.ok(cs.every(c => c.type === 'clase'));
    const calc = cs.filter(c => c.name === 'Cálculo Diferencial e Integral');
    assert.deepEqual(calc.map(c => [c.days, c.start, c.end]), [[[1, 3], '20:00', '22:00'], [[6], '11:00', '13:00']]);
    assert.ok(calc[0].grupo && calc[0].grupo === calc[1].grupo, 'los dos horarios son una sola rutina');
    // Importar otra vez no duplica.
    await pg.getByRole('button', { name: 'Importar mi consolidado de matrícula' }).click();
    await pg.setInputFiles('#cons-file', PDF);
    await pg.locator('.sheet').getByText(/Encontré 3 cursos/).waitFor({ timeout: 15000 });
    assert.match(await pg.locator('.sheet').innerText(), /ya está en tus rutinas/);
    assert.deepEqual(errores, []);
    await ctx.close();
  });

  // Iteración 3: también después del registro, desde el «+» (y desde Perfil, ver horario.nav.mjs).
  test(`${celular}: después del registro, importa el consolidado desde el «+»`, async () => {
    const { ctx, pg, errores } = await abrir(nav, srv.url, celular);
    await registrar(pg);
    await pestana(pg, 'Hoy');
    await pg.getByRole('button', { name: 'Agregar', exact: true }).click();
    await pg.getByRole('dialog').getByRole('button', { name: /^Importar consolidado/ }).click();
    await pg.setInputFiles('#cons-file', PDF);
    await pg.locator('.sheet').getByText(/Encontré 3 cursos/).waitFor({ timeout: 15000 });
    await pg.getByRole('button', { name: 'Agregar cursos' }).click();
    await pg.getByText(/^Agregué 3 cursos a tus rutinas\./).waitFor();
    const cs = await pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')).commitments);
    for (const n of ['Cálculo Diferencial e Integral', 'Estadística Aplicada', 'Comunicación Oral']) assert.ok(cs.some(c => c.name.startsWith(n) && c.type === 'clase'), n);
    assert.deepEqual(errores, []);
    await ctx.close();
  });

  test(`${celular}: un PDF sin horarios muestra qué hacer`, async () => {
    const { ctx, pg, errores } = await abrir(nav, srv.url, celular);
    await pg.getByRole('button', { name: 'Empezar con mis horarios' }).click();
    await pg.getByRole('button', { name: 'Importar mi consolidado de matrícula' }).click();
    await pg.setInputFiles('#cons-file', { name: 'otro.pdf', mimeType: 'application/pdf', buffer: Buffer.from('esto no es un PDF') });
    await pg.getByRole('alert').waitFor({ timeout: 15000 });
    assert.match(await pg.getByRole('alert').innerText(), /No pude leer ese archivo|No encontré horarios/);
    assert.deepEqual(errores.filter(e => !/Invalid PDF|InvalidPDFException/i.test(e)), []);
    await ctx.close();
  });
}
