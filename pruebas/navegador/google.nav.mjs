// «Conectar con Google» (docs/google.md) en un iPhone simulado y en una computadora: conectar, volver de Google,
// elegir qué entra, recibir un cambio de Google al instante, escribir lo de LIA y desconectar. lia-google y Google se
// simulan; la sesión de Supabase se guarda en el navegador como la deja supabase-js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servir, lanzar, abrir, registrar, pestana } from './ayuda.mjs';

const pad = n => String(n).padStart(2, '0');
const dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };
const lunesPasado = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };
const cal = (...extra) => ['BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:ingles@google.com', `DTSTART;TZID=America/Lima:${lunesPasado()}T200000`, `DTEND;TZID=America/Lima:${lunesPasado()}T220000`, 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH', 'SUMMARY:Inglés', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:fisica@google.com', `DTSTART:${dia(5)}T140000Z`, `DTEND:${dia(5)}T160000Z`, 'SUMMARY:Parcial de Física', 'END:VEVENT',
  ...extra, 'END:VCALENDAR', ''].join('\r\n');

let srv, nav;
before(async () => { srv = await servir(); nav = await lanzar(); });
after(async () => { await nav?.close(); await srv?.cerrar(); });

async function preparar(dispositivo, { configurado = true } = {}) {
  const { ctx, pg, errores } = await abrir(nav, srv.url, dispositivo);
  const g = { conectado: false, ics: cal(), escritos: [], pedidos: [] };
  await ctx.route('**/functions/v1/lia-google', async r => {
    const b = r.request().postDataJSON(), resp = d => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...d }) });
    g.pedidos.push(b.accion);
    if (r.request().headers().authorization !== 'Bearer sesion-de-prueba') return r.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false,"error":"sesion"}' });
    if (b.accion === 'estado') return resp({ configurado, conectado: g.conectado, estado: g.conectado ? 'activa' : null, avisos: true });
    if (b.accion === 'iniciar') { assert.match(b.nonce, /^[a-f0-9]{64}$/); g.nonce = b.nonce; return resp({ url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=e1' }); }
    if (b.accion === 'confirmar') { if (b.estado !== 'e1' || b.nonce !== g.nonce) return r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"estado"}' }); g.conectado = true; return resp({ avisos: true }); }
    if (b.accion === 'leer') return resp({ ics: g.ics });
    if (b.accion === 'escribir') { g.escritos.push(b.eventos); return resp({ creados: b.eventos.length, borrados: 0 }); }
    if (b.accion === 'desconectar') { g.conectado = false; return resp({}); }
  });
  // Google da el permiso y vuelve a LIA; la conexión se cierra cuando la app confirma con su nonce.
  await ctx.route('https://accounts.google.com/**', r => r.fulfill({ status: 302, headers: { Location: srv.url + '?google=ok&e=e1' } }));
  // La sesión que supabase-js guarda y recupera (también al volver de Google).
  const sesion = () => localStorage.setItem('lia.auth', JSON.stringify({ access_token: 'sesion-de-prueba', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: { id: 'u1', email: 'ana@correo.pe', aud: 'authenticated', role: 'authenticated' } }));
  await ctx.addInitScript(sesion);
  await registrar(pg);
  await pg.evaluate(sesion);
  await pg.evaluate(() => { state.cuenta = { id: 'u1', email: 'ana@correo.pe' }; ui.canales = {}; save(); });
  await pestana(pg, 'Perfil');
  return { ctx, pg, errores, g };
}
const guardado = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')));

for (const dispositivo of ['iPhone', 'Computadora']) {
  test(`${dispositivo}: conecta con Google, trae, recibe un cambio al instante, escribe y desconecta`, async () => {
    const { ctx, pg, errores, g } = await preparar(dispositivo);
    await pg.getByRole('button', { name: 'Conectar con Google' }).click();
    // Vuelve de Google: la vista previa se abre sola.
    const hoja = pg.locator('.sheet');
    await hoja.getByRole('button', { name: 'Agregar a LIA' }).waitFor({ timeout: 15000 });
    assert.ok(!/google=|e=/.test(await pg.evaluate(() => location.search)), 'la dirección queda limpia');
    assert.ok(g.pedidos.includes('confirmar'), 'la app confirma con su nonce');
    assert.match(await hoja.innerText(), /Inglés[\s\S]*Parcial de Física/);
    await hoja.getByRole('button', { name: 'Agregar a LIA' }).click();
    await pg.getByText(/Agregué 1 rutina y 1 evaluación de tu Google Calendar/).waitFor();
    let s = await guardado(pg);
    assert.equal(s.gcal.fuente, 'google');
    assert.equal(s.gcal.url, undefined, 'con Google conectado no hay dirección secreta');
    assert.deepEqual(s.commitments.filter(c => c.gcal).map(c => [c.name, c.days, c.start, c.end]), [['Inglés', [2, 4], '20:00', '22:00']]);
    // Lo de LIA se escribe en Google (estudio y rutinas propias), sin lo que vino de Google.
    await pg.waitForFunction(() => true);
    await new Promise(r => setTimeout(r, 3500));
    const ultimo = g.escritos.at(-1);
    assert.ok(ultimo && ultimo.some(e => e.tipo === 'estudio'), 'el estudio va a Google');
    assert.ok(ultimo.some(e => e.titulo === 'Trabajo'), 'las rutinas de LIA van a Google');
    assert.ok(!ultimo.some(e => e.titulo === 'Inglés' || e.titulo === 'Parcial de Física'), 'lo de Google no vuelve a Google');
    // Un cambio en Google: el aviso de Realtime hace que LIA lea al instante.
    g.ics = cal('BEGIN:VEVENT', 'UID:charla@google.com', `DTSTART;TZID=America/Lima:${dia(2)}T180000`, `DTEND;TZID=America/Lima:${dia(2)}T190000`, 'SUMMARY:Charla de empleabilidad', 'END:VEVENT');
    await pg.evaluate(() => leerGoogleLuego(0));
    await pg.getByText(/Traje 1 cambio de tu Google Calendar/).waitFor();
    s = await guardado(pg);
    assert.ok(s.exceptions.some(x => x.label === 'Charla de empleabilidad' && x.gcal));
    // Desconectar y conservar lo traído.
    await pestana(pg, 'Perfil');
    await pg.getByRole('button', { name: 'Desconectar', exact: true }).click();
    await pg.getByRole('button', { name: 'Desconectar y conservarlos' }).click();
    await pg.getByText(/desconecté Google/).waitFor();
    assert.ok(g.pedidos.includes('desconectar'));
    await pg.getByRole('button', { name: 'Conectar con Google' }).waitFor();
    s = await guardado(pg);
    assert.ok(s.commitments.some(c => c.name === 'Inglés'), 'lo traído se queda');
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}

test('sin las claves de Google en el servidor, la tarjeta sigue con el enlace iCal', async () => {
  const { ctx, pg, errores } = await preparar('iPhone', { configurado: false });
  await pg.getByRole('button', { name: 'Traer mi Google Calendar' }).waitFor();
  assert.equal(await pg.getByRole('button', { name: 'Conectar con Google' }).count(), 0);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('volver de Google en otro navegador (sin el nonce) no conecta nada', async () => {
  const { ctx, pg, errores, g } = await preparar('iPhone');
  await pg.goto(srv.url + '?google=ok&e=e1');
  await pg.getByText('No pude terminar la conexión con Google. Toca «Conectar con Google» otra vez en un momento.').first().waitFor();
  assert.equal(await pg.evaluate(() => document.activeElement && document.activeElement.dataset.a), 'google-conectar', 'el foco va al botón para reintentar');
  assert.ok(!g.pedidos.includes('confirmar'));
  assert.equal(g.conectado, false);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('si la persona cancela en Google, LIA lo dice y no guarda nada', async () => {
  const { ctx, pg, errores } = await preparar('Computadora');
  await pg.goto(srv.url + '?google=cancelado');
  await pg.getByText('No conecté Google porque cancelaste. Cuando quieras, toca «Conectar con Google».').first().waitFor();
  assert.equal((await guardado(pg)).gcal, undefined);
  assert.deepEqual(errores, []);
  await ctx.close();
});
