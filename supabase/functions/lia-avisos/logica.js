// LIA · lógica de la Edge Function lia-avisos: envía los recordatorios al teléfono (ver docs/notificaciones.md).
// Sin dependencias de Deno: index.ts le pasa el entorno, fetch y el registro; las pruebas
// (pruebas/avisos-envio.test.mjs) le pasan versiones simuladas.
//
// Dos formas de llamarla (verify_jwt está apagado: la función revisa cada una):
//   - pg_cron, cada minuto, con la cabecera x-lia-cron: envía los avisos que ya tocan.
//   - La app, con la sesión de una cuenta Pro y {accion:'prueba'}: manda un aviso de prueba a sus teléfonos.
// Los registros nunca llevan textos ni direcciones de los teléfonos: solo cuántos se enviaron y los códigos HTTP.

import { aB64url, enviarPush } from './webpush.js';

// Direcciones desde las que la app puede pedir el aviso de prueba (las mismas que lia-ia).
export const ORIGENES = [
  'https://lia-prototipo.jaime-ramos-93c.workers.dev',
  /^https:\/\/[a-z0-9-]+-lia-prototipo\.jaime-ramos-93c\.workers\.dev$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?$/,
];
export const CONTACTO = 'https://lia-prototipo.jaime-ramos-93c.workers.dev';
export const TIPOS = ['examen_manana', 'examen_pronto', 'sesion', 'resumen', 'sin_marcar'];

export function origenPermitido(origen) {
  if (!origen) return true;
  return ORIGENES.some(o => (typeof o === 'string' ? o === origen : o.test(origen)));
}
export function cabecerasCors(origen) {
  return {
    'Access-Control-Allow-Origin': origen && origenPermitido(origen) ? origen : ORIGENES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// La clave secreta del proyecto: la nueva (SUPABASE_SECRET_KEYS) o, si no hay, la service_role de siempre.
// La nueva va solo en apikey; la antigua es un JWT y va también en Authorization.
export function claveServidor(env) {
  try {
    const nuevas = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}');
    const k = nuevas.default || Object.values(nuevas)[0];
    if (k) return { apikey: k };
  } catch { /* sigue con la antigua */ }
  const vieja = env('SUPABASE_SERVICE_ROLE_KEY');
  return vieja ? { apikey: vieja, Authorization: `Bearer ${vieja}` } : null;
}

async function rpc(deps, url, cab, fn, args = {}) {
  const res = await deps.fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...cab }, body: JSON.stringify(args),
  });
  const datos = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${fn}: ${res.status}`);
  return datos;
}

// Las claves VAPID desde Vault; si todavía no existen, las crea (una sola vez) y las guarda.
export async function clavesVapid(deps, url, cab) {
  const fila = (await rpc(deps, url, cab, 'claves_vapid'))?.[0] || {};
  if (fila.publica && fila.privada) return { publica: fila.publica, privada: fila.privada, contacto: CONTACTO };
  const par = await globalThis.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publica = aB64url(await globalThis.crypto.subtle.exportKey('raw', par.publicKey));
  const privada = (await globalThis.crypto.subtle.exportKey('jwk', par.privateKey)).d;
  await rpc(deps, url, cab, 'guardar_claves_vapid', { p_publica: publica, p_privada: privada });
  const otra = (await rpc(deps, url, cab, 'claves_vapid'))?.[0] || {};  // si otra llamada ganó, usa las suyas
  return { publica: otra.publica, privada: otra.privada, contacto: CONTACTO };
}

// Cuánto puede esperar el servicio de push si el teléfono está sin conexión: hasta 1 hora después de la hora del aviso.
export function ttlPara(cuando, ahora = Date.now()) {
  const fin = new Date(cuando).getTime() + 3600 * 1000;
  return Math.max(60, Math.min(3600, Math.round((fin - ahora) / 1000)));
}

async function borrarDispositivos(deps, url, cab, endpoints) {
  for (const e of endpoints) {
    await deps.fetch(`${url}/rest/v1/dispositivos_push?endpoint=eq.${encodeURIComponent(e)}`, { method: 'DELETE', headers: cab }).catch(() => null);
  }
}

// Envía a cada teléfono, de a 10 a la vez. Devuelve los conteos para el registro.
async function enviarTodos(deps, vapid, envios) {
  const cuenta = { enviados: 0, fallidos: 0, borrados: 0, estados: {} };
  const borrar = new Set();
  for (let i = 0; i < envios.length; i += 10) {
    const lote = envios.slice(i, i + 10);
    const res = await Promise.all(lote.map(e => enviarPush(deps.fetch, e.sub, e.mensaje, vapid, e.opciones)));
    res.forEach((r, k) => {
      cuenta.estados[r.estado] = (cuenta.estados[r.estado] || 0) + 1;
      if (r.ok) cuenta.enviados++; else cuenta.fallidos++;
      if (r.borrar) borrar.add(lote[k].sub.endpoint);
    });
  }
  cuenta.borrados = borrar.size;
  return { cuenta, borrar: [...borrar] };
}

export async function manejar(req, deps) {
  const inicio = Date.now();
  const origen = req.headers.get('origin');
  const cors = cabecerasCors(origen);
  const responder = (status, cuerpo, extra = {}) => {
    deps.log({ evento: 'lia-avisos', estado: status, error: cuerpo.error || null, ms: Date.now() - inicio, ...extra });
    return new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return responder(405, { ok: false, error: 'metodo' });

  const url = deps.env('SUPABASE_URL'), cab = claveServidor(deps.env);
  if (!url || !cab) return responder(503, { ok: false, error: 'sin_configuracion' });

  // ---- pg_cron: enviar lo que toca ----
  const secreto = req.headers.get('x-lia-cron');
  if (secreto) {
    let ok = false;
    try { ok = await rpc(deps, url, cab, 'avisos_cron_ok', { p_secreto: secreto }) === true; } catch { ok = false; }
    if (!ok) return responder(401, { ok: false, error: 'secreto' });
    let vapid, filas;
    try {
      vapid = await clavesVapid(deps, url, cab);
      filas = await rpc(deps, url, cab, 'tomar_avisos_vencidos');
    } catch (e) {
      return responder(503, { ok: false, error: 'base' }, { detalle: String(e.message || e).slice(0, 80) });
    }
    const envios = (filas || []).filter(f => TIPOS.includes(f.tipo)).map(f => ({
      sub: { endpoint: f.endpoint, p256dh: f.p256dh, auth: f.auth },
      mensaje: { tipo: f.tipo, ref: f.ref, cuando: f.cuando },
      opciones: { ttl: ttlPara(f.cuando), urgencia: 'high' },
    }));
    if (!envios.length) return responder(200, { ok: true, enviados: 0 }, { avisos: 0 });
    const { cuenta, borrar } = await enviarTodos(deps, vapid, envios);
    await borrarDispositivos(deps, url, cab, borrar);
    return responder(200, { ok: true, ...cuenta }, { avisos: envios.length, ...cuenta });
  }

  // ---- La app: aviso de prueba a los teléfonos de la cuenta ----
  if (!origenPermitido(origen)) return responder(403, { ok: false, error: 'origen' });
  const autorizacion = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/.test(autorizacion)) return responder(401, { ok: false, error: 'sesion' });
  let cuerpo = null;
  try { cuerpo = JSON.parse(await req.text()); } catch { cuerpo = null; }
  if (!cuerpo || cuerpo.accion !== 'prueba') return responder(400, { ok: false, error: 'pedido' });
  const publicable = req.headers.get('apikey') || '';
  const usuario = await deps.fetch(`${url}/auth/v1/user`, { headers: { apikey: publicable, Authorization: autorizacion } })
    .then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (!usuario || !usuario.id) return responder(401, { ok: false, error: 'sesion' });
  // El plan se revisa con la sesión de la persona (mi_suscripcion aplica vencimientos y renovaciones).
  const plan = await deps.fetch(`${url}/rest/v1/rpc/mi_suscripcion`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: publicable, Authorization: autorizacion }, body: '{}',
  }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (!plan || plan.plan !== 'pro') return responder(403, { ok: false, error: 'solo_pro' });
  let vapid, subs;
  try {
    vapid = await clavesVapid(deps, url, cab);
    const r = await deps.fetch(`${url}/rest/v1/dispositivos_push?user_id=eq.${encodeURIComponent(usuario.id)}&select=endpoint,p256dh,auth`, { headers: cab });
    subs = r.ok ? await r.json() : null;
  } catch { subs = null; }
  if (!subs) return responder(503, { ok: false, error: 'base' });
  if (!subs.length) return responder(404, { ok: false, error: 'sin_dispositivos' });
  const envios = subs.map(s => ({ sub: s, mensaje: { tipo: 'prueba', ref: 'prueba', cuando: new Date().toISOString() }, opciones: { ttl: 600, urgencia: 'high' } }));
  const { cuenta, borrar } = await enviarTodos(deps, vapid, envios);
  await borrarDispositivos(deps, url, cab, borrar);
  return responder(200, { ok: cuenta.enviados > 0, ...cuenta, error: cuenta.enviados ? null : 'push' }, { prueba: true, ...cuenta });
}
