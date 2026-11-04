// «Tu semana» (lunes) y «No pude» con reacomodo, con el reloj del navegador fijado en un lunes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servir, lanzar, abrir, registrar, pestana } from './ayuda.mjs';

let srv, nav;
before(async () => { srv = await servir(); nav = await lanzar(); });
after(async () => { await nav?.close(); await srv?.cerrar(); });

for (const disp of ['Android', 'Computadora']) {
  test(`${disp}: «Tu semana» el lunes y «No pude» pasa el bloque a otro hueco`, async () => {
    const { ctx, pg, errores } = await abrir(nav, 'about:blank', disp);
    await pg.clock.install({ time: new Date('2026-11-09T10:00:00-05:00') });  // lunes
    await pg.goto(srv.url);
    await registrar(pg, { evals: ['examen de cálculo el viernes a las 10'] });
    await pestana(pg, 'Hoy');
    let hoy = await pg.locator('#view').innerText();
    assert.match(hoy, /Tu semana/);
    assert.match(hoy, /examen de Cálculo \(viernes\)/);
    await pg.getByRole('button', { name: 'Entendido' }).click();
    await pg.waitForTimeout(200);
    assert.doesNotMatch(await pg.locator('#view').innerText(), /Tu semana\n/);
    // Pasa el primer bloque sin marcarse: Lía pregunta y «No pude» lo reacomoda.
    const f0 = await pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')).frozen.blocks.length);
    await pg.clock.setFixedTime(new Date('2026-11-10T12:00:00-05:00'));
    await pg.reload();
    await pestana(pg, 'Hoy');
    hoy = await pg.locator('#view').innerText();
    assert.match(hoy, /¿Estudiaste Cálculo\?|bloques sin marcar/);
    const unoSolo = await pg.getByRole('button', { name: /^No pude estudiar Cálculo/ }).count();
    if (unoSolo) await pg.getByRole('button', { name: /^No pude estudiar Cálculo/ }).click();
    else { await pg.getByRole('button', { name: 'Revisar mis bloques' }).click(); await pg.getByRole('button', { name: 'Guardar' }).click(); }
    await pg.waitForTimeout(400);
    const aviso = await pg.locator('body').innerText();
    assert.match(aviso, /Pasé .* (al|a \d+ bloques)|quedan pendientes/);
    const f1 = await pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')).frozen.blocks.length);
    assert.ok(f1 > f0, 'hay bloques nuevos en el horario armado');
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}
