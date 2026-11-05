// Recorrido básico de LIA en un iPhone y un Android simulados: registro, las cinco pestañas y el chat de Lía.
// Correr: cd pruebas/navegador && npm ci && npx playwright install chromium && npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servir, lanzar, abrir, registrar, pestana, decir, anchoDeMas, CELULARES } from './ayuda.mjs';

let srv, nav;
before(async () => { srv = await servir(); nav = await lanzar(); });
after(async () => { await nav?.close(); await srv?.cerrar(); });

for (const celular of Object.keys(CELULARES)) {
  test(`${celular}: bienvenida, registro y las cinco pestañas sin errores`, async () => {
    const { ctx, pg, errores } = await abrir(nav, srv.url, celular);
    await pg.getByRole('button', { name: 'Empezar con mis horarios' }).waitFor();
    assert.equal(await anchoDeMas(pg), false, 'la bienvenida no se sale de la pantalla');
    await registrar(pg);
    assert.match(await pg.locator('#view').innerText(), /Tu semana/);
    for (const nombre of ['Hoy', 'Semana', 'Lía', 'Evaluaciones', 'Perfil']) {
      await pestana(pg, nombre);
      assert.equal(await anchoDeMas(pg), false, `${nombre} no se sale de la pantalla`);
    }
    const guardado = await pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')));
    assert.equal(guardado.v, 1);
    assert.equal(guardado.commitments.length, 2);
    assert.equal(guardado.evals[0].course, 'Cálculo');
    assert.deepEqual(errores, []);
    await ctx.close();
  });

  test(`${celular}: Lía anota una clase de un día y responde preguntas`, async () => {
    const { ctx, pg, errores } = await abrir(nav, srv.url, celular);
    await registrar(pg);
    await pestana(pg, 'Lía');
    const q = await decir(pg, 'mañana tengo clase a las 4pm');
    assert.match(q, /¿Hasta qué hora es\?/);
    await pg.getByRole('button', { name: 'Hasta las 18:00' }).last().click();
    await pg.waitForTimeout(400);
    // De lunes a viernes, la clase cae en el trabajo (15:00–19:00): desde la 0.12.0 Lía avisa del cruce antes de guardar.
    const igual = pg.getByRole('button', { name: 'Guardar igual' });
    if (await igual.count()) {
      assert.match(await pg.locator('.msg').last().innerText(), /Se cruza con «Trabajo» \([^,]+, 15:00–19:00\)\. ¿Lo guardo igual\?/);
      await igual.last().click();
      await pg.waitForTimeout(400);
    }
    const ex = await pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')).exceptions.filter(e => e.label === 'Clase'));
    assert.deepEqual(ex.map(e => [e.start, e.end]), [['16:00', '18:00']]);
    assert.match(await decir(pg, 'recuérdame si tengo algo mañana'), /de \w+:|libre/);
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}

test('modo oscuro: la app abre sin errores', async () => {
  const { ctx, pg, errores } = await abrir(nav, srv.url, 'Android', { oscuro: true });
  await registrar(pg);
  const fondo = await pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.notEqual(fondo, 'rgb(255, 255, 255)');
  assert.deepEqual(errores, []);
  await ctx.close();
});
