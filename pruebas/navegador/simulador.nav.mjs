// Simulador «¿y si…?» en el chat: Lía dice qué pasaría y no cambia nada hasta que confirmas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servir, lanzar, abrir, registrar, pestana, decir } from './ayuda.mjs';

let srv, nav;
before(async () => { srv = await servir(); nav = await lanzar(); });
after(async () => { await nav?.close(); await srv?.cerrar(); });
const guardado = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')));
const mensajes = pg => pg.evaluate(() => [...document.querySelectorAll('.msg')].map(m => m.innerText).join('\n'));

for (const disp of ['iPhone', 'Computadora']) {
  test(`${disp}: «¿y si…?» explica, espera y aplica solo al confirmar`, async () => {
    const { ctx, pg, errores } = await abrir(nav, srv.url, disp);
    await registrar(pg);
    await pestana(pg, 'Lía');
    const antes = await guardado(pg);
    await decir(pg, '¿y si mañana no voy a trabajar?');
    assert.match(await mensajes(pg), /Lo probé sin cambiar nada/);
    assert.equal((await guardado(pg)).exceptions.length, antes.exceptions.length, 'todavía no cambia nada');
    await pg.getByRole('button', { name: 'Confirmar' }).last().click();
    await pg.waitForTimeout(400);
    assert.equal((await guardado(pg)).exceptions.length, antes.exceptions.length + 1, 'al confirmar, se anota');
    // Una evaluación de prueba: se descarta con «Corregir».
    await decir(pg, '¿y si el viernes tengo examen de química a las 9?');
    assert.match(await mensajes(pg), /química/i);
    await pg.getByRole('button', { name: 'Corregir' }).last().click();
    await pg.waitForTimeout(300);
    assert.equal((await guardado(pg)).evals.length, antes.evals.length, 'no se agregó la evaluación');
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}
