# LIA · prototipo

LIA arma un horario de estudio en las horas libres de universitarios que estudian y trabajan. Este repositorio contiene el prototipo funcional del Grupo 8. Es una sola página que corre en el navegador. Se puede instalar como app y abre sin internet.

> **Prototipo de prueba.** Sin cuenta se usa LIA Gratis. LIA Pro necesita una cuenta en Supabase; el pago es de prueba y no cobra nada. Los horarios de cada persona se guardan solo en su dispositivo.

## Dónde se publica

LIA se publica en Cloudflare, en el plan gratuito, como un Worker que solo sirve archivos: no tiene código de servidor. El Worker `lia-prototipo` está conectado a este repositorio con Workers Builds.

- **Producción.** Cada cambio que llega a `main` se publica solo en `https://lia-prototipo.<subdominio>.workers.dev/`. Quien ya tenga la app instalada recibe la versión nueva la próxima vez que la abre con internet.
- **Vistas previas.** Cada push a otra rama arma una vista previa con su propia dirección (`https://<rama>-lia-prototipo.<subdominio>.workers.dev/`), y Cloudflare la deja como comentario en el pull request. Pruébala en el celular antes de integrar. Las vistas previas usan la misma base de datos de Supabase que producción: crea solo cuentas de prueba.

Tres archivos controlan la publicación:

| Archivo | Qué hace |
|---|---|
| `wrangler.jsonc` | Nombre del Worker y carpeta que se publica (la raíz del repositorio). El nombre debe ser igual al del Worker en Cloudflare; si no coincide, el build falla. |
| `.assetsignore` | Lo que no se publica: documentación, pruebas, Supabase y configuración. |
| `_headers` | Cabeceras de seguridad. Su política de contenido (CSP) solo deja que la app se conecte con Supabase. |

Si agregas un archivo nuevo que la app necesite sin internet, súmalo a la lista `SHELL` de `sw.js` y sube el número de `VERSION` en ese mismo archivo. Si la app empieza a usar otro servicio, por ejemplo el pago con Culqi, agrégalo a la CSP de `_headers`: si no, el navegador lo bloquea.

**Volver a la versión anterior.** En Cloudflare → Workers & Pages → `lia-prototipo` → *Deployments*, abre el menú de la versión buena (los tres puntos) y elige *Rollback*. Después revierte el commit en `main`, para que el siguiente despliegue no traiga el problema de vuelta.

**Configurarlo desde cero.** En Cloudflare → Workers & Pages → *Create* → *Import a repository*, elige `JaimeRamosT/lia-prototipo` y ponle el nombre `lia-prototipo`. En *Settings → Builds*, deja `main` como rama de producción, sin comando de build, con el comando de deploy `npx wrangler deploy` y con las vistas previas activadas. Luego agrega las direcciones nuevas en Supabase (ver [Piloto con estudiantes](docs/cuentas-y-planes.md#piloto-con-estudiantes)).

## Probarlo en tu computadora

Con Python 3 instalado, abre una terminal en esta carpeta y ejecuta:

```
python3 -m http.server 8000
```

Luego abre <http://localhost:8000> en el navegador. Si abres `index.html` con doble clic, la app también funciona, pero no se puede instalar ni usar sin internet.

Para probarla tal como la sirve Cloudflare, con las cabeceras de `_headers` y sin los archivos de `.assetsignore`, usa Node.js 22 o más nuevo:

```
npx wrangler dev
```

y abre <http://localhost:8787>. Si la consola del navegador muestra «Content Security Policy», la CSP de `_headers` está bloqueando algo.

Para ver las herramientas del equipo, como *simular el fin del periodo* de Pro, abre la app con `?pruebas=1`. `?pruebas=0` las vuelve a ocultar en ese navegador.

### Pruebas automáticas

Con Node.js 18 o más nuevo, ejecuta en esta carpeta:

```
node --test
```

Prueban el motor de horarios, el plan semanal de Gratis, la lectura de frases y Lía con IA (la función `lia-ia` y la revisión de sus respuestas, con Gemini simulado) sin abrir el navegador. Córrelas antes de integrar un cambio a `main`.

## Cuentas con Supabase

Las cuentas y el plan de cada una viven en Supabase. `config.js` ya apunta al proyecto del equipo. Para crear una cuenta Pro de prueba o conectar otro proyecto, sigue la [puesta en marcha](docs/cuentas-y-planes.md#puesta-en-marcha). Si `config.js` se deja vacío, la app funciona solo en Gratis. Antes de invitar estudiantes, sigue la [guía del piloto](docs/cuentas-y-planes.md#piloto-con-estudiantes).

## Lía con IA (en pruebas)

Con una cuenta Pro, Lía puede entender los mensajes del chat con Gemini, la IA de Google. Mientras se evalúa, solo aparece si abres la app con `?ia=1`; se recuerda en ese navegador y `?ia=0` la vuelve a ocultar. El diseño completo está en [docs/ia-con-gemini.md](docs/ia-con-gemini.md).

- **Cómo funciona.** La app envía el mensaje a la Edge Function `lia-ia` de Supabase con la sesión de la cuenta. La función revisa el cupo, le pregunta a Gemini y devuelve una propuesta, que la app vuelve a revisar. Después, Lía la trata igual que una frase que entienden las reglas: Confirmar, Corregir, Deshacer y la autonomía de Perfil funcionan como siempre.
- **Permiso.** Antes del primer uso, Lía explica qué envía (el mensaje y un resumen del horario, nunca el nombre ni el correo) y pide permiso. Se puede apagar en Perfil.
- **Cupo.** 25 mensajes al día y 300 al mes por cuenta. Solo cuentan los que Gemini respondió.
- **Sin IA.** Sin internet, sin cupo o si Gemini falla, Lía responde con las reglas y lo dice en una línea.
- **Nivel gratuito.** Por ahora se usa el nivel gratuito de Gemini, así que Google puede usar los mensajes para mejorar sus productos. El aviso lo dice.
- **La clave.** `GEMINI_API_KEY` vive solo como secreto de las Edge Functions en Supabase. Nunca va en `config.js`, en el repositorio ni en un chat.

**Evaluar con el modelo real.** Antes de quitar la bandera, y cada vez que cambien las instrucciones, el esquema o el modelo (`supabase/functions/lia-ia/`), pasa las frases de `pruebas/ia/frases.json` por Gemini. Usa tu clave de Google AI Studio (la misma que guardaste en Supabase). En PowerShell:

```
$env:GEMINI_API_KEY="tu-clave"; node pruebas/ia/evaluar.mjs
```

En macOS o Linux: `GEMINI_API_KEY=tu-clave node pruebas/ia/evaluar.mjs`. Tarda unos 8 minutos, porque el nivel gratuito limita los pedidos por minuto. Necesitas Node.js 18 o más nuevo en tu computadora. Compara a Lía con IA con las reglas de hoy y aprueba si acierta en el 90 % de las frases. `node pruebas/ia/evaluar.mjs --solo-reglas` mide solo las reglas, sin clave.

## Qué hay aquí

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La app completa: estilos, pantallas y lógica. |
| `manifest.webmanifest` | Nombre, colores e íconos para instalarla como app. |
| `sw.js` | Guarda una copia de la app para abrirla sin internet. |
| `icons/` | Íconos de la app y del navegador. |
| `fonts/` | Fuente Inter y su licencia. |
| `config.js` | URL y clave publicable de Supabase. Ambas son públicas; nunca pongas aquí la clave secreta. |
| `vendor/` | Cliente de Supabase (2.118.0, licencia MIT). Solo se descarga cuando alguien usa su cuenta. |
| `supabase/` | Configuración de la CLI de Supabase, migraciones de la base de datos y la Edge Function `lia-ia` (Lía con IA). |
| `docs/` | Especificaciones: cuentas y planes, y Lía con IA. |
| `pruebas/` | Pruebas del motor de horarios, del plan de Gratis, de la lectura de frases y de Lía con IA (`node --test`). En `pruebas/ia/`, la evaluación con el modelo real. |
| `wrangler.jsonc`, `.assetsignore`, `_headers` | Publicación en Cloudflare (ver [Dónde se publica](#dónde-se-publica)). |
| `.gitignore` | Deja fuera de Git lo que crea `npx wrangler dev` en tu computadora. |
| `.gitattributes` | Guarda los archivos de `vendor/` sin cambiar sus fines de línea. |

## Qué funciona y qué no

Funciona:

- **Primer uso.** Datos de ejemplo, o tu propio horario con un registro de 2 pasos.
- **Planes.** Sin cuenta, Gratis: hasta 3 evaluaciones próximas y una semana que se arma una vez. Con una cuenta Pro: sin límites, voz, modo sesión y reorganización automática.
- **Horario automático.** Bloques de estudio en tus horas libres, que se reorganizan cuando algo cambia.
- **Pantallas.** Hoy, Semana, Evaluaciones, chat con Lía (entiende frases simples; con IA, solo en pruebas) y modo sesión con temporizador.
- **Dictado por voz.** Solo en navegadores con reconocimiento de voz, como Chrome. En los demás, la app pide usar el micrófono del teclado.
- **App instalable.** Se agrega a la pantalla de inicio y abre sin internet.

Límites de esta versión:

- **Datos solo en el dispositivo.** Viven en el navegador de cada dispositivo, no se sincronizan entre dispositivos y se pierden si se borran los datos del sitio.
- **iPhone sin instalar.** Si LIA no está instalada, Safari borra los datos de un sitio que no se abre en 7 días de uso. Instalada en la pantalla de inicio, eso no pasa.
- **La cuenta solo lleva el plan.** Los horarios todavía no viajan entre dispositivos.
- **Sin cobro real ni recordatorios.** El pago es una simulación y aún no hay avisos con la app cerrada.

## Créditos

- Fuente [Inter](https://github.com/rsms/inter), de The Inter Project Authors, bajo la SIL Open Font License 1.1 (`fonts/OFL.txt`).
- [supabase-js](https://github.com/supabase/supabase-js), de Supabase, bajo licencia MIT (`vendor/supabase-js-LICENSE.txt`).
