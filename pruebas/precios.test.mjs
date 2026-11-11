// Los precios de LIA Pro están en dos lugares a propósito (docs/cuentas-y-planes.md): PRICES en index.html, que es lo
// que ve la persona, y precio() en la base, que anota los pagos y valida la preventa. Esta prueba revisa que digan lo mismo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const raiz = new URL('../', import.meta.url);
const leer = r => fs.readFileSync(new URL(r, raiz), 'utf8');

function preciosApp() {
  const m = leer('index.html').match(/const PRICES=\{mes:\{amount:([\d.]+),months:(\d+)[^}]*\},ciclo:\{amount:([\d.]+),months:(\d+)/);
  assert.ok(m, 'no encontré PRICES en index.html');
  return { mes: Number(m[1]), mesesMes: Number(m[2]), ciclo: Number(m[3]), mesesCiclo: Number(m[4]) };
}

// Vale la última migración que define precio(): las que ya llegaron a main no se editan. Si esa migración la escribe
// con otra forma, la prueba falla en vez de comparar en silencio con una migración anterior.
function preciosBase() {
  const dir = new URL('supabase/migrations/', raiz);
  const define = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    .map(f => ({ archivo: f, sql: fs.readFileSync(new URL(f, dir), 'utf8') }))
    .filter(x => /function\s+public\.precio\s*\(/i.test(x.sql));
  assert.ok(define.length, 'ninguna migración define precio()');
  const { archivo, sql } = define.at(-1);
  const m = sql.match(/function public\.precio\(p_periodo text\)[\s\S]*?when 'mes' then ([\d.]+) when 'ciclo' then ([\d.]+) end/);
  assert.ok(m, `${archivo} define precio() con una forma que esta prueba no lee: actualiza la prueba`);
  return { archivo, mes: Number(m[1]), ciclo: Number(m[2]) };
}

// El ahorro del ciclo como lo calcula index.html (SAVE_CICLO y SAVE_PCT), con los PRICES de la app.
function ahorroApp() {
  const html = leer('index.html');
  const linea = n => { const m = html.match(new RegExp(`const ${n}=([^;]+);`)); assert.ok(m, `no encontré ${n} en index.html`); return m[1]; };
  const PRICES = eval(`(${linea('PRICES')})`);
  const SAVE_CICLO = new Function('PRICES', `return ${linea('SAVE_CICLO')}`)(PRICES);
  const SAVE_PCT = new Function('PRICES', 'SAVE_CICLO', `return ${linea('SAVE_PCT')}`)(PRICES, SAVE_CICLO);
  return { PRICES, SAVE_CICLO, SAVE_PCT };
}

test('PRICES de la app y precio() de la base dicen lo mismo', () => {
  const app = preciosApp(), base = preciosBase();
  assert.equal(app.mes, base.mes, `mensual: index.html dice ${app.mes} y ${base.archivo} dice ${base.mes}`);
  assert.equal(app.ciclo, base.ciclo, `por ciclo: index.html dice ${app.ciclo} y ${base.archivo} dice ${base.ciclo}`);
});

test('LIA Pro cuesta S/ 15 al mes y S/ 54.90 por ciclo de 4 meses (desde el 10-nov-2026)', () => {
  const app = preciosApp();
  assert.deepEqual([app.mes, app.mesesMes, app.ciclo, app.mesesCiclo], [15, 1, 54.9, 4]);
});

test('pagar por ciclo sigue saliendo más barato que 4 meses sueltos', () => {
  const app = preciosApp();
  assert.ok(app.ciclo < app.mes * app.mesesCiclo);
});

test('el porcentaje de ahorro del ciclo nunca se muestra mayor que el real', () => {
  const { PRICES, SAVE_CICLO, SAVE_PCT } = ahorroApp();
  const total = PRICES.mes.amount * PRICES.ciclo.months, real = (total - PRICES.ciclo.amount) / total * 100;
  assert.equal(Math.round(SAVE_CICLO * 100), 510, 'ahorras S/ 5.10');
  assert.ok(Number.isInteger(SAVE_PCT) && SAVE_PCT <= real, `muestra ${SAVE_PCT} % y el ahorro real es ${real.toFixed(2)} %`);
  assert.equal(SAVE_PCT, 8, 'S/ 54.90 frente a S/ 60: 8.5 %, se muestra 8 %');
});
