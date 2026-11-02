// La app instalada abre sin internet solo si cada archivo de SHELL (sw.js) existe y Cloudflare lo publica.
// También revisa que la versión de sw.js y la de la app coincidan, para que el teléfono se actualice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const sw = readFileSync(RAIZ + 'sw.js', 'utf8');
const html = readFileSync(RAIZ + 'index.html', 'utf8');
const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const ignorados = readFileSync(RAIZ + '.assetsignore', 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

test('cada archivo de SHELL existe y se publica', () => {
  assert.ok(shell.includes('./'), 'la app se guarda por ./');
  assert.ok(!shell.includes('./index.html'), 'nunca por ./index.html: en Cloudflare redirige a la raíz');
  for (const u of shell.filter(u => u !== './')) {
    const ruta = u.replace(/^\.\//, '');
    assert.ok(existsSync(RAIZ + ruta), `${u} no existe`);
    const fuera = ignorados.find(p => p.startsWith('/') ? ('/' + ruta).startsWith(p.replace(/\/$/, '/')) || '/' + ruta === p : ruta.split('/').includes(p.replace(/\/$/, '')));
    assert.equal(fuera, undefined, `${u} está en .assetsignore: Cloudflare no lo publicaría`);
  }
});

test('la versión de sw.js es la de la app', () => {
  const vSw = sw.match(/const VERSION = '([^']+)'/)[1];
  const vApp = html.match(/const APP_VERSION='([^']+)'/)[1];
  assert.equal(vSw, vApp);
});
