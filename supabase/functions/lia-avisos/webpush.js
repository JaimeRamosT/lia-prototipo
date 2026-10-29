// LIA · Web Push sin dependencias: firma VAPID (RFC 8292) y cifrado aes128gcm (RFC 8291) con WebCrypto.
// Funciona igual en Supabase (Deno) y en las pruebas (Node 18+), que lo comprueban con un descifrado independiente.

const te = new TextEncoder();
const cripto = () => globalThis.crypto.subtle;

export function aB64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function deB64url(texto) {
  const t = String(texto).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
const unir = (...partes) => {
  const out = new Uint8Array(partes.reduce((a, p) => a + p.length, 0));
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
};

async function hkdf(sal, ikm, info, largo) {
  const clave = await cripto().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await cripto().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sal, info }, clave, largo * 8));
}

// Cifra el mensaje para una suscripción (claves p256dh y auth en base64url). Devuelve el cuerpo listo para enviar.
// sal y clavesServidor solo se pasan en las pruebas.
export async function cifrar(mensaje, p256dh, auth, { sal, clavesServidor } = {}) {
  const uaPublica = deB64url(p256dh), secretoAuth = deB64url(auth);
  if (uaPublica.length !== 65 || uaPublica[0] !== 4) throw new Error('p256dh inválida');
  if (secretoAuth.length < 16) throw new Error('auth inválida');
  const as = clavesServidor || await cripto().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublica = new Uint8Array(await cripto().exportKey('raw', as.publicKey));
  const ua = await cripto().importKey('raw', uaPublica, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const compartido = new Uint8Array(await cripto().deriveBits({ name: 'ECDH', public: ua }, as.privateKey, 256));
  const ikm = await hkdf(secretoAuth, compartido, unir(te.encode('WebPush: info\0'), uaPublica, asPublica), 32);
  const s = sal || globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(s, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(s, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const claveAes = await cripto().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const texto = unir(typeof mensaje === 'string' ? te.encode(mensaje) : mensaje, new Uint8Array([2]));  // 2: último registro
  const cifrado = new Uint8Array(await cripto().encrypt({ name: 'AES-GCM', iv: nonce }, claveAes, texto));
  const rs = new Uint8Array([0, 0, 16, 0]);  // tamaño de registro 4096
  return unir(s, rs, new Uint8Array([asPublica.length]), asPublica, cifrado);
}

// Cabecera Authorization con VAPID: un JWT ES256 para el origen del servicio de push, válido 12 horas.
export async function cabeceraVapid(endpoint, { publica, privada, contacto }, ahora = Date.now()) {
  const pub = deB64url(publica);
  if (pub.length !== 65) throw new Error('VAPID_PUBLICA inválida');
  const jwk = { kty: 'EC', crv: 'P-256', x: aB64url(pub.slice(1, 33)), y: aB64url(pub.slice(33, 65)), d: privada, ext: true };
  const clave = await cripto().importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const cab = aB64url(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const cuerpo = aB64url(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(ahora / 1000) + 12 * 3600, sub: contacto })));
  const firma = await cripto().sign({ name: 'ECDSA', hash: 'SHA-256' }, clave, te.encode(`${cab}.${cuerpo}`));
  return `vapid t=${cab}.${cuerpo}.${aB64url(firma)}, k=${publica}`;
}

// Envía un aviso a una suscripción. Devuelve {estado, ok, borrar}: con 404 o 410 la suscripción ya no existe.
export async function enviarPush(fetchFn, sub, mensaje, vapid, { ttl = 3600, urgencia = 'high' } = {}) {
  const cuerpo = await cifrar(JSON.stringify(mensaje), sub.p256dh, sub.auth);
  let res;
  try {
    res = await fetchFn(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await cabeceraVapid(sub.endpoint, vapid),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgencia,
      },
      body: cuerpo,
    });
  } catch {
    return { estado: 0, ok: false, borrar: false };
  }
  return { estado: res.status, ok: res.status >= 200 && res.status < 300, borrar: res.status === 404 || res.status === 410 };
}
