// Lía en WhatsApp (docs/whatsapp-lia.md), del lado de la app: lo que la persona confirmó por WhatsApp se guarda al
// abrir LIA, con un solo Deshacer y sin guardarse dos veces; lo que ya no vale se explica. Supabase se simula.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servir, lanzar, abrir, registrar, pestana } from './ayuda.mjs';

const pad = n => String(n).padStart(2, '0');
const fecha = k => { const d = new Date(); d.setDate(d.getDate() + k); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

let srv, nav;
before(async () => { srv = await servir(); nav = await lanzar(); });
after(async () => { await nav?.close(); await srv?.cerrar(); });

async function preparar(dispositivo, filas) {
  const { ctx, pg, errores } = await abrir(nav, srv.url, dispositivo);
  const sb = { filas, quitadas: [], contextos: [], agendas: 0, borrar: true };
  await ctx.route('**/rest/v1/rpc/**', async r => {
    const fn = r.request().url().split('/rpc/')[1].split('?')[0], b = r.request().postDataJSON() || {};
    const resp = d => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
    if (fn === 'canales_estado') return resp({ calendario: null, whatsapp: { numero: '51987654321', verificado: true, avisos: true } });
    if (fn === 'propuestas_whatsapp_confirmadas') return resp(sb.filas);
    if (fn === 'quitar_propuestas_whatsapp') { sb.quitadas.push(...b.p_ids); if (sb.borrar) sb.filas = sb.filas.filter(f => !b.p_ids.includes(f.id)); return resp(b.p_ids.length); }
    if (fn === 'publicar_contexto_whatsapp') { sb.contextos.push(b.p_contexto); return resp(true); }
    if (fn === 'publicar_agenda') { sb.agendas++; return resp(1); }
    return resp(null);
  });
  const sesion = () => localStorage.setItem('lia.auth', JSON.stringify({ access_token: 'sesion-de-prueba', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: { id: 'u1', email: 'ana@correo.pe', aud: 'authenticated', role: 'authenticated' } }));
  await ctx.addInitScript(sesion);
  await registrar(pg);
  await pg.evaluate(sesion);
  await pg.evaluate(() => { state.cuenta = { id: 'u1', email: 'ana@correo.pe' }; save(); });
  return { ctx, pg, errores, sb };
}
const guardado = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')));

for (const dispositivo of ['iPhone', 'Computadora']) {
  test(`${dispositivo}: al abrir LIA guarda lo confirmado por WhatsApp, con Deshacer y sin repetir`, async () => {
    const filas = [{ id: 'p1', creado: new Date().toISOString(), intencion: { intent: 'add', items: [{ kind: 'eval', type: 'parcial', course: 'Física', date: fecha(4), time: '10:00', hours: 4 }] } }];
    const { ctx, pg, errores, sb } = await preparar(dispositivo, filas);
    await pg.evaluate(() => cargarCanales());
    await pg.getByText(/Guardé lo que me pediste por WhatsApp: Parcial de Física/).waitFor({ timeout: 10000 });
    let s = await guardado(pg);
    assert.ok(s.evals.some(e => e.course === 'Física' && e.date === filas[0].intencion.items[0].date && e.time === '10:00' && e.hours === 4));
    assert.deepEqual(sb.quitadas, ['p1'], 'la app la borra del servidor al guardarla');
    // La agenda y el contexto se publican con la evaluación nueva, para que WhatsApp quede al día.
    await pg.waitForFunction(() => true);
    await new Promise(r => setTimeout(r, 3500));
    assert.ok(sb.contextos.at(-1) && sb.contextos.at(-1).evals.some(e => e.course === 'Física'), 'el contexto llega con la evaluación nueva');
    assert.ok(!JSON.stringify(sb.contextos).includes('ana@correo.pe'));
    // Si el servidor no la borró, no se guarda dos veces.
    sb.borrar = false; sb.filas = filas;
    await pg.evaluate(() => traerWhatsapp());
    s = await guardado(pg);
    assert.equal(s.evals.filter(e => e.course === 'Física').length, 1);
    // Deshacer la quita.
    sb.filas = [{ id: 'p2', creado: new Date().toISOString(), intencion: { intent: 'add', items: [{ kind: 'eval', type: 'examen', course: 'Arte', date: fecha(6), time: '08:00', hours: 3 }] } }];
    await pg.evaluate(() => traerWhatsapp());
    await pg.getByText(/Guardé lo que me pediste por WhatsApp: Examen de Arte/).waitFor();
    await pg.locator('#toastbox').getByRole('button', { name: 'Deshacer' }).click();
    await pg.getByText('Listo, lo dejé como estaba.').waitFor();
    s = await guardado(pg);
    assert.ok(!s.evals.some(e => e.course === 'Arte'));
    // Lo que ya no vale se explica y no se guarda.
    sb.filas = [{ id: 'p3', creado: new Date().toISOString(), intencion: { intent: 'log', evalId: 'no-existe', course: 'Química', date: fecha(0), min: 60 } }];
    await pg.evaluate(() => traerWhatsapp());
    await pg.getByText('No pude guardar uno: esa evaluación ya no está en LIA.').waitFor();
    s = await guardado(pg);
    assert.ok(!s.done.some(d => d.evalId === 'no-existe'));
    // La tarjeta de WhatsApp explica qué se guarda en el servidor.
    await pestana(pg, 'Perfil');
    await pg.getByText(/Tus mensajes no se guardan/).first().waitFor();
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}
