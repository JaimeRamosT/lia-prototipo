// LIA · lógica de la Edge Function lia-whatsapp: Lía en WhatsApp con la Cloud API de Meta (ver docs/canales.md y
// docs/whatsapp-lia.md).
//   - GET: Meta comprueba el webhook (hub.verify_token = WHATSAPP_VERIFY_TOKEN).
//   - POST de Meta (firmado con WHATSAPP_APP_SECRET): mensajes que llegan. «LIA 123456» vincula el número. Después,
//     Lía entiende igual que en la app: las reglas de index.html (reglas.js) y, en Pro y con cupo, la IA de lia-ia
//     (ia.js). Lo que se puede guardar lo propone; con «sí» queda confirmado y la app lo guarda al abrirse.
//   - POST de pg_cron (cabecera x-lia-cron): avisos de toda la agenda publicada, 15 minutos antes (estudio, clases y
//     eventos o rutinas) y 2 horas antes de una evaluación. Fuera de las 24 horas, solo con la plantilla Utility.
//   - POST de la app (con la sesión de la persona, {accion:'codigo', numero}): pide el código y se lo envía por WhatsApp
//     con la plantilla de autenticación WHATSAPP_PLANTILLA_CODIGO; la persona lo escribe en la app.
// verify_jwt está apagado: Meta y pg_cron no tienen sesión; cada llamada se revisa aquí.
// No cambia el horario: los datos viven en el navegador. Los registros nunca llevan textos, títulos ni números, y
// la base nunca guarda el texto de los mensajes (solo lo entendido, hasta que la app lo guarda).
import { L } from './reglas.js';
import * as IA from './ia.js';

export const API = 'https://graph.facebook.com';
export const VERSION_API = 'v23.0';
export const ZONA = -5 * 60;  // Lima, sin horario de verano

// Direcciones desde las que la app puede pedir el código (las mismas que lia-ia).
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
// Igual que pedir_codigo_whatsapp(): solo dígitos; un celular peruano de 9 dígitos lleva el 51 delante.
export function normalizarNumero(n) {
  let v = String(n || '').replace(/[^0-9]/g, '');
  if (v.length === 9 && v[0] === '9') v = '51' + v;
  return /^[0-9]{8,15}$/.test(v) ? v : null;
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
async function rpc(deps, fn, args = {}) {
  const res = await deps.fetch(`${deps.env('SUPABASE_URL')}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...claveServidor(deps.env) }, body: JSON.stringify(args),
  });
  const datos = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${fn}: ${res.status}`);
  return datos;
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
// X-Hub-Signature-256 = «sha256=» + HMAC-SHA256 del cuerpo tal cual llegó, con el secreto de la app de Meta.
export async function firmaValida(cuerpo, firma, secreto, crypto = globalThis.crypto) {
  if (!secreto || typeof firma !== 'string' || !firma.startsWith('sha256=')) return false;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const esperada = 'sha256=' + hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(cuerpo)));
  if (esperada.length !== firma.length) return false;
  let d = 0;
  for (let i = 0; i < esperada.length; i++) d |= esperada.charCodeAt(i) ^ firma.charCodeAt(i);
  return d === 0;
}

export const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
// Una fecha y hora en Lima a partir de un instante.
export function enLima(iso) {
  const d = new Date(new Date(iso).getTime() + ZONA * 60000);
  return { dia: d.getUTCDay(), fecha: d.getUTCDate(), mes: d.getUTCMonth(), hora: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` };
}
// Medianoche de Lima de hoy + k días, como instante.
export function inicioDia(ahora, k = 0) {
  const d = new Date(ahora.getTime() + ZONA * 60000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + k) - ZONA * 60000);
}

// Lo que solo existe en WhatsApp: vincular, pausar y reanudar avisos, y las preguntas cortas de la agenda («semana»).
// Lo demás lo entienden las reglas de la app (reglas.js). «mañana tengo examen…» no es la agenda: lo ven las reglas.
export function intencion(texto) {
  const n = norm(texto);
  const cod = n.match(/\blia\s*(\d{6})\b/) || (/^\d{6}$/.test(n) ? [n, n] : null);
  if (cod) return { tipo: 'vincular', codigo: cod[1] };
  if (/^(pausa|pausar|silencio|stop|detener|no mas avisos|ya no me avises|desactivar avisos)$/.test(n)) return { tipo: 'pausa' };
  if (/^(avisos|activar avisos|reanudar|reanuda|avisame)$/.test(n)) return { tipo: 'avisos' };
  if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|ayuda|menu|que puedes hacer|hey)$/.test(n)) return { tipo: 'ayuda' };
  if (/\bpasado manana\b/.test(n)) return { tipo: 'agenda', desde: 2, dias: 1, nombre: 'Pasado mañana' };
  if (/\bmanana\b/.test(n)) return { tipo: 'agenda', desde: 1, dias: 1, nombre: 'Mañana' };
  if (/\b(semana|proximos dias|7 dias)\b/.test(n)) return { tipo: 'agenda', desde: 0, dias: 7, nombre: 'Esta semana' };
  if (/\b(hoy|ahora|que tengo|que me toca|mi agenda|mi dia)\b/.test(n)) return { tipo: 'agenda', desde: 0, dias: 1, nombre: 'Hoy' };
  if (/\bproxim[oa]s? (evaluacion|examen|parcial|prueba|practica|entrega|control)\b|\bcuando es mi (examen|parcial|evaluacion)\b/.test(n)) return { tipo: 'proxima' };
  return { tipo: 'otro' };
}
// «sí» y «no» a una propuesta. «sí», «dale», «guárdalo» confirman; «ok», «ya», «listo» solo si la propuesta es de los
// últimos 5 minutos (son respuestas a cualquier cosa). «no, déjalo», «cancela»… descartan.
const SI_FUERTE = /^(si|dale|confirmo|guardalo|anotalo|cambialo|quitalo|de una)( (porfa|por favor|guardalo|anotalo|cambialo|quitalo|confirmo|dale|gracias))*$/;
const SI_DEBIL = /^(ok|okey|okay|ya|listo|claro|perfecto|correcto|va)( (porfa|por favor|guardalo|anotalo|cambialo|quitalo|confirmo|dale|gracias))*$/;
const NO = /^(no|nop|nel|cancela|cancelar|cancelalo|mejor no|olvidalo|dejalo|no lo guardes|no gracias)( (dejalo|gracias|cancela|mejor no))*$/;
export const esSi = (t, { reciente = true } = {}) => SI_FUERTE.test(norm(t)) || (reciente && SI_DEBIL.test(norm(t)));
export const esNo = t => NO.test(norm(t));
export const EVALS_GRATIS = 3;  // igual que FREE_EVALS de index.html (lo revisa pruebas/whatsapp-lia.test.mjs)

export function textoAgenda(filas, nombre, dias) {
  if (!filas.length) return `${nombre} no tienes sesiones de estudio ni evaluaciones en LIA.`;
  const lineas = filas.map(f => {
    const a = enLima(f.inicio), b = enLima(f.fin);
    const cuando = dias > 1 ? `${DIAS[a.dia].slice(0, 3)} ${a.fecha} ${a.hora}` : a.hora;
    return `• ${cuando}${f.tipo === 'evaluacion' ? '' : `–${b.hora}`} ${f.titulo}`;
  });
  return `${nombre} en LIA:\n${lineas.join('\n')}`;
}
// El recordatorio de cada tipo de agenda_canales (tomar_avisos_whatsapp): evaluación 2 horas antes; estudio, clase y
// otro (eventos de un día y rutinas), 15 minutos antes. Con plantilla Utility va su texto, con la hora y el título.
export function textoAviso(f) {
  const a = enLima(f.inicio), b = enLima(f.fin);
  if (f.tipo === 'evaluacion') return `Hola, soy Lía. A las ${a.hora} tienes ${f.titulo}. ¡Éxitos!`;
  const que = f.tipo === 'estudio' ? `empieza tu sesión: ${f.titulo}` : `empieza: ${f.titulo}`;
  return `Hola, soy Lía. A las ${a.hora} ${que} (hasta las ${b.hora}). Escribe «pausa» si no quieres estos avisos.`;
}
export const AYUDA = 'Hola, soy Lía. Por aquí puedes:\n• Anotar: «parcial de Cálculo el jueves a las 9», «hoy salgo del trabajo a las 9», «ayer estudié 2 horas de Física» o «pasaron mi parcial de Cálculo al viernes».\n• Preguntar: «¿qué tengo mañana?», «semana» o «¿cuál es mi próxima evaluación?».\nAntes de guardar algo, te pregunto. Escribe «pausa» si no quieres avisos.';
export const SIN_VINCULAR = 'Hola, soy Lía. Para usarme aquí, entra a LIA, ve a Perfil y, en WhatsApp, escribe tu número. Luego envíame el código que te doy.';
export const CONFIRMADO = 'Listo, lo anoté. Lo verás en LIA en unos segundos si la tienes abierta; si no, al abrirla.';
export const DESCARTADO = 'Ok, no guardé nada.';
export const NADA_PENDIENTE = 'No tengo nada pendiente por guardar. Cuéntame qué anoto, por ejemplo: «parcial de Cálculo el jueves a las 9».';
export const VENCIDA = 'Esa propuesta ya venció: pasaron más de 30 minutos. Vuelve a contarme qué anoto.';
export const VIEJO = 'Ese mensaje ya no vale. Responde al último que te mandé o cuéntame de nuevo qué anoto.';
// Sin el contexto de la app, Lía no puede anotar por aquí: la persona lo activa en Perfil (consentimiento).
export const SIN_CONTEXTO = 'Para que anote por aquí lo que me pides, actívalo en LIA: ve a Perfil y, en WhatsApp, toca «Activar Lía en WhatsApp». Mientras, pregúntame «¿qué tengo hoy?».';
const SOLO_TEXTO = 'Por ahora solo leo mensajes de texto. Cuéntame qué anoto o pregúntame «¿qué tengo hoy?».';
// Los mismos topes que usar_ia() y los avisos de la app (IA_AVISOS de index.html).
const IA_AVISOS = {
  cupo_dia: 'Ya usaste tus 25 mensajes con IA de hoy. Hasta mañana te respondo con lo básico.',
  cupo_mes: 'Ya usaste tus 300 mensajes con IA de este mes. Hasta el próximo mes te respondo con lo básico.',
};
const CHARLA = {
  gracias: '¡De nada! Aquí estoy para lo que necesites.', ok: 'Listo.', despedida: '¡Nos vemos!',
  quien: 'Soy Lía, tu secretaria de estudio. Anoto tus horarios y tus evaluaciones, y te armo un horario para estudiar en tus horas libres.',
  animo: 'Descansar también cuenta. Si hoy no te da, dime por ejemplo «hoy no puedo estudiar en la noche» y lo tomo en cuenta.',
};
// Cada botón lleva el id de su propuesta: tocar uno de un mensaje viejo no confirma otra cosa.
const botonesSiNo = id => [[`si:${id}`, 'Sí, guárdalo'], [`no:${id}`, 'No, déjalo']];
// Un título de botón de hasta 20 caracteres, cortado en un espacio.
const titulo = t => { t = String(t); if (t.length <= 20) return t; const c = t.slice(0, 20), k = c.lastIndexOf(' '); return k > 8 ? c.slice(0, k) : c; };

// ---------- Hora de Lima ----------
// Las reglas de la app leen la hora del reloj local (getDay, getHours). El servidor corre en UTC: se les pasa una
// fecha cuyo reloj local marca la hora de Lima, sea cual sea la zona del servidor.
export function relojLima(instante) {
  const d = new Date(new Date(instante).getTime() + ZONA * 60000);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}
// Medianoche de Lima de una fecha AAAA-MM-DD, como instante.
const medianoche = f => { const [y, m, d] = f.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) - ZONA * 60000); };

// El estado mínimo con el que entienden las reglas, a partir del contexto que publicó la app (contextoWhatsapp).
export function estadoDesde(ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const lista = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []);
  return {
    v: 1,
    settings: { wake: '07:00', sleep: '23:00', maxDay: 180, block: 60, minBlock: 30, autonomy: 'auto', name: '', ...(c.settings && typeof c.settings === 'object' ? c.settings : {}) },
    evals: lista(c.evals).map(({ hecho, sinHueco, ...e }) => e), commitments: lista(c.commitments), done: [], exceptions: [],
  };
}

// ---------- Lo que dice Lía ----------
const DIAS_C = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function diasTexto(ds) {
  const s = [...ds].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)), k = s.join();
  if (k === '1,2,3,4,5') return 'de lunes a viernes';
  if (k === '1,2,3,4,5,6') return 'de lunes a sábado';
  if (k === '1,2,3,4,5,6,0') return 'todos los días';
  if (k === '6,0') return 'los fines de semana';
  return 'los ' + s.map(d => DIAS_C[d]).join(', ').replace(/, ([^,]*)$/, ' y $1');
}
// «hoy», «mañana», «ayer», «el sábado» (esta semana) o «el jue 5 nov».
function cuando(f, n) {
  const k = Math.round((medianoche(f) - medianoche(L.ymd(n))) / 864e5);
  return k === 0 ? 'hoy' : k === 1 ? 'mañana' : k === -1 ? 'ayer' : k > 1 && k < 7 ? `el ${L.DIAS[L.fromYmd(f).getDay()]}` : `el ${L.fechaCorta(f)}`;
}
const tipoEval = t => (L.EVAL_TYPES[t] || L.EVAL_TYPES.parcial).label;
const itemTexto = i => (i.kind === 'eval' ? `${tipoEval(i.type)} de ${i.course}, ${L.fechaCorta(i.date)} a las ${i.time}` : `${i.name}, ${diasTexto(i.days)}, de ${i.start} a ${i.end}`);
function cambioTexto(x, n) {
  if (x.libre) {
    if (x.label === 'Salida temprano') return `${cuando(x.date, n)} sales a las ${x.start}`;
    if (x.label === 'Entrada más tarde') return `${cuando(x.date, n)} entras a las ${x.end}`;
    return `${cuando(x.date, n)} no tienes ${x.label.replace(/^Sin /, '')} (${x.start}–${x.end})`;
  }
  return `${x.label}, ${cuando(x.date, n)} de ${x.start} a ${x.end}`;
}
// Lo que Lía entendió, para pedir el «sí».
export function propuestaTexto(p, state, n) {
  const ev = id => state.evals.find(x => x.id === id);
  if (p.intent === 'add') return `Entendí: ${p.items.map(itemTexto).join('; ')}. ¿Lo guardo en tu LIA?`;
  if (p.intent === 'except') return `Entendí: ${p.exs.map(x => cambioTexto(x, n)).join('; ')}. ¿Lo guardo en tu LIA?`;
  if (p.intent === 'log') return `Entendí: estudiaste ${L.hrs(p.min)} de ${p.course} ${cuando(p.date, n)}. ¿Lo anoto en tu LIA?`;
  if (p.intent === 'cambiaEval') return `Entendí: ${L.nombreEval(ev(p.evalId))} pasa al ${L.fechaCorta(p.date)} a las ${p.time}. ¿Lo cambio en tu LIA?`;
  const e = ev(p.evalId);
  return `Entendí: quitar ${L.nombreEval(e)} del ${L.fechaCorta(e.date)}. ¿Lo quito de tu LIA?`;
}

// ---------- Enviar ----------
// Si Meta no lo acepta, devuelve el estado HTTP y el código de error de Meta (solo el número, para el registro).
async function postMeta(deps, cuerpo) {
  const token = deps.env('WHATSAPP_TOKEN'), id = deps.env('WHATSAPP_PHONE_ID');
  if (!token || !id) return { ok: false, error: 'sin_configurar' };
  try {
    const res = await deps.fetch(`${API}/${deps.env('WHATSAPP_API_VERSION') || VERSION_API}/${id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(cuerpo),
    });
    if (res.ok) return { ok: true };
    let codigo = null;
    try { const j = await res.json(); codigo = j && j.error && Number.isInteger(j.error.code) ? j.error.code : null; } catch { /* sin cuerpo */ }
    return { ok: false, error: 'meta', http: res.status, codigo };
  } catch { return { ok: false, error: 'red' }; }
}
// El código de vinculación, con la plantilla de autenticación (categoría «Autenticación», botón «Copiar código»).
// Si la plantilla no tiene botón, Meta responde 400 y se reintenta solo con el cuerpo.
export async function enviarCodigo(deps, numero, codigo) {
  const nombre = deps.env('WHATSAPP_PLANTILLA_CODIGO');
  if (!nombre) return { ok: false, error: 'sin_plantilla' };
  const plantilla = botones => ({ messaging_product: 'whatsapp', to: numero, type: 'template', template: {
    name: nombre, language: { code: deps.env('WHATSAPP_PLANTILLA_CODIGO_IDIOMA') || 'es' },
    components: [{ type: 'body', parameters: [{ type: 'text', text: codigo }] },
      ...(botones ? [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: codigo }] }] : [])] } });
  const r = await postMeta(deps, plantilla(true));
  return r.ok || r.http !== 400 ? r : postMeta(deps, plantilla(false));
}
// Un texto; con botones, como mensaje interactivo (hasta 3, de 20 caracteres). Fuera de la ventana de 24 horas,
// Meta exige una plantilla aprobada (WHATSAPP_PLANTILLA, con dos variables: la hora y lo que toca).
export async function enviar(deps, numero, texto, { plantilla = null, botones = null, alternativa = '' } = {}) {
  texto = texto.length > 1024 ? texto.slice(0, 1020) + '…' : texto;
  const comoTexto = { messaging_product: 'whatsapp', to: numero, type: 'text', text: { body: alternativa ? `${texto}\n${alternativa}` : texto, preview_url: false } };
  if (plantilla && deps.env('WHATSAPP_PLANTILLA')) {
    return postMeta(deps, { messaging_product: 'whatsapp', to: numero, type: 'template', template: { name: deps.env('WHATSAPP_PLANTILLA'), language: { code: deps.env('WHATSAPP_PLANTILLA_IDIOMA') || 'es' },
      components: [{ type: 'body', parameters: plantilla.map(t => ({ type: 'text', text: String(t).slice(0, 60) })) }] } });
  }
  if (botones && botones.length) {
    const r = await postMeta(deps, { messaging_product: 'whatsapp', to: numero, type: 'interactive', interactive: { type: 'button', body: { text: texto.slice(0, 1024) },
      action: { buttons: botones.slice(0, 3).map(([id, t]) => ({ type: 'reply', reply: { id, title: titulo(t) } })) } } });
    return r.ok || r.http !== 400 ? r : postMeta(deps, comoTexto);  // si Meta no acepta los botones, va como texto
  }
  return postMeta(deps, comoTexto);
}

// ---------- Entender ----------
// El borrador guardado (lo que Lía preguntó), si sigue vigente: 10 minutos, como en la app.
function borradorDe(p, n) {
  if (!p || p.estado !== 'borrador' || !p.intencion || typeof p.intencion !== 'object') return null;
  const b = { ...p.intencion, at: relojLima(p.creado).getTime() };
  return L.borradorVigente(b, n) ? b : null;
}
const preguntaDe = (b, state, n) => L.preguntaPara(b.items[b.i], L.faltaDe(b.items[b.i]), state, n);

// La IA de lia-ia (Groq y, si no responde, Gemini), solo en Pro y con el mismo cupo de usar_ia(). Descuenta 1 solo
// si respondió. Devuelve { r } con la intención ya revisada por validarIA(), o { aviso } si no hay cupo.
async function conIA(deps, numero, texto, state, n, borr) {
  const provs = IA.proveedoresDe(deps.env);
  if (!provs.length) return {};
  let cupo = null;
  try { cupo = await rpc(deps, 'usar_ia_whatsapp', { p_numero: numero, p_sumar: false }); } catch { return {}; }
  if (!cupo || cupo.permitido !== true) return { aviso: (cupo && IA_AVISOS[cupo.motivo]) || null };
  const pad = v => String(v).padStart(2, '0');
  const historial = borr ? [{ de: 'lia', texto: preguntaDe(borr, state, n).texto }] : [];
  const pedido = IA.leerPedido(JSON.stringify({ mensaje: String(texto).slice(0, IA.LIMITES.mensaje), historial,
    contexto: { ...L.contextoIA(state, n), ahora: `${L.ymd(n)}T${pad(n.getHours())}:${pad(n.getMinutes())}:00-05:00` } }));
  if (pedido.error) return {};
  let g = null, prov = null;
  for (const p of provs) {
    g = await p.pedir(deps, pedido, { tiempo: provs.length > 1 ? (p.respaldo ? IA.TIEMPO_RESPALDO : IA.TIEMPO_PRINCIPAL) : IA.TIEMPO_PRINCIPAL });
    prov = p.nombre;
    if (!g.error) break;
  }
  if (!g || g.error) return { proveedor: prov, fallo: g && g.error };
  try { await rpc(deps, 'usar_ia_whatsapp', { p_numero: numero, p_sumar: true }); } catch { /* respondió igual */ }
  const v = L.validarIA(g.respuesta, state, n);
  return { r: v.intent === 'help' ? null : v, proveedor: prov };
}

// Solo los campos que la app necesita para guardar cada cosa.
const soloCambio = x => ({ date: x.date, start: x.start, end: x.end, label: x.label, ...(x.cat ? { cat: x.cat } : {}), ...(x.libre ? { libre: true, ref: x.ref } : {}) });

async function agendaEntre(deps, numero, desde, hasta, nombre, dias, extra) {
  const filas = await rpc(deps, 'agenda_whatsapp', { p_numero: numero, p_desde: desde.toISOString(), p_hasta: hasta.toISOString() });
  return { tipo: 'agenda', texto: textoAgenda(Array.isArray(filas) ? filas : [], nombre, dias) + extra };
}

// Responde lo que se entendió: propone lo que se puede guardar, pregunta lo que falta o contesta.
async function responderA(deps, numero, r, { est, state, n, ahora, borr, aviso }) {
  const hoy = L.ymd(n), pend = porGuardar(est);
  // Como evalRoom() de la app: las próximas que cuenta la app (también las de Google) más las confirmadas por guardar.
  const ctx = est.contexto || {}, proximas = Number.isInteger(ctx.proximas) ? ctx.proximas : state.evals.filter(e => e.date >= hoy).length;
  const ocupadas = proximas + (Number(est.confirmadas_evals) || 0), room = est.pro ? Infinity : Math.max(0, EVALS_GRATIS - ocupadas);
  const nuevas = items => items.filter(i => i.kind === 'eval' && (!i.date || i.date >= hoy)).length;
  const limite = { tipo: 'limite', texto: `En Gratis puedes tener hasta ${EVALS_GRATIS} evaluaciones próximas y ya tienes ${Math.min(ocupadas, EVALS_GRATIS)}. Con LIA Pro no hay límite.` };
  if (r.intent === 'simula') r = r.base;  // «¿y si…?»: por WhatsApp se propone sin simular
  // Sin el contexto que publica la app (la persona no activó Lía en WhatsApp), solo agenda y avisos.
  if (!est.contexto && ['pregunta', 'add', 'except', 'log', 'cambiaEval', 'quitaEval'].includes(r.intent)) return { tipo: 'sin_contexto', texto: SIN_CONTEXTO };
  if (r.intent === 'pregunta') {
    if (r.borrador.intent === 'add' && nuevas(r.borrador.items) > room) return limite;
    const opciones = (r.opciones || []).filter(o => o && !o.otra && o.set).slice(0, 3).map(o => ({ t: titulo(o.t), set: o.set }));
    const id = await rpc(deps, 'guardar_propuesta_whatsapp', { p_numero: numero, p_estado: 'borrador', p_intencion: { intent: r.borrador.intent, items: r.borrador.items, i: r.borrador.i, opciones } });
    return { tipo: 'pregunta', texto: r.texto, botones: opciones.map((o, k) => [`op${k}:${id}`, o.t]), alternativa: opciones.length ? `Responde, por ejemplo: «${opciones[0].t}».` : '' };
  }
  if (r.intent === 'charla') {
    const t = r.tipo === 'saludo' || r.tipo === 'ayuda' ? AYUDA : CHARLA[r.tipo] || 'Listo.', p = borr ? preguntaDe(borr, state, n) : null;
    return { tipo: 'charla', texto: p ? `${t}\n${p.texto}` : t };
  }
  if (r.intent === 'help' && borr) return { tipo: 'help', texto: `No te entendí. ${preguntaDe(borr, state, n).texto}` };

  let guardar = null;
  if (r.intent === 'add') { if (nuevas(r.items) > room) return limite; guardar = { intent: 'add', items: r.items }; }
  else if (r.intent === 'except') guardar = { intent: 'except', exs: r.exs.map(soloCambio) };
  else if (r.intent === 'log') {
    const e = state.evals.find(x => x.id === r.evalId);
    if (!e || !r.min) return { tipo: 'help', texto: AYUDA };
    guardar = { intent: 'log', evalId: e.id, course: e.course, date: r.date || hoy, min: r.min };
  } else if (r.intent === 'cambiaEval' || r.intent === 'quitaEval') {
    const e = state.evals.find(x => x.id === r.evalId);
    if (!e) return { tipo: 'sin_eval', texto: 'No encontré esa evaluación. Revísala en LIA, en Evaluaciones.' };
    if (r.intent === 'quitaEval') guardar = { intent: 'quitaEval', evalId: e.id };
    else {
      const date = r.date || e.date, time = r.time || e.time;
      if (date === e.date && time === e.time) return { tipo: 'igual', texto: `${L.cap(L.nombreEval(e))} ya es el ${L.fechaCorta(e.date)} a las ${e.time}.` };
      guardar = { intent: 'cambiaEval', evalId: e.id, date, time };
    }
  }
  if (guardar) {
    const id = await rpc(deps, 'guardar_propuesta_whatsapp', { p_numero: numero, p_estado: 'pendiente', p_intencion: guardar });
    return { tipo: 'propuesta:' + guardar.intent, texto: propuestaTexto(guardar, state, n), botones: botonesSiNo(id), alternativa: 'Responde «sí» o «no».' };
  }
  if (r.intent === 'agenda') {
    const f = r.date || hoy, man = L.ymd(L.addDays(n, 1)), m0 = medianoche(f);
    return agendaEntre(deps, numero, f === hoy ? ahora : m0, new Date(m0.getTime() + 864e5), f === hoy ? 'Hoy' : f === man ? 'Mañana' : L.cap(L.fechaLarga(f)), 1, pend);
  }
  if (r.intent === 'next') {
    const e = state.evals.filter(x => x.date >= hoy).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
    return { tipo: 'next', texto: e ? `Tu próxima evaluación: ${tipoEval(e.type).toLowerCase()} de ${e.course}, el ${L.fechaLarga(e.date)} a las ${e.time}.` : 'No tienes evaluaciones próximas en LIA.' };
  }
  if (r.intent === 'progress') {
    const up = ((est.contexto && est.contexto.evals) || []).filter(e => e && e.date >= hoy);
    return { tipo: 'progress', texto: up.length ? up.map(e => `${e.course}: ${L.hrs(e.hecho || 0)} de ${L.hrs(Math.round((e.hours || 0) * 60))}${e.sinHueco > 0 ? ` (${L.hrs(e.sinHueco)} sin hueco)` : ''}`).join('\n') + pend
      : 'No tienes evaluaciones próximas. ¿Me dices cuándo es la siguiente?' };
  }
  if (r.intent === 'replan') return { tipo: 'replan', texto: est.pro ? 'En LIA Pro tu semana se reorganiza sola: ábrela y la verás al día.' : 'Para rearmar tu semana, abre LIA y toca «Rearmar mi semana» en Hoy (en Gratis, una vez por semana).' };
  if (r.intent === 'aviso' && r.texto) return { tipo: 'aviso', texto: r.texto };
  return { tipo: 'ayuda', texto: aviso ? `${aviso}\n\n${AYUDA}` : AYUDA };
}

async function atender(deps, numero, entrada, ahora) {
  const texto = String(entrada.texto || ''), q = entrada.boton ? { tipo: 'boton' } : intencion(texto);
  // «si:<id>», «no:<id>» u «op0:<id>»: la acción y la propuesta a la que responde.
  const bm = entrada.boton ? /^(si|no|op\d)(?::([0-9a-f-]{36}))?$/.exec(String(entrada.boton)) : null, boton = bm ? bm[1] : null;
  if (q.tipo === 'vincular') {
    const ok = await rpc(deps, 'vincular_whatsapp', { p_numero: numero, p_codigo: q.codigo });
    return { tipo: q.tipo, texto: ok === true ? 'Listo, vinculé este número con tu LIA. Te aviso 15 minutos antes de cada actividad y 2 horas antes de cada evaluación. Pregúntame «¿qué tengo hoy?» o cuéntame qué anoto.' : 'Ese código no es válido o ya venció. Pide uno nuevo en LIA, en Perfil, WhatsApp.' };
  }
  const est = await rpc(deps, 'whatsapp_estado', { p_numero: numero });
  if (!est || typeof est !== 'object') return { tipo: 'sin_vincular', texto: SIN_VINCULAR };
  if (q.tipo === 'pausa' || q.tipo === 'avisos') {
    await rpc(deps, 'avisos_whatsapp_numero', { p_numero: numero, p_activos: q.tipo === 'avisos' });
    return { tipo: q.tipo, texto: q.tipo === 'pausa' ? 'Listo, ya no te envío avisos. Escribe «avisos» para volver a activarlos.' : 'Listo, te vuelvo a avisar antes de cada actividad y evaluación.' };
  }
  const n = relojLima(ahora), state = estadoDesde(est.contexto), prop = est.propuesta && typeof est.propuesta === 'object' ? est.propuesta : null;
  const borr = borradorDe(prop, n), pendiente = prop && prop.estado === 'pendiente';
  // Un botón de un mensaje viejo (de otra propuesta, o de una que ya no está) no hace nada.
  if (entrada.boton && (!bm || !bm[2] || !prop || prop.id !== bm[2] || (bm[1].startsWith('op') && !borr))) return { tipo: 'boton_viejo', texto: VIEJO };
  const reciente = !!(prop && ahora.getTime() - new Date(prop.creado).getTime() <= 5 * 60000);
  const si = boton ? boton === 'si' : esSi(texto, { reciente }), no = boton ? boton === 'no' : esNo(texto);
  // ¿Responde a la propuesta?
  if (si && pendiente) {
    const ok = await rpc(deps, 'confirmar_propuesta_whatsapp', { p_numero: numero });
    return ok === true ? { tipo: 'confirmada', texto: CONFIRMADO + (est.pro ? ' Ahí reacomodo tu estudio.' : '') } : { tipo: 'vencida', texto: VENCIDA };
  }
  if (no && (pendiente || borr)) { await rpc(deps, 'descartar_propuesta_whatsapp', { p_numero: numero }); return { tipo: 'descartada', texto: DESCARTADO }; }
  if (si && !borr) return { tipo: 'nada', texto: NADA_PENDIENTE };
  // ¿Responde a lo que Lía preguntó? Un botón completa el borrador como una respuesta rápida de la app.
  let r = null;
  if (borr) {
    const k = boton && /^op\d$/.test(boton) ? Number(boton.slice(2)) : -1, o = k >= 0 && Array.isArray(borr.opciones) ? borr.opciones[k] : null;
    r = o && o.set ? L.continuarBorrador({ ...borr, items: borr.items.map((x, j) => (j === borr.i ? { ...x, ...o.set } : x)) }, state, n) : L.respuestaBorrador(borr, texto, state, n);
  }
  if (!r) r = L.interpret(texto, state, n);
  let aviso = null, ia = null;
  if (L.pideIA(r)) {
    // Los atajos «semana», «hoy», «mañana»: en una frase corta, directo; en una larga y en Pro, primero la IA
    // («hoy salí tarde y no pude estudiar» no es la agenda de hoy).
    const q2 = intencion(texto), corta = norm(texto).split(' ').length <= 4;
    const agenda = () => agendaEntre(deps, numero, q2.desde === 0 ? ahora : inicioDia(ahora, q2.desde), inicioDia(ahora, q2.desde + q2.dias), q2.nombre, q2.dias, porGuardar(est));
    if (q2.tipo === 'agenda' && (corta || !est.pro)) return agenda();
    if (q2.tipo === 'proxima') r = { intent: 'next' };
    else if (est.pro && est.contexto) {   // la IA solo con Lía activada en WhatsApp (su aviso menciona la IA)
      ia = await conIA(deps, numero, texto, state, n, borr); aviso = ia.aviso || null;
      if (ia.r) r = ia.r; else if (q2.tipo === 'agenda') return agenda();
    }
  }
  const out = await responderA(deps, numero, r, { est, state, n, ahora, borr, aviso });
  return ia && ia.proveedor ? { ...out, ia: ia.proveedor + (ia.r ? '' : ia.fallo ? `:${ia.fallo}` : ':no_entendio') } : out;
}

// Lo confirmado por WhatsApp que la app todavía no guarda (se dice al final de la agenda y del avance).
function porGuardar(est) { const k = Number(est.confirmadas) || 0; return k ? `\nOjo: tienes ${k} ${k === 1 ? 'cambio' : 'cambios'} por guardar. ${k === 1 ? 'Se guarda' : 'Se guardan'} cuando abras LIA.` : ''; }

const sha256 = async (s, crypto = globalThis.crypto) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

export async function manejar(req, deps) {
  const inicio = Date.now(), ahora = deps.ahora ? deps.ahora() : new Date();
  const origen = req.headers.get('origin'), cors = cabecerasCors(origen);
  const responder = (status, cuerpo, extra = {}) => {
    deps.log({ evento: 'lia-whatsapp', estado: status, ms: Date.now() - inicio, ...extra });
    return new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status, headers: { ...cors, 'Content-Type': typeof cuerpo === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8' } });
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const u = new URL(req.url);
  if (req.method === 'GET') {
    const esperado = deps.env('WHATSAPP_VERIFY_TOKEN');
    if (esperado && u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === esperado) return responder(200, u.searchParams.get('hub.challenge') || '', { paso: 'verificacion' });
    return responder(403, 'No', { paso: 'verificacion' });
  }
  if (req.method !== 'POST') return responder(405, { ok: false, error: 'metodo' });
  if (!deps.env('SUPABASE_URL') || !claveServidor(deps.env)) return responder(503, { ok: false, error: 'sin_configuracion' });

  // ---- pg_cron: avisos ----
  const secreto = req.headers.get('x-lia-cron');
  if (secreto) {
    let ok = false;
    try { ok = await rpc(deps, 'avisos_cron_ok', { p_secreto: secreto }) === true; } catch { ok = false; }
    if (!ok) return responder(401, { ok: false, error: 'secreto' });
    if (!deps.env('WHATSAPP_TOKEN') || !deps.env('WHATSAPP_PHONE_ID')) return responder(200, { ok: true, enviados: 0, sin_configurar: true });
    let filas;
    try { filas = await rpc(deps, 'tomar_avisos_whatsapp'); } catch { return responder(503, { ok: false, error: 'base' }); }
    let enviados = 0;
    const errores = [];
    for (const f of filas || []) {
      const a = enLima(f.inicio);
      const r = await enviar(deps, f.numero, textoAviso(f), { plantilla: [a.hora, f.titulo] });
      if (r.ok) enviados++; else errores.push(r.http || r.error);
    }
    return responder(200, { ok: true, enviados }, { avisos: (filas || []).length, enviados, errores: errores.slice(0, 5) });
  }

  // ---- La app: enviar el código de vinculación por WhatsApp ----
  const autorizacion = req.headers.get('authorization') || '';
  if (!req.headers.get('x-hub-signature-256') && /^Bearer\s+\S+$/.test(autorizacion)) {
    if (!origenPermitido(origen)) return responder(403, { ok: false, error: 'origen' });
    let pedido;
    try { pedido = JSON.parse(await req.text()); } catch { pedido = null; }
    if (!pedido || pedido.accion !== 'codigo') return responder(400, { ok: false, error: 'pedido' });
    const numero = normalizarNumero(pedido.numero);
    if (!numero) return responder(400, { ok: false, error: 'numero_invalido' }, { paso: 'codigo' });
    let res, datos;
    try {
      res = await deps.fetch(`${deps.env('SUPABASE_URL')}/rest/v1/rpc/pedir_codigo_whatsapp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: req.headers.get('apikey') || deps.env('SUPABASE_ANON_KEY') || '', Authorization: autorizacion },
        body: JSON.stringify({ p_numero: String(pedido.numero) }),
      });
      datos = await res.json().catch(() => null);
    } catch { return responder(503, { ok: false, error: 'ocupado' }, { paso: 'codigo' }); }
    if (!res.ok || typeof datos !== 'string') {
      const m = String((datos && (datos.message || datos.code)) || '');
      const error = /espera|numero_ocupado|numero_invalido/.exec(m)?.[0] || (res.status === 401 || /42501|sesion|JWT/.test(m) ? 'sesion' : 'ocupado');
      return responder(error === 'ocupado' ? 503 : error === 'sesion' ? 401 : 400, { ok: false, error }, { paso: 'codigo' });
    }
    const env = await enviarCodigo(deps, numero, datos);
    if (env.ok) {
      try { await rpc(deps, 'codigo_whatsapp_enviado', { p_numero: numero }); } catch { return responder(200, { ok: true, enviado: false, motivo: 'base' }, { paso: 'codigo' }); }
      return responder(200, { ok: true, enviado: true }, { paso: 'codigo' });
    }
    // Sin plantilla o si Meta no lo envió: la app muestra el código para que la persona se lo envíe a LIA.
    // En el registro, el estado HTTP y el código de error de Meta (por ejemplo, 132001: no encuentra la plantilla).
    return responder(200, { ok: true, enviado: false, motivo: env.error }, { paso: 'codigo', http: env.http || null, meta: env.codigo || null });
  }

  // ---- Meta: mensajes que llegan ----
  const crudo = await req.text();
  if (!(await firmaValida(crudo, req.headers.get('x-hub-signature-256'), deps.env('WHATSAPP_APP_SECRET'), deps.crypto))) return responder(401, { ok: false, error: 'firma' });
  let datos;
  try { datos = JSON.parse(crudo); } catch { return responder(400, { ok: false, error: 'cuerpo' }); }
  const mensajes = [];
  for (const e of (datos && datos.entry) || []) for (const c of e.changes || []) for (const m of (c.value && c.value.messages) || []) mensajes.push(m);
  const tipos = [];
  for (const m of mensajes.slice(0, 10)) {
    const numero = String(m.from || '').replace(/[^0-9]/g, '');
    if (!numero) continue;
    // Meta reenvía un mensaje si tardamos en responder: el mismo id no se atiende dos veces (la base guarda su hash).
    if (m.id) {
      let nuevo = true;
      try { nuevo = (await rpc(deps, 'whatsapp_visto', { p_hash: await sha256(String(m.id), deps.crypto) })) !== false; } catch { nuevo = true; }
      if (!nuevo) { tipos.push('repetido'); continue; }
    }
    const b = m.type === 'interactive' && m.interactive && m.interactive.button_reply;
    const entrada = m.type === 'text' && m.text && m.text.body ? { texto: m.text.body }
      : b ? { texto: String(b.title || ''), boton: String(b.id || '') }
      : m.type === 'button' && m.button && m.button.text ? { texto: String(m.button.text) } : null;
    let r;
    try {
      r = entrada ? await atender(deps, numero, entrada, ahora) : { tipo: 'no_texto', texto: SOLO_TEXTO };
    } catch (e) {
      // En el registro, solo el nombre de la función de la base que falló (rpc lanza «nombre: estado»).
      const fn = /^([a-z_]+): \d+$/.exec(String((e && e.message) || ''));
      r = { tipo: 'error' + (fn ? `:${fn[1]}` : ''), texto: 'Tuve un problema para revisar tu LIA. Inténtalo en un momento.' };
    }
    const env = await enviar(deps, numero, r.texto, { botones: r.botones, alternativa: r.alternativa });
    tipos.push(r.tipo + (r.ia ? `[${r.ia}]` : '') + (env.ok ? '' : `:${env.http || env.error}${env.codigo ? ':' + env.codigo : ''}`));
  }
  // A Meta siempre se le responde 200 para que no reintente; lo que falló queda en el registro (sin textos ni números).
  return responder(200, { ok: true }, { mensajes: mensajes.length, tipos });
}
