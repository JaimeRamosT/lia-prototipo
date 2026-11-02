# Pruebas de LIA en el navegador

Recorren la app como lo haría una persona, en un iPhone y un Android simulados (Playwright con Chromium): la bienvenida, el registro, las cinco pestañas y el chat de Lía. Fallan si algo se sale de la pantalla o si hay errores de JavaScript. No usan internet: las llamadas a Supabase se cortan.

## Correrlas en tu computadora

```
cd pruebas/navegador
npm ci
npx playwright install chromium
npm test
```

## En GitHub

Corren solas en cada pull request y en cada cambio de `main` (`.github/workflows/pruebas.yml`), junto con `node --test` y la evaluación de las frases solo con reglas.

La evaluación con el modelo real (`.github/workflows/eval-ia.yml`) se corre a mano desde la pestaña Actions, o en un PR con la etiqueta `ia`. Necesita el secreto `GEMINI_API_KEY` en Settings → Secrets and variables → Actions.

## Agregar una prueba

Cada archivo `*.nav.mjs` de esta carpeta es una prueba. Las ayudas (`servir`, `abrir`, `registrar`, `decir`) están en `ayuda.mjs`. Usa nombres de botones y textos que ve la persona, no clases de CSS, para que la prueba no se rompa al cambiar el diseño.
