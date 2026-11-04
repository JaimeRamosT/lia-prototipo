// Tablero de uso (con Supabase simulado) y contador de amanecidas en la semana.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servir, lanzar, abrir, registrar, pestana, anchoDeMas } from './ayuda.mjs';

let srv, nav;
before(async () => { srv = await servir(); nav = await lanzar(); });
after(async () => { await nav?.close(); await srv?.cerrar(); });
const RESUMEN = { dias: 14, hasta: '2026-11-03', instalaciones: 10, registros: 6, base_d1: 8, volvieron_d1: 4, base_d3: 5, volvieron_d3: 2, noches_estudio: 12, noches_madrugada: 3, abren_por_dia: [{ dia: '2026-11-02', n: 5 }, { dia: '2026-11-03', n: 7 }] };

for (const disp of ['iPhone', 'Computadora']) {
  test(`${disp}: el tablero muestra los porcentajes`, async () => {
    const { ctx, pg, errores } = await abrir(nav, 'about:blank', disp);
    await ctx.unroute('**/*.supabase.co/**');
    await ctx.route('**/rest/v1/rpc/metricas_resumen', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RESUMEN) }));
    await pg.goto(srv.url + 'tablero.html');
    await pg.waitForTimeout(500);
    const t = await pg.locator('main').innerText();
    for (const x of ['60 %', '50 %', '40 %', '25 %', 'Actualizado hasta el 03/11.']) assert.ok(t.includes(x), x);
    assert.equal(await pg.locator('.dia').count(), 2);
    assert.equal(await anchoDeMas(pg), false);
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}

test('la semana avisa de una amanecida', async () => {
  const { ctx, pg, errores } = await abrir(nav, 'about:blank', 'Android');
  await pg.clock.install({ time: new Date('2026-11-11T10:00:00-05:00') });  // miércoles
  await pg.goto(srv.url);
  await registrar(pg, { evals: ['examen de cálculo el viernes a las 10'] });
  await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('lia.app.v1')); const e = s.evals[0];
    s.done.push({ id: 'x1', evalId: e.id, date: '2026-11-10', start: '00:30', min: 60 }, { id: 'x2', evalId: e.id, date: '2026-11-10', start: '20:00', min: 60 });
    localStorage.setItem('lia.app.v1', JSON.stringify(s)); });
  await pg.reload();
  await pestana(pg, 'Semana');
  const t = await pg.locator('#view').innerText();
  assert.match(t, /Te amaneciste/);
  assert.match(t, /1 de 2 noches de estudio terminaron antes de medianoche/);
  assert.deepEqual(errores, []);
  await ctx.close();
});
