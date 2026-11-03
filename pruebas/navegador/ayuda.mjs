// Ayudas para las pruebas de navegador: un servidor de archivos de la raíz del repositorio (como Cloudflare)
// y un navegador que simula un celular. Sin internet: las llamadas a Supabase se cortan.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

// Sirve la raíz del repositorio en un puerto libre. «/» es index.html, igual que en Cloudflare.
export async function servir() {
  const srv = createServer(async (req, res) => {
    const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    if (ruta.startsWith('..')) { res.writeHead(403).end(); return; }
    try {
      const cuerpo = await readFile(join(RAIZ, ruta || 'index.html'));
      res.writeHead(200, { 'Content-Type': TIPOS[extname(ruta || 'index.html')] || 'application/octet-stream' }).end(cuerpo);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/`, cerrar: () => new Promise(r => srv.close(r)) };
}

// Celulares simulados (en Chromium): un iPhone y un Android.
export const CELULARES = {
  iPhone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  Android: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' },
};

// LIA también se usa como página web en una computadora (decisión del 2-nov).
export const DISPOSITIVOS = { ...CELULARES, Computadora: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 } };

// Abre la app en un celular o en una computadora. Devuelve la página y la lista de errores de JavaScript que vaya juntando.
export async function abrir(navegador, url, celular, { oscuro = false } = {}) {
  const ctx = await navegador.newContext({ ...DISPOSITIVOS[celular], locale: 'es-PE', timezoneId: 'America/Lima', colorScheme: oscuro ? 'dark' : 'light', serviceWorkers: 'block' });
  await ctx.route('**/*.supabase.co/**', r => r.abort());
  const pg = await ctx.newPage();
  const errores = [];
  pg.on('pageerror', e => errores.push(String(e)));
  pg.on('console', m => { if (m.type() === 'error' && !/supabase|Failed to load resource|ERR_FAILED/i.test(m.text())) errores.push(m.text()); });
  await pg.goto(url);
  return { ctx, pg, errores };
}

export const lanzar = () => chromium.launch();

// El registro de siempre: rutinas, una evaluación y «Armar mi horario».
export async function registrar(pg, { rutinas = ['trabajo de lunes a viernes de 3 a 7', 'clases lunes miércoles y viernes de 8 a 1'], evals = ['examen de cálculo el lunes a las 10'] } = {}) {
  await pg.getByRole('button', { name: 'Empezar con mis horarios' }).click();
  for (const f of rutinas) { await pg.fill('input[name=q]', f); await pg.keyboard.press('Enter'); await pg.waitForTimeout(250); }
  await pg.getByRole('button', { name: 'Siguiente', exact: true }).click();
  for (const f of evals) { await pg.fill('input[name=q]', f); await pg.keyboard.press('Enter'); await pg.waitForTimeout(250); }
  await pg.getByRole('button', { name: 'Armar mi horario' }).click();
  await pg.getByRole('button', { name: 'Ver mi semana' }).click();
}

export async function pestana(pg, nombre) { await pg.locator('#tabs').getByRole('button', { name: nombre, exact: true }).click(); await pg.waitForTimeout(200); }

// Escribe en el chat de Lía y devuelve el último mensaje.
export async function decir(pg, frase) {
  await pg.fill('#chat-in', frase); await pg.keyboard.press('Enter'); await pg.waitForTimeout(500);
  return pg.evaluate(() => [...document.querySelectorAll('.msg')].at(-1).innerText.replace(/\n/g, ' | '));
}

export const anchoDeMas = pg => pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
