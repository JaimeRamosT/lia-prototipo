// LIA · lógica de la Edge Function lia-pagos: cobro de LIA Pro con Mercado Pago Checkout Pro (docs/pagos.md).
// Apagado por defecto: con PAGOS_MODO=demo (o sin definir) no crea pagos. Con «prueba», solo para PAGOS_CORREOS.
//   - POST de la app (con la sesión de la persona):
//       {accion:'estado'}           → el modo que ve esa cuenta (demo, prueba o real).
//       {accion:'crear', periodo}   → pago pendiente con el precio de la base y preferencia de Checkout Pro; devuelve
//                                     la dirección de pago de Mercado Pago.
//       {accion:'revisar', ref}     → al volver de Mercado Pago: busca los pagos de esa referencia y los registra.
//   - POST de Mercado Pago (aviso firmado con MP_WEBHOOK_SECRET): consulta el pago a la API y lo registra.
// verify_jwt está apagado: Mercado Pago no tiene sesión; la de la app se revisa aquí con Auth.
// Nunca se confía en el cuerpo del aviso ni en el monto que mande la app. Los registros nunca llevan tokens, correos,
// montos ni ids de pago. LIA no ve la tarjeta ni el Yape de la persona: solo el resultado y el medio.

export const MP_API = 'https://api.mercadopago.com';
export const PERIODOS = { mes: 'LIA Pro · Mensual', ciclo: 'LIA Pro · Por ciclo (4 meses)' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Mercado Pago espera 22 s la respuesta de un aviso: 10 s para su API más 8 s para la base.
const ESPERA_MP_MS = 10000, ESPERA_BASE_MS = 8000;

// Direcciones desde las que la app puede llamar (las mismas que lia-ia y lia-whatsapp).
export const ORIGENES = [
  'https://lia-prototipo.jaime-ramos-93c.workers.dev',
  /^https:\/\/[a-z0-9-]+-lia-prototipo\.jaime-ramos-93c\.workers\.dev$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?$/,
];
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

// El modo que ve una cuenta: demo (apagado), prueba (solo los correos de PAGOS_CORREOS) o real (todos).
export function modoDe(env, correo) {
  const m = String(env('PAGOS_MODO') || 'demo').trim().toLowerCase();
  if (m === 'real') return 'real';
  if (m !== 'prueba') return 'demo';
  const lista = String(env('PAGOS_CORREOS') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  return lista.includes(String(correo || '').trim().toLowerCase()) ? 'prueba' : 'demo';
}

// Cómo pagó, sin más detalle: Yape, tarjeta o saldo de Mercado Pago.
export function medioDe(pago) {
  if (pago && pago.payment_method_id === 'yape') return 'yape';
  if (pago && ['credit_card', 'debit_card', 'prepaid_card'].includes(pago.payment_type_id)) return 'tarjeta';
  return 'mercadopago';
}

// Firma de los avisos (cabecera x-signature «ts=…,v1=…»): HMAC-SHA256 en hexadecimal de
// «id:<data.id>;request-id:<x-request-id>;ts:<ts>;», sin las partes que no llegaron. Un id alfanumérico va en minúsculas.
export async function firmaValida({ dataId, requestId, cabecera }, secreto, crypto = globalThis.crypto) {
  if (!secreto || !cabecera) return false;
  const partes = Object.fromEntries(String(cabecera).split(',').map(p => p.split('=').map(x => x.trim())).filter(p => p.length === 2));
  if (!partes.ts || !/^[0-9a-f]{64}$/i.test(partes.v1 || '')) return false;
  const manifiesto = (dataId ? `id:${String(dataId).toLowerCase()};` : '') + (requestId ? `request-id:${requestId};` : '') + `ts:${partes.ts};`;
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = new Uint8Array(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(manifiesto)));
  const esperado = [...firma].map(b => b.toString(16).padStart(2, '0')).join('');
  const dada = partes.v1.toLowerCase();
  let dif = 0;
  for (let i = 0; i < 64; i++) dif |= esperado.charCodeAt(i) ^ dada.charCodeAt(i);
  return dif === 0;
}

export function claveServidor(env) {
  try {
    const nuevas = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}');
    const k = nuevas.default || Object.values(nuevas)[0];
    if (k) return { apikey: k };
  } catch { /* sigue con la antigua */ }
  const vieja = env('SUPABASE_SERVICE_ROLE_KEY');
  return vieja ? { apikey: vieja, Authorization: `Bearer ${vieja}` } : null;
}
async function rpc(deps, fn, args) {
  const res = await conEspera(deps, `${deps.env('SUPABASE_URL')}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...claveServidor(deps.env) }, body: JSON.stringify(args),
  });
  const datos = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${fn}: ${res.status}`);
  return datos;
}
async function conEspera(deps, url, opciones = {}, ms = url.startsWith(MP_API) ? ESPERA_MP_MS : ESPERA_BASE_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await deps.fetch(url, { ...opciones, signal: ctl.signal }); } finally { clearTimeout(t); }
}
const mp = (deps, ruta, opciones = {}) => conEspera(deps, MP_API + ruta, {
  ...opciones, headers: { Authorization: `Bearer ${deps.env('MP_ACCESS_TOKEN')}`, 'Content-Type': 'application/json', ...(opciones.headers || {}) },
});

// La persona de la sesión, con el correo confirmado (o null).
async function usuario(deps, req) {
  const autorizacion = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/.test(autorizacion)) return null;
  try {
    const res = await conEspera(deps, `${deps.env('SUPABASE_URL')}/auth/v1/user`, {
      headers: { apikey: req.headers.get('apikey') || deps.env('SUPABASE_ANON_KEY') || '', Authorization: autorizacion },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return u && u.id && u.email && u.email_confirmed_at ? u : null;
  } catch { return null; }
}

// Registra lo que Mercado Pago dice de un pago de LIA. Devuelve el estado (o null si no es de LIA).
async function registrar(deps, pago) {
  const ref = pago && pago.external_reference;
  if (!ref || !UUID.test(ref) || pago.id == null) return null;
  return rpc(deps, 'registrar_pago_mp', {
    p_id: ref, p_pago: String(pago.id), p_estado: String(pago.status || ''), p_monto: Number(pago.transaction_amount),
    p_moneda: String(pago.currency_id || ''), p_medio: medioDe(pago),
  });
}
const ORDEN = ['aprobado', 'duplicado', 'devuelto', 'en_proceso', 'monto_distinto', 'rechazado', 'repetido', 'pendiente'];
const mejor = estados => ORDEN.find(e => estados.includes(e)) || 'pendiente';

export async function manejar(req, deps) {
  const origen = req.headers.get('origin');
  const cors = cabecerasCors(origen);
  const responder = (status, cuerpo, registro) => {
    if (registro) deps.log(registro);
    return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json', ...cors } });
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return responder(405, { ok: false, error: 'metodo' });
  const url = new URL(req.url);

  // ---- Mercado Pago: aviso de un pago ----
  if (req.headers.get('x-signature')) {
    const crudo = await req.text();
    let cuerpo = null;
    try { cuerpo = JSON.parse(crudo); } catch { cuerpo = null; }
    // El id va en la dirección del aviso (así lo firma Mercado Pago); el cuerpo solo da el tipo si falta.
    const dataId = url.searchParams.get('data.id') || url.searchParams.get('id') || '';
    const tipo = url.searchParams.get('type') || url.searchParams.get('topic') || (cuerpo && cuerpo.type) || '';
    const valida = await firmaValida({ dataId: String(dataId), requestId: req.headers.get('x-request-id'), cabecera: req.headers.get('x-signature') },
      deps.env('MP_WEBHOOK_SECRET'), deps.crypto);
    if (!valida) return responder(401, { ok: false, error: 'firma' }, { evento: 'aviso', resultado: 'firma' });
    if (tipo !== 'payment' || !/^[0-9]{1,30}$/.test(String(dataId))) return responder(200, { ok: true }, { evento: 'aviso', resultado: 'ignorado' });
    let pago;
    try {
      const res = await mp(deps, `/v1/payments/${dataId}`);
      if (!res.ok) return responder(503, { ok: false, error: 'mercadopago' }, { evento: 'aviso', resultado: 'mercadopago', http: res.status });
      pago = await res.json();
    } catch { return responder(503, { ok: false, error: 'mercadopago' }, { evento: 'aviso', resultado: 'mercadopago' }); }
    let estado;
    try { estado = await registrar(deps, pago); } catch { return responder(503, { ok: false, error: 'base' }, { evento: 'aviso', resultado: 'base' }); }
    return responder(200, { ok: true }, { evento: 'aviso', resultado: estado || 'ajeno' });
  }

  // ---- La app ----
  if (!origenPermitido(origen)) return responder(403, { ok: false, error: 'origen' });
  const u = await usuario(deps, req);
  if (!u) return responder(401, { ok: false, error: 'sesion' });
  let pedido;
  try { pedido = JSON.parse(await req.text()); } catch { pedido = null; }
  const accion = pedido && pedido.accion;
  const modo = modoDe(deps.env, u.email);

  if (accion === 'estado') return responder(200, { ok: true, modo });

  if (accion === 'crear') {
    if (modo === 'demo') return responder(409, { ok: false, error: 'apagado' });
    if (!PERIODOS[pedido.periodo]) return responder(400, { ok: false, error: 'periodo' });
    let fila;
    try { fila = await rpc(deps, 'crear_pago_mp', { p_uid: u.id, p_periodo: pedido.periodo }); }
    catch { return responder(503, { ok: false, error: 'base' }, { evento: 'crear', resultado: 'base' }); }
    if (!fila || !fila.id) return responder(503, { ok: false, error: 'base' }, { evento: 'crear', resultado: 'base' });
    const base = origen && origenPermitido(origen) ? origen : ORIGENES[0];
    const vuelta = `${base}/?pago=${fila.id}`;
    const preferencia = {
      items: [{ id: `lia-pro-${pedido.periodo}`, title: PERIODOS[pedido.periodo], quantity: 1, currency_id: 'PEN', unit_price: Number(fila.monto) }],
      external_reference: fila.id,
      back_urls: { success: vuelta, failure: vuelta, pending: vuelta },
      // Mercado Pago solo vuelve sola a una dirección https.
      ...(base.startsWith('https://') ? { auto_return: 'approved' } : {}),
      notification_url: `${deps.env('SUPABASE_URL')}/functions/v1/lia-pagos`,
      payment_methods: { installments: 1 },
      statement_descriptor: 'LIA PRO',
    };
    let res, datos;
    try {
      res = await mp(deps, '/checkout/preferences', { method: 'POST', headers: { 'X-Idempotency-Key': fila.id }, body: JSON.stringify(preferencia) });
      datos = await res.json().catch(() => null);
    } catch { return responder(502, { ok: false, error: 'mercadopago' }, { evento: 'crear', resultado: 'mercadopago' }); }
    if (!res.ok || !datos || !datos.init_point) return responder(502, { ok: false, error: 'mercadopago' }, { evento: 'crear', resultado: 'mercadopago', http: res.status });
    return responder(200, { ok: true, ref: fila.id, url: datos.init_point }, { evento: 'crear', resultado: 'ok', modo });
  }

  if (accion === 'revisar') {
    if (!UUID.test(String(pedido.ref || ''))) return responder(400, { ok: false, error: 'ref' });
    let fila;
    try { fila = await rpc(deps, 'pago_mp_de', { p_uid: u.id, p_id: pedido.ref }); }
    catch { return responder(503, { ok: false, error: 'base' }, { evento: 'revisar', resultado: 'base' }); }
    if (!fila || !fila.id) return responder(404, { ok: false, error: 'ref' });
    if (fila.estado === 'aprobado') return responder(200, { ok: true, estado: 'aprobado' });
    const estados = [];
    try {
      const res = await mp(deps, `/v1/payments/search?external_reference=${encodeURIComponent(pedido.ref)}&sort=date_created&criteria=desc&limit=10`);
      if (!res.ok) return responder(200, { ok: true, estado: fila.estado }, { evento: 'revisar', resultado: 'mercadopago', http: res.status });
      const datos = await res.json();
      // Primero el aprobado, si hay: así un intento rechazado anterior no tapa el pago que sí pasó.
      const lista = ((datos && datos.results) || []).filter(p => p && p.external_reference === pedido.ref).slice(0, 10)
        .sort((a, b) => (b.status === 'approved') - (a.status === 'approved'));
      for (const p of lista) { const e = await registrar(deps, p); if (e) estados.push(e); if (e === 'aprobado') break; }
    } catch { return responder(200, { ok: true, estado: fila.estado }, { evento: 'revisar', resultado: 'error' }); }
    const estado = estados.length ? mejor(estados) : fila.estado;
    return responder(200, { ok: true, estado }, { evento: 'revisar', resultado: estado });
  }

  return responder(400, { ok: false, error: 'pedido' });
}
