// Preventa con Yape (docs/preventa.md): con el número configurado, el checkout dice cuánto yapear, a quién, y abre
// WhatsApp con el mensaje escrito; el pago de prueba queda solo en modo pruebas. Sin número, todo sigue como antes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servir, lanzar, abrir, registrar } from './ayuda.mjs';

let srv, nav;
before(async () => { srv = await servir(); nav = await lanzar(); });
after(async () => { await nav?.close(); await srv?.cerrar(); });

async function preparar(dispositivo, { pruebas = false, sub = null } = {}) {
  const { ctx, pg, errores } = await abrir(nav, srv.url + (pruebas ? '?pruebas=1' : ''), dispositivo);
  let fila = sub;
  await ctx.route('**/rest/v1/rpc/mi_suscripcion', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fila || { plan: 'gratis' }) }));
  // La sesión que supabase-js guarda (sin ella, la app cierra la cuenta al abrir el cliente).
  const sesion = () => localStorage.setItem('lia.auth', JSON.stringify({ access_token: 'sesion-de-prueba', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: { id: 'u1', email: 'ana@correo.pe', aud: 'authenticated', role: 'authenticated' } }));
  await ctx.addInitScript(sesion);
  await registrar(pg);
  await pg.evaluate(sesion);
  await pg.evaluate(() => { state.cuenta = { id: 'u1', email: 'ana@correo.pe' }; save(); });
  return { ctx, pg, errores, activar: f => { fila = f; } };
}
const configurar = pg => pg.evaluate(() => Object.assign(PREVENTA, { yape: '987654321', titular: 'Coco Pérez', whatsapp: '51987654321' }));
const abrirPago = async pg => { await pg.evaluate(() => openPaywall('plans')); await pg.locator('.sheet').getByRole('button', { name: 'Continuar' }).click(); };

for (const dispositivo of ['iPhone', 'Computadora']) {
  test(`${dispositivo}: con el número configurado, el checkout es la preventa con Yape y abre WhatsApp con el mensaje`, async () => {
    const { ctx, pg, errores, activar } = await preparar(dispositivo);
    await configurar(pg);
    await abrirPago(pg);
    const hoja = pg.locator('.sheet');
    await hoja.getByText('Pagar LIA Pro · preventa').waitFor();
    assert.match(await hoja.innerText(), /Yapea S\/ 34\.90 al 987 654 321 \(Coco Pérez\)/);
    assert.equal(await hoja.getByRole('button', { name: 'Simular pago aprobado' }).count(), 0, 'sin pago gratis');
    const href = await hoja.getByRole('link', { name: 'Enviar por WhatsApp' }).getAttribute('href');
    assert.ok(href.startsWith('https://wa.me/51987654321?text='));
    assert.match(decodeURIComponent(href.split('text=')[1]), /quiero LIA Pro por ciclo \(S\/ 34\.90\)\. Ya yapeé\. Mi correo de LIA es ana@correo\.pe\. Número de operación: $/);
    // Todavía no activado, y después sí.
    await hoja.getByRole('button', { name: 'Ya me activaron: revisar mi plan' }).click();
    await pg.getByText('Todavía no está activo. Si ya nos escribiste, lo activamos en menos de 24 horas.').waitFor();
    const hasta = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
    activar({ plan: 'pro', periodo: 'ciclo', medio: 'yape', desde: new Date().toISOString().slice(0, 10), hasta, renovacion_automatica: false, demo: false });
    await hoja.getByRole('button', { name: 'Ya me activaron: revisar mi plan' }).click();
    await pg.getByText(/^Listo: tienes LIA Pro hasta el /).waitFor();
    assert.equal(await pg.evaluate(() => isPro()), true);
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}

test('sin el número configurado, o en modo pruebas, sigue el checkout de prueba', async () => {
  let { ctx, pg, errores } = await preparar('iPhone');
  await abrirPago(pg);
  await pg.locator('.sheet').getByRole('button', { name: 'Simular pago aprobado' }).waitFor();
  assert.deepEqual(errores, []);
  await ctx.close();
  ({ ctx, pg, errores } = await preparar('iPhone', { pruebas: true }));
  await configurar(pg);
  await abrirPago(pg);
  await pg.locator('.sheet').getByRole('button', { name: 'Simular pago aprobado' }).waitFor();
  assert.deepEqual(errores, []);
  await ctx.close();
});
