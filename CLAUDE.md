# LIA · instrucciones para Claude

LIA es un prototipo de app web instalable (HTML, CSS y JavaScript en un solo `index.html`) que arma horarios de estudio en las horas libres de universitarios que trabajan. Es del Grupo 8, en Perú. Se publica en Cloudflare (Worker `lia-prototipo`, solo archivos estáticos) desde `main`, con una vista previa por rama. Los datos viven en `localStorage` (`lia.app.v1`). Versión freemium única: sin cuenta, LIA Gratis; LIA Pro requiere una cuenta de Supabase. El checkout es de prueba y no cobra. Con Pro, Lía entiende los mensajes con Gemini a través de la Edge Function `lia-ia` (ver `docs/ia-con-gemini.md`). Responde y escribe en español.

## Skills: llámalos, no los omitas

Antes de empezar cada tarea, revisa esta tabla. Si una fila aplica, carga ese skill con la herramienta de skills antes de trabajar, no después.

| Situación | Skill |
|---|---|
| Vas a cambiar `plan()`, `planCongelado()`, `interpret()` o el formato de los datos guardados | `engineering:testing-strategy` antes; `engineering:code-review` al terminar |
| Terminas cualquier cambio en `index.html` o `sw.js` | `engineering:code-review` |
| Alguien reporta un error al probar la app (en el celular, en otro navegador o en la app instalada) | `engineering:debug`. Antes de cambiar el código, reprodúcelo en Playwright simulando un celular (iPhone y Android, también abierta como app instalada) |
| Tocas pantallas, componentes, colores o tamaños | `design:accessibility-review` y `design:design-critique` |
| Escribes o cambias texto que ve la persona (Lía, errores, estados vacíos) | `design:ux-copy`, en español peruano |
| Vas a hacer un commit | `anthropic-skills:conventional-commit` |
| Vas a integrar a `main` (se publica en Cloudflare) o cambias `wrangler.jsonc`, `.assetsignore` o `_headers` | `engineering:deploy-checklist` |
| Vas a construir una función nueva (cuenta, notificaciones, sílabos, Google Calendar) | `product-management:write-spec`, antes de programar |
| Decides cuentas, sincronización, hosting o dónde vive una clave | `engineering:architecture` o `engineering:system-design` |
| La app empieza a usar la API de Claude | `product-self-knowledge` |
| Cambias las instrucciones, el esquema o el modelo de la IA (`supabase/functions/lia-ia/`) | `engineering:testing-strategy`. Agrega frases a `pruebas/ia/frases.json` si hace falta y pide a Coconut que corra la evaluación con el modelo real (`pruebas/ia/evaluar.mjs`, con su clave; ver el README) |
| Pruebas con estudiantes, precio o validación | `design:user-research` y `anthropic-skills:investigacion-emprendimiento` |
| Mejora visual con una meta concreta, o unificar colores y tokens | `frontend-design` o `design:design-system` |

Los skills de artefactos, finanzas, datos, marketing, documentos y plugins quedan fuera, salvo que la tarea lo exija o la persona lo pida.

## Que no se omita en silencio

- Si un skill de la tabla no está disponible en la sesión, dilo y propón una alternativa. No lo reemplaces sin avisar.
- Si decides no usar un skill que la tabla pide, explica por qué en una línea.
- Al terminar cada tarea, cierra con una línea: `Skills usados: … · Omitidos: … (motivo)`.
- Si la persona escribe el nombre de un skill, úsalo siempre.

## Reglas del repositorio

- Commits convencionales. No hagas commit ni push sin que te lo pidan.
- Terminadores de línea LF.
- Si cambia el esquema de datos (`v:1`), escribe una migración: hoy cualquier otra versión descarta lo guardado.
- Cada corrección de `plan()`, `planCongelado()` o `interpret()` lleva su prueba en `pruebas/` (`node --test`).
- Si agregas un archivo que la app necesita sin internet, súmalo a `SHELL` en `sw.js` y sube `VERSION`.
- Cloudflare publica la raíz del repositorio. Si agregas un archivo que no es de la app (documentos, scripts, pruebas), súmalo a `.assetsignore`.
- En `sw.js`, la app se guarda y se pide por `./`, nunca por `./index.html`: en Cloudflare, `/index.html` redirige a la raíz y la copia redirigida no abre sin internet.
- La política de contenido (CSP) está en `_headers`. Si la app usa un servicio nuevo (por ejemplo, Culqi), agrégalo ahí y pruébalo con `npx wrangler dev`, mirando la consola del navegador.
- El `name` de `wrangler.jsonc` debe seguir siendo `lia-prototipo`, igual que el Worker en Cloudflare.
- El plan gratuito de Cloudflare no permite recibir datos de tarjeta en la página: el cobro real usa la página de pago de Culqi.

## Flujo de trabajo: trunk-based development (desde el 25 de octubre de 2026)

- `main` es el tronco y siempre debe poder publicarse, porque Cloudflare despliega todo lo que llega a `main`.
- Cada cambio va en una rama corta que sale de `main` (`feat/…`, `fix/…`, `chore/…`), dura uno o dos días y vuelve pronto a `main`.
- Commits pequeños. Integra a `main` seguido en vez de acumular cambios.
- Lo que aún no debe ver el público entra a `main` apagado detrás de una bandera, no en una rama larga.
- Una bandera guardada en el navegador no llega a la app instalada: abre sin parámetros y, en iPhone, tiene su propio almacenamiento. Si hay que probarla en el celular, la bandera va en la cuenta.
- Antes de integrar a `main`, corre las pruebas: `node --test` para la lógica y una revisión en la vista previa que Cloudflare comenta en el pull request.
- En esta carpeta, usa `git -c core.autocrlf=true`: la copia se clonó en Windows y sus archivos tienen fin de línea CRLF.

## Supabase

- Proyecto del equipo: `lvtthltugrpbqjezwnsd` (us-east-1). Su URL y su clave publicable están en `config.js`.
- La base de datos se define en `supabase/migrations/`. Cada cambio es una migración nueva que se pueda aplicar dos veces sin error; no edites migraciones que ya llegaron a `main`.
- La integración con GitHub aplica las migraciones a producción al integrar en `main`: antes, usa `engineering:deploy-checklist`.
- Si aplicas una migración con el MCP de Supabase (`apply_migration`), Supabase la registra con la hora en que se aplicó. Renombra el archivo local con esa versión (`list_migrations`) antes de integrar en `main`, para que la integración no falle ni la repita.
- Después de cada migración, corre los asesores de seguridad y de rendimiento. Los avisos 0029 de las funciones que llaman las cuentas son esperados: no les quites el permiso. Son `mi_suscripcion`, `simular_pago`, `cambiar_renovacion`, `simular_fin_periodo` y `usar_ia` (ver `docs/cuentas-y-planes.md`), y `clave_publica_avisos`, `guardar_dispositivo`, `quitar_dispositivo` y `programar_avisos` (ver `docs/notificaciones.md`).
- El plan solo cambia mediante funciones SQL; la app solo lee. Nunca des permisos de escritura sobre `suscripciones` o `pagos` a `anon` ni a `authenticated`.
- En `config.js` van solo la URL y la clave publicable. Nunca la clave secreta ni la `service_role`.
- Los precios están en dos lugares: `precio()` en la migración y `PRICES` en `index.html`.
- La clave de Gemini vive solo como secreto de las Edge Functions (`GEMINI_API_KEY`). Nunca va en `config.js`, en el repositorio ni en el chat.
- El cupo de la IA (25 mensajes por día y 300 por mes, solo Pro) solo cambia mediante `usar_ia()`; nadie escribe en `uso_ia` desde la app.
- La función `lia-ia` nunca escribe en sus registros el texto de los mensajes.
- Recordatorios (`docs/notificaciones.md`): el servidor solo guarda hora, tipo y una referencia de cada aviso, nunca nombres de cursos. La Edge Function `lia-avisos` tiene `verify_jwt` apagado porque la llaman `pg_cron` (con el secreto `lia_avisos_secreto` de Vault) y la app (revisa la sesión). Las claves VAPID las crea la función y viven en Vault: no las copies ni las reemplaces, o todos los teléfonos tendrán que volver a activar los avisos.
- Especificación y diseño: `docs/cuentas-y-planes.md` (cuentas y planes), `docs/ia-con-gemini.md` (IA) y `docs/notificaciones.md` (recordatorios).
