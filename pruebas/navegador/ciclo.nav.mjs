// Vista de ciclo y alerta de semana pesada, en un celular y en la computadora.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servir, lanzar, abrir, registrar, pestana, anchoDeMas, DISPOSITIVOS } from './ayuda.mjs';

let srv, nav;
before(async () => { srv = await servir(); nav = await lanzar(); });
after(async () => { await nav?.close(); await srv?.cerrar(); });

// Tres evaluaciones en la semana que viene: semana pesada.
const lunes = (() => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d; })();
const dia = k => { const d = new Date(lunes); d.setDate(d.getDate() + k); return `${d.getDate()}/${d.getMonth() + 1}`; };
const evals = [`parcial de cálculo el ${dia(0)} a las 10`, `pc de física el ${dia(2)} a las 7 de la noche`, `examen de química el ${dia(4)} a las 9`];

for (const disp of ['Android', 'Computadora']) {
  test(`${disp}: la alerta de semana pesada lleva a la vista de ciclo`, async () => {
    const { ctx, pg, errores } = await abrir(nav, srv.url, disp);
    await registrar(pg, { evals });
    await pestana(pg, 'Hoy');
    const hoy = await pg.locator('#view').innerText();
    assert.match(hoy, /Se viene una semana pesada|Esta semana es pesada/);
    assert.match(hoy, /3 evaluaciones/);
    await pg.getByRole('button', { name: 'Ver tu ciclo' }).click();
    await pg.waitForTimeout(300);
    assert.match(await pg.locator('#view').innerText(), /Tu ciclo/);
    assert.equal(await pg.locator('.sem').count(), 16);
    assert.equal(await pg.locator('.sem .nivel.pesada').count() >= 1, true);
    assert.equal(await anchoDeMas(pg), false);
    // El inicio del ciclo: las flechas no guardan; al salir del campo, sí (siempre un lunes).
    const ini = pg.locator('input[data-ciclo-ini]');
    await ini.focus(); await pg.keyboard.press('ArrowUp');
    assert.equal(await pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')).settings.cicloInicio), undefined);
    await ini.fill('2026-08-26'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
    assert.equal(await pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')).settings.cicloInicio), '2026-08-24');
    await pg.locator('input[data-ciclo-ini]').fill('2026-09-02'); await pg.getByRole('button', { name: 'Guardar' }).click(); await pg.waitForTimeout(300);
    assert.equal(await pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')).settings.cicloInicio), '2026-08-31');
    await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('lia.app.v1')); delete s.settings.cicloInicio; localStorage.setItem('lia.app.v1', JSON.stringify(s)); });
    await pg.reload(); await pestana(pg, 'Semana'); await pg.getByRole('button', { name: 'Ciclo', exact: true }).click(); await pg.waitForTimeout(300);
    // Tocar la semana pesada abre su semana.
    await pg.locator('.sem:has(.nivel.pesada)').first().click();
    await pg.waitForTimeout(300);
    assert.match(await pg.locator('#view').innerText(), /Tu semana/);
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}
