// LIA · audios de WhatsApp, solo Pro (docs/whatsapp-lia.md e iteración 3, docs/iteracion-3.md sección 3).
// lia-whatsapp (logica.js) revisa el plan, el consentimiento y el cupo de la IA; aquí se descarga el audio de Meta y
// Groq lo transcribe (Whisper, whisper-large-v3-turbo, en español). El texto sigue el mismo camino que un mensaje
// escrito. El audio y la transcripción solo viven en la memoria de esta llamada: no se guardan ni se registran.
// pruebas/whatsapp-audio.test.mjs lo prueba con Meta y Groq simulados.

export const AUDIO_MAX_BYTES = 5 * 1024 * 1024;   // 5 MB
export const AUDIO_MAX_SEGUNDOS = 120;            // 2 minutos
export const TIEMPO_DESCARGA = 10000;             // datos del audio y archivo, juntos
export const TIEMPO_TRANSCRIPCION = 15000;
export const MODELO_AUDIO = 'whisper-large-v3-turbo';
export const URL_TRANSCRIPCION = 'https://api.groq.com/openai/v1/audio/transcriptions';
// El token de WhatsApp solo se manda a direcciones de Meta (el archivo vive en lookaside.fbsbx.com).
const HOSTS_META = /(^|\.)(fbsbx\.com|facebook\.com|fbcdn\.net|whatsapp\.net)$/;

export const AUDIO = {
  pro: 'Los audios son de LIA Pro. Escríbeme lo mismo y lo entiendo.',
  largo: 'Ese audio es muy largo: mándame uno de menos de 2 minutos o escríbelo.',
  error: 'No pude escuchar ese audio. ¿Me lo escribes?',
  // Sin el consentimiento de la tarjeta de WhatsApp (settings.waLia), el audio no va a Groq.
  sinContexto: 'Para escuchar tus audios, actívalo en LIA: ve a Perfil y, en WhatsApp, toca «Activar Lía en WhatsApp». Mientras, escríbeme.',
  // Los mismos topes que usar_ia(): cada audio cuenta como un mensaje con IA.
  cupo_dia: 'Ya usaste tus 25 mensajes con IA de hoy, y cada audio cuenta como uno. Hasta mañana, escríbeme y te respondo con lo básico.',
  cupo_mes: 'Ya usaste tus 300 mensajes con IA de este mes, y cada audio cuenta como uno. Hasta el próximo mes, escríbeme y te respondo con lo básico.',
};

// Cuánto dura un Ogg (Opus o Vorbis), sin decodificarlo: la posición (granule) de la última página completa, menos el
// pre-skip de Opus, entre las muestras por segundo. Las notas de voz de WhatsApp son Ogg/Opus. null si no es Ogg.
const letras = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));
export function duracionOgg(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const pagina = i => b[i] === 0x4f && b[i + 1] === 0x67 && b[i + 2] === 0x67 && b[i + 3] === 0x53 && b[i + 4] === 0;   // «OggS», versión 0
  if (b.length < 28 || !pagina(0)) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), p = 27 + b[26];   // el primer paquete
  let tasa = 0, salto = 0;
  if (p + 19 <= b.length && letras(b, p, 8) === 'OpusHead') { tasa = 48000; salto = dv.getUint16(p + 10, true); }
  else if (p + 16 <= b.length && b[p] === 1 && letras(b, p + 1, 6) === 'vorbis') tasa = dv.getUint32(p + 12, true);
  if (!tasa) return null;
  for (let i = b.length - 27; i > 0; i--) {
    if (!pagina(i)) continue;
    const n = b[i + 26];
    if (i + 27 + n > b.length) continue;
    let largo = 27 + n;
    for (let k = 0; k < n; k++) largo += b[i + 27 + k];
    if (i + largo > b.length) continue;   // no es una página completa (o «OggS» dentro del audio)
    const g = dv.getBigUint64(i + 6, true);
    if (g === 0xffffffffffffffffn) continue;   // en esa página no termina ningún paquete
    return Math.max(0, Number(g) - salto) / tasa;
  }
  return null;
}

// Groq reconoce el formato por la extensión del nombre del archivo.
function extension(mime) {
  const m = String(mime || '').toLowerCase();
  if (/ogg|opus/.test(m)) return 'ogg';
  if (/mpeg|mp3/.test(m)) return 'mp3';
  if (/mp4|m4a/.test(m)) return 'm4a';
  if (/wav/.test(m)) return 'wav';
  if (/webm/.test(m)) return 'webm';
  if (/flac/.test(m)) return 'flac';
  if (/aac/.test(m)) return 'aac';
  if (/amr/.test(m)) return 'amr';
  return 'ogg';
}

// Pide a Meta los datos del audio (url, peso) y luego el archivo, con el token de WhatsApp. Devuelve { bytes, mime } o
// { error: 'largo' | 'meta' | 'descarga' | 'tiempo' | 'red' | 'sin_configurar' }.
export async function bajarAudio(deps, mediaId, { api = 'https://graph.facebook.com', version = 'v23.0' } = {}) {
  const token = deps.env('WHATSAPP_TOKEN');
  if (!token) return { error: 'sin_configurar' };
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(String(mediaId || ''))) return { error: 'meta' };
  const control = new AbortController(), reloj = setTimeout(() => control.abort(), deps.tiempoDescarga || TIEMPO_DESCARGA);
  const pedir = url => deps.fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: control.signal });
  try {
    const r = await pedir(`${api}/${version}/${encodeURIComponent(mediaId)}`);
    if (!r.ok) return { error: 'meta', http: r.status };
    const datos = await r.json().catch(() => null);
    let url = null;
    try { url = datos && typeof datos.url === 'string' ? new URL(datos.url) : null; } catch { url = null; }
    if (!url || url.protocol !== 'https:' || !HOSTS_META.test(url.hostname)) return { error: 'meta' };
    if (Number(datos.file_size) > AUDIO_MAX_BYTES) return { error: 'largo' };
    const a = await pedir(url.toString());
    if (!a.ok) return { error: 'descarga', http: a.status };
    if (Number(a.headers.get('content-length')) > AUDIO_MAX_BYTES) return { error: 'largo' };
    const bytes = new Uint8Array(await a.arrayBuffer());
    if (bytes.length > AUDIO_MAX_BYTES) return { error: 'largo' };
    if (!bytes.length) return { error: 'descarga' };
    return { bytes, mime: String(datos.mime_type || a.headers.get('content-type') || 'audio/ogg') };
  } catch {
    return { error: control.signal.aborted ? 'tiempo' : 'red' };
  } finally {
    clearTimeout(reloj);
  }
}

// Whisper en Groq: multipart con el archivo, el modelo, el idioma y response_format=json. Devuelve { texto } o
// { error: 'sin_clave' | 'largo' | 'limite' | 'groq' | 'tiempo' | 'red' | 'vacio' }.
export async function transcribir(deps, bytes, mime) {
  const clave = deps.env('GROQ_API_KEY');
  if (!clave) return { error: 'sin_clave' };
  const tipo = String(mime || 'audio/ogg').split(';')[0].trim() || 'audio/ogg';
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: tipo }), `audio.${extension(tipo)}`);
  form.append('model', MODELO_AUDIO);
  form.append('language', 'es');
  form.append('response_format', 'json');
  const control = new AbortController(), reloj = setTimeout(() => control.abort(), deps.tiempoAudio || TIEMPO_TRANSCRIPCION);
  try {
    const res = await deps.fetch(URL_TRANSCRIPCION, { method: 'POST', headers: { Authorization: `Bearer ${clave}` }, body: form, signal: control.signal });
    if (!res.ok) return { error: res.status === 413 ? 'largo' : res.status === 429 ? 'limite' : 'groq', http: res.status };
    const j = await res.json().catch(() => null);
    const texto = j && typeof j.text === 'string' ? j.text.replace(/\s+/g, ' ').trim() : '';
    return texto ? { texto } : { error: 'vacio' };
  } catch {
    return { error: control.signal.aborted ? 'tiempo' : 'red' };
  } finally {
    clearTimeout(reloj);
  }
}

// Todo el camino: bajar, medir y transcribir. { texto } o { error }. 'largo' si pesa más de 5 MB o dura más de 2 minutos.
export async function escucharAudio(deps, audio, opciones) {
  const b = await bajarAudio(deps, audio && audio.id, opciones);
  if (b.error) return b;
  const seg = duracionOgg(b.bytes);
  if (seg !== null && seg > AUDIO_MAX_SEGUNDOS) return { error: 'largo' };
  return transcribir(deps, b.bytes, b.mime || (audio && audio.mime_type));
}
