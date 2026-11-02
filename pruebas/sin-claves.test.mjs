// Ninguna clave secreta en el repositorio: ni la de Gemini, ni la de Groq, ni la secreta o la service_role de Supabase,
// ni claves privadas. La CI la corre en cada PR; también sirve antes de un commit (node --test pruebas/sin-claves.test.mjs).
// La clave publicable de config.js sí puede estar: es pública por diseño.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const ESTE = 'pruebas/sin-claves.test.mjs';

// Los archivos del repositorio (o, sin git, los de la carpeta, sin node_modules ni .git).
function archivos() {
  try {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: RAIZ, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    const out = [];
    const recorrer = d => { for (const n of readdirSync(d)) { if (n === '.git' || n === 'node_modules') continue; const r = join(d, n); statSync(r).isDirectory() ? recorrer(r) : out.push(relative(RAIZ, r).replace(/\\/g, '/')); } };
    recorrer(RAIZ);
    return out;
  }
}

const jwtDe = t => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')); } catch { return null; } };
const PATRONES = [
  ['clave de Google (Gemini)', /AIza[0-9A-Za-z_-]{35}/],
  ['clave de Groq', /gsk_[0-9A-Za-z]{20,}/],
  ['clave tipo OpenAI', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['clave secreta de Supabase', /sb_secret_[0-9A-Za-z_-]{10,}/],
  ['clave privada', /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/],
];

export function buscarClaves(texto) {
  const hallazgos = PATRONES.filter(([, re]) => re.test(texto)).map(([n]) => n);
  for (const t of texto.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || [])
    if (jwtDe(t)?.role === 'service_role') hallazgos.push('clave service_role de Supabase');
  return hallazgos;
}

test('el detector reconoce cada tipo de clave', () => {
  const falso = (a, n) => a + 'x'.repeat(n);
  assert.deepEqual(buscarClaves(falso('AIza', 35)), ['clave de Google (Gemini)']);
  assert.deepEqual(buscarClaves(falso('gsk_', 24)), ['clave de Groq']);
  assert.deepEqual(buscarClaves(falso('sb_secret_', 20)), ['clave secreta de Supabase']);
  const jwt = r => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ role: r, iss: 'supabase' })).toString('base64url'), 'firmafirmafirma'].join('.');
  assert.deepEqual(buscarClaves(jwt('service_role')), ['clave service_role de Supabase']);
  assert.deepEqual(buscarClaves(jwt('anon')), []);
  assert.deepEqual(buscarClaves("key: 'sb_publishable_algo'"), []);
});

test('no hay claves secretas en el repositorio', () => {
  const malos = [];
  for (const f of archivos()) {
    if (f === ESTE || /\.(png|jpe?g|webp|ico|woff2?|ttf|pdf)$/i.test(f)) continue;
    let texto;
    try { texto = readFileSync(join(RAIZ, f), 'utf8'); } catch { continue; }
    for (const h of buscarClaves(texto)) malos.push(`${f}: ${h}`);
  }
  assert.deepEqual(malos, [], 'Saca la clave del archivo y guárdala como secreto (Supabase o GitHub). Si ya se subió, cámbiala.');
});
