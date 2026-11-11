# LIA · instrucciones para Claude

LIA es un prototipo de página web (HTML, CSS y JavaScript en un solo `index.html`; también se puede instalar) que arma horarios de estudio en las horas libres de universitarios que trabajan. Desde el 2-nov-2026 se piensa para la computadora y el celular por igual: desde 900 px, barra lateral y hojas como diálogos. Es del Grupo 8, en Perú. Se publica en Cloudflare (Worker `lia-prototipo`, solo archivos estáticos) desde `main`, con una vista previa por rama. Los datos viven en `localStorage` (`lia.app.v1`). Versión freemium única: sin cuenta, LIA Gratis; LIA Pro requiere una cuenta de Supabase. El checkout es de prueba y no cobra. Con Pro, Lía entiende primero con reglas y, si no entienden, con un modelo de IA a través de la Edge Function `lia-ia`: desde el 2-nov-2026, `openai/gpt-oss-120b` en Groq, con Gemini de respaldo (ver `docs/ia-con-gemini.md`). Responde y escribe en español.

## Skills: llámalos, no los omitas

Antes de empezar cada tarea, revisa esta tabla. Si una fila aplica, carga ese skill con la herramienta de skills antes de trabajar, no después.

| Situación | Skill |
|---|---|
| Vas a cambiar `plan()`, `planCongelado()`, `interpret()` o el formato de los datos guardados | `engineering:testing-strategy` antes; `engineering:code-review` al terminar |
| Terminas cualquier cambio en `index.html` o `sw.js` | `engineering:code-review` |
| Alguien reporta un error al probar la app (en el celular, en otro navegador o en la app instalada) | `engineering:debug`. Antes de cambiar el código, reprodúcelo en Playwright simulando un celular (iPhone y Android, también abierta como app instalada) o una computadora (`DISPOSITIVOS` en `pruebas/navegador/ayuda.mjs`) |
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
- El consolidado de matrícula se lee en el teléfono con pdf.js (`vendor/pdfjs`, ver `docs/consolidado.md`). Nunca subas un consolidado real al repositorio: trae nombre y código del alumno.

## Fábrica de software (desde el 2 de noviembre de 2026)

- Cada pedido sigue la línea de `docs/fabrica.md`: especificación → pruebas primero → código → CI → evaluación de la IA → revisión → experiencia → publicación → registro en Notion.
- Los agentes están en `.claude/agents/` (`producto`, `pruebas`, `desarrollo`, `revisor`, `ux`, `evaluador-ia`, `publicador`). Quien programa no revisa su propio trabajo.
- Cada PR usa la plantilla de `.github/pull_request_template.md`.
- Al terminar una tarea, registra en Notion qué cambió y qué quedó pendiente (página de LIA en Memories).

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
- Lista de espera: desde el 2-nov-2026 no hay landing (`landing.html` se quitó: el sitio abre directo en la app). La tabla `lista_espera` y `unirse_lista_espera()` quedan en la base sin uso; su aviso del asesor (anon) es esperado. Nadie lee `lista_espera` desde la app.
- Los precios (desde el 10-nov-2026, S/ 15 al mes y S/ 54.90 por ciclo) están en dos lugares: `precio()` en la última migración que la define y `PRICES` en `index.html`. `pruebas/precios.test.mjs` revisa que coincidan.
- Preventa con Yape o Plin (`docs/preventa.md`, desde el 4-nov-2026; el número del equipo recibe por Plin): el equipo activa Pro real con `registrar_preventa(correo, periodo, monto, operación, medio)` (medio `yape` o `plin`) y lo quita con `quitar_pro(correo)`, solo desde el SQL Editor (sin permisos para `anon`, `authenticated` ni `service_role`). La operación no se registra dos veces (`pagos.referencia`). Con correos en `cuentas_prueba`, `simular_pago` solo funciona para esas cuentas (con el correo confirmado) y un Pro de prueba ya no se renueva solo en las demás (`prueba_permitida()`, usada por `mi_suscripcion` y `simular_pago`); su aviso 0008 es esperado. Los números de `PREVENTA` en `index.html` son públicos: los puso Coconut (`titular`, opcional, sigue vacío).
- La clave de Gemini vive solo como secreto de las Edge Functions (`GEMINI_API_KEY`). Nunca va en `config.js`, en el repositorio ni en el chat. Lo mismo con las de otros proveedores (`GROQ_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`); el proveedor se elige con el secreto `IA_PROVEEDOR` y el respaldo con `IA_RESPALDO` (ver `docs/ia-con-gemini.md`). Si cambia el proveedor, cambia también el aviso de privacidad de la IA en `index.html`.
- El cupo de la IA (25 mensajes por día y 300 por mes, solo Pro) solo cambia mediante `usar_ia()`; nadie escribe en `uso_ia` desde la app.
- La función `lia-ia` nunca escribe en sus registros el texto de los mensajes.
- Métricas (`docs/metricas.md`): la app solo agrega eventos anónimos con `registrar_evento()`, que llama `anon` a propósito (su aviso del asesor es esperado). Nunca guardan horarios, cursos, mensajes, nombre ni correo. `metricas_resumen()` (el tablero, `tablero.html`) también la llama `anon` a propósito: solo devuelve totales, nunca filas por persona.
- Recordatorios (`docs/notificaciones.md`): el servidor solo guarda hora, tipo y una referencia de cada aviso, nunca nombres de cursos. La Edge Function `lia-avisos` tiene `verify_jwt` apagado porque la llaman `pg_cron` (con el secreto `lia_avisos_secreto` de Vault) y la app (revisa la sesión). Las claves VAPID las crea la función y viven en Vault: no las copies ni las reemplaces, o todos los teléfonos tendrán que volver a activar los avisos.
- Canales (`docs/canales.md` y `docs/calendario.md`): solo al activar Google Calendar o WhatsApp, la app publica en `agenda_canales` lo de los próximos 14 días con su nombre (estudio y evaluaciones; eventos de un día y rutinas solo si lo eligió, `settings.calTodo`; lo acepta en la tarjeta de Perfil), nunca lo que vino de Google Calendar (`gcal`); al desactivar los dos, se borra. La «dirección secreta en formato iCal» de la persona vive solo en su navegador (`state.gcal.url`, se borra al cerrar sesión); `lia-calendario` la lee y no la guarda ni la registra. `lia-calendario` y `lia-whatsapp` tienen `verify_jwt` apagado: el primero lo pide Google con un token secreto (y su `POST importar` revisa la sesión); el segundo lo llaman Meta (firma `X-Hub-Signature-256` con `WHATSAPP_APP_SECRET`) y `pg_cron` (secreto de Vault de `lia-avisos`). Sus registros nunca llevan textos, títulos, tokens ni números. Los avisos 0029 de `canales_estado`, `activar_calendario`, `desactivar_calendario`, `pedir_codigo_whatsapp`, `quitar_whatsapp`, `avisos_whatsapp`, `publicar_agenda`, `confirmar_codigo_whatsapp`, `publicar_contexto_whatsapp`, `propuestas_whatsapp_confirmadas` y `quitar_propuestas_whatsapp` son esperados. El código que se envía por WhatsApp nunca se muestra en la app.
- Lía en WhatsApp (`docs/whatsapp-lia.md`, desde el 4-nov-2026): `lia-whatsapp` entiende con `reglas.js` (el bloque `LOGIC` de `index.html`) e `ia.js` (copia de `lia-ia/logica.js`). Son copias generadas: si cambias `index.html` dentro de `LOGIC` o `lia-ia/logica.js`, corre `node supabase/functions/lia-whatsapp/copiar.mjs` (una prueba falla si no) y vuelve a desplegar `lia-whatsapp`. Nada se guarda sin el «sí» de la persona y la base nunca guarda el texto de los mensajes: solo lo entendido (`propuestas_whatsapp`) hasta que la app lo guarda, y el contexto (`contexto_whatsapp`, sin nombre, correo ni lo que vino de Google) mientras WhatsApp está vinculado. La app publica el contexto solo si la persona aceptó el aviso de la tarjeta de WhatsApp (`settings.waLia`: al vincular o con «Activar Lía en WhatsApp»); si cambias lo que se guarda, cambia ese aviso. La IA por WhatsApp es solo de Pro y usa el mismo cupo, mediante `usar_ia_whatsapp()` (que llama a `usar_ia()`). Los audios también son solo de Pro (con Lía activada y el mismo cupo, 1 por audio): los transcribe Groq con Whisper (`lia-whatsapp/audio.js`, `GROQ_API_KEY`) y ni el audio ni la transcripción se guardan ni se registran (el registro lleva solo el tipo, como `audio:ok`). Los avisos 0008 (RLS sin políticas) de `contexto_whatsapp`, `propuestas_whatsapp` y `whatsapp_vistos` son esperados: no tienen permisos directos. Las pruebas de la migración están en `pruebas/sql` (PGlite, también en la CI). Las que usa `lia-whatsapp` con el número de la persona (`cuenta_whatsapp`, `whatsapp_estado`, `guardar_propuesta_whatsapp`, `confirmar_propuesta_whatsapp`, `descartar_propuesta_whatsapp`, `usar_ia_whatsapp` y `whatsapp_visto`) son solo de `service_role`.
- Conectar con Google (`docs/google.md`, desde el 3-nov-2026): `lia-google` tiene `verify_jwt` apagado porque la llaman Google (regreso del permiso y avisos de cambio, con el secreto de cada canal) y `pg_cron` (secreto de Vault de `lia-avisos`); la app manda su sesión y se revisa en la función. El permiso de Google (refresh token) vive solo en Vault (`google_cuentas.token_id`) y solo lo lee `service_role`; todas las funciones `google_*` son solo de `service_role`. La base nunca guarda eventos ni títulos de Google: `google_senal` es un contador que la app escucha con Realtime (cada cuenta ve solo el suyo). `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` viven solo como secretos de las Edge Functions. Los registros de `lia-google` nunca llevan tokens, códigos, correos, títulos ni ids de eventos. LIA solo escribe en su calendario «LIA» (`calendar.app.created`) y solo lee el principal (`calendar.events.readonly`).
- Especificación y diseño: `docs/cuentas-y-planes.md` (cuentas y planes), `docs/ia-con-gemini.md` (IA), `docs/notificaciones.md` (recordatorios), `docs/canales.md` (Google Calendar y WhatsApp), `docs/calendario.md` (enlace iCal en los dos sentidos), `docs/google.md` (Conectar con Google) y `docs/consolidado.md`.
