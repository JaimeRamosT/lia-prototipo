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
  const sb = { filas, quitadas: [], contextos: [], agendas: 0, borrar: true, falla: false };
  await ctx.route('**/rest/v1/rpc/**', async r => {
    const fn = r.request().url().split('/rpc/')[1].split('?')[0], b = r.request().postDataJSON() || {};
    const resp = d => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
    if (fn === 'canales_estado') return sb.falla ? r.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"no"}' }) : resp({ calendario: null, whatsapp: { numero: '51987654321', verificado: true, avisos: true } });
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
const fila = (id, intencion) => ({ id, creado: new Date().toISOString(), intencion });
const evalNueva = (course, k, type = 'parcial') => ({ intent: 'add', items: [{ kind: 'eval', type, course, date: fecha(k), time: '10:00', hours: 3 }] });
const traer = async (pg, sb, filas) => { sb.filas = filas; await pg.evaluate(() => traerWhatsapp()); };
const guardado = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')));

for (const dispositivo of ['iPhone', 'Computadora']) {
  test(`${dispositivo}: guarda lo confirmado por WhatsApp con un solo Deshacer, sin repetir y explicando lo que no vale`, async () => {
    const filas = [fila('p1', evalNueva('Física', 4))];
    const { ctx, pg, errores, sb } = await preparar(dispositivo, filas);
    await pg.evaluate(() => cargarCanales());
    await pg.getByText(/^Guardé por WhatsApp: Parcial de Física/).waitFor({ timeout: 10000 });
    let s = await guardado(pg);
    assert.ok(s.evals.some(e => e.course === 'Física' && e.date === fecha(4) && e.time === '10:00' && e.hours === 3));
    assert.deepEqual(sb.quitadas, ['p1'], 'la app la borra del servidor al guardarla');
    // Sin aceptar el aviso en Perfil, no se publica el contexto (una cuenta que ya estaba vinculada).
    await new Promise(r => setTimeout(r, 3500));
    assert.equal(sb.contextos.length, 0, 'sin «Activar», nada de evaluaciones ni rutinas en el servidor');
    await pestana(pg, 'Perfil');
    await pg.getByText(/Tus mensajes no se guardan/).first().waitFor();
    await pg.getByRole('button', { name: 'Activar Lía en WhatsApp' }).click();
    await pg.getByText('Listo: ya puedes pedirle a Lía por WhatsApp que anote algo.').waitFor();
    const ctx0 = sb.contextos.at(-1);
    assert.ok(ctx0 && ctx0.evals.some(e => e.course === 'Física') && ctx0.proximas >= 2, 'al activar, se publica el contexto');
    assert.ok(!JSON.stringify(sb.contextos).includes('ana@correo.pe'));
    assert.equal(await pg.getByRole('button', { name: 'Activar Lía en WhatsApp' }).count(), 0);
    await pg.getByText('Qué guarda LIA en su servidor').waitFor();
    // Si el servidor no la borró, no se guarda dos veces.
    sb.borrar = false;
    await traer(pg, sb, filas);
    assert.equal((await guardado(pg)).evals.filter(e => e.course === 'Física').length, 1);
    sb.borrar = true;
    // Varias juntas: un solo aviso y un solo Deshacer para todas.
    const fis = (await guardado(pg)).evals.find(e => e.course === 'Física');
    await traer(pg, sb, [fila('p2', { intent: 'except', exs: [{ date: fecha(2), start: '18:00', end: '20:00', label: 'Cumpleaños', cat: 'ocio' }] }),
      fila('p3', { intent: 'log', evalId: fis.id, course: 'Física', date: fecha(0), min: 60 }),
      fila('p4', { intent: 'cambiaEval', evalId: fis.id, date: fecha(5), time: '11:00' })]);
    // De lunes a viernes, el cumpleaños (18:00) cae en el trabajo (15:00–19:00): se guarda igual y el aviso lo dice (0.12.0).
    await pg.getByText(/^Guardé 3 cambios que me pediste por WhatsApp(; «Cumpleaños» se cruza con «Trabajo» \([^,]+, 15:00–19:00\))?\.$/).waitFor();
    s = await guardado(pg);
    assert.ok(s.exceptions.some(x => x.label === 'Cumpleaños') && s.done.some(d => d.evalId === fis.id && d.min === 60) && s.evals.find(e => e.id === fis.id).date === fecha(5));
    await pg.locator('#toastbox').getByRole('button', { name: 'Deshacer' }).click();
    await pg.getByText('Listo, lo dejé como estaba.').waitFor();
    s = await guardado(pg);
    assert.ok(!s.exceptions.some(x => x.label === 'Cumpleaños') && !s.done.some(d => d.evalId === fis.id) && s.evals.find(e => e.id === fis.id).date === fecha(4), 'Deshacer quita las tres');
    // En Gratis, la que no cabe se explica; y lo que ya no existe también.
    await traer(pg, sb, [fila('p5', evalNueva('Química', 6)), fila('p6', evalNueva('Historia', 7))]);
    await pg.getByText(/^Guardé por WhatsApp: Parcial de Química.*No pude guardar otro: en Gratis ya tienes 3 evaluaciones próximas\. Si quieres, pídemelo otra vez\.$/).waitFor();
    assert.ok(!(await guardado(pg)).evals.some(e => e.course === 'Historia'));
    await traer(pg, sb, [fila('p7', { intent: 'log', evalId: 'no-existe', course: 'Química', date: fecha(0), min: 60 })]);
    await pg.getByText('No pude guardar uno: esa evaluación ya no está en LIA. Si quieres, pídemelo otra vez.').waitFor();
    await traer(pg, sb, [fila('p8', { intent: 'quitaEval', evalId: fis.id })]);
    await pg.getByText(/^Guardé por WhatsApp: quitar parcial de Física/).waitFor();
    assert.ok(!(await guardado(pg)).evals.some(e => e.id === fis.id));
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}

// Iteración 3: lo confirmado por WhatsApp que se cruza con otra actividad se guarda igual, y el aviso dice con qué.
test('Android: «Guardé X; se cruza con Y» cuando lo confirmado por WhatsApp cae en el trabajo', async () => {
  let k = 1; while ([0, 6].includes(new Date(Date.now() + k * 864e5).getDay())) k++;   // el próximo día de lunes a viernes
  const { ctx, pg, errores } = await preparar('Android', [fila('c1', { intent: 'except', exs: [{ date: fecha(k), start: '16:00', end: '17:00', label: 'Cita médica', cat: 'otro' }] })]);
  await pg.evaluate(() => cargarCanales());
  await pg.getByText(/^Guardé por WhatsApp: Cita médica, .+; se cruza con «Trabajo» \([^,]+, 15:00–19:00\)\.$/).waitFor();
  assert.ok((await guardado(pg)).exceptions.some(x => x.label === 'Cita médica'), 'se guardó igual');
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('si no puede revisar los canales al abrir, no da por desvinculado a nadie y deja reintentar', async () => {
  const { ctx, pg, errores, sb } = await preparar('iPhone', []);
  sb.falla = true;
  await pg.evaluate(() => { ui.canales = undefined; return cargarCanales(); });
  await pestana(pg, 'Perfil');
  await pg.getByText('No pude revisar tu WhatsApp. Revisa tu conexión.').waitFor();
  assert.equal(await pg.getByRole('button', { name: 'Vincular WhatsApp' }).count(), 0);
  sb.falla = false;
  await pg.getByRole('button', { name: 'Reintentar' }).click();
  await pg.getByText(/Vinculado: \+51987654321/).waitFor();
  assert.deepEqual(errores.filter(e => !/503/.test(e)), []);
  await ctx.close();
});
