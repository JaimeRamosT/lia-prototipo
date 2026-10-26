# LIA · instrucciones para Claude

LIA es un prototipo de app web instalable (HTML, CSS y JavaScript en un solo `index.html`) que arma horarios de estudio en las horas libres de universitarios que trabajan. Es del Grupo 8, en Perú. Se publica con GitHub Pages desde `main`. Los datos viven en `localStorage` (`lia.app.v1`). Versión freemium única: sin cuenta, LIA Gratis; LIA Pro requiere una cuenta de Supabase. El checkout es de prueba y no cobra. Responde y escribe en español.

## Skills: llámalos, no los omitas

Antes de empezar cada tarea, revisa esta tabla. Si una fila aplica, carga ese skill con la herramienta de skills antes de trabajar, no después.

| Situación | Skill |
|---|---|
| Vas a cambiar `plan()`, `planCongelado()`, `interpret()` o el formato de los datos guardados | `engineering:testing-strategy` antes; `engineering:code-review` al terminar |
| Terminas cualquier cambio en `index.html` o `sw.js` | `engineering:code-review` |
| Tocas pantallas, componentes, colores o tamaños | `design:accessibility-review` y `design:design-critique` |
| Escribes o cambias texto que ve la persona (Lía, errores, estados vacíos) | `design:ux-copy`, en español peruano |
| Vas a hacer un commit | `anthropic-skills:conventional-commit` |
| Vas a publicar cambios en GitHub Pages | `engineering:deploy-checklist` |
| Vas a construir una función nueva (cuenta, notificaciones, sílabos, Google Calendar) | `product-management:write-spec`, antes de programar |
| Decides cuentas, sincronización, hosting o dónde vive una clave | `engineering:architecture` o `engineering:system-design` |
| La app empieza a usar la API de Claude | `product-self-knowledge` |
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
- GitHub Pages sirve para el prototipo. No se usa para cobrar: antes de eso hay que mudar el hosting.

## Flujo de trabajo: trunk-based development (desde el 25 de octubre de 2026)

- `main` es el tronco y siempre debe poder publicarse, porque GitHub Pages despliega todo lo que llega a `main`.
- Cada cambio va en una rama corta que sale de `main` (`feat/…`, `fix/…`, `chore/…`), dura uno o dos días y vuelve pronto a `main`.
- Commits pequeños. Integra a `main` seguido en vez de acumular cambios.
- Lo que aún no debe ver el público entra a `main` apagado detrás de una bandera, no en una rama larga.
- Antes de integrar a `main`, corre las pruebas: `node --test` para la lógica y una revisión en el navegador.
- En esta carpeta, usa `git -c core.autocrlf=true`: la copia se clonó en Windows y sus archivos tienen fin de línea CRLF.

## Supabase

- Proyecto del equipo: `lvtthltugrpbqjezwnsd` (us-east-1). Su URL y su clave publicable están en `config.js`.
- La base de datos se define en `supabase/migrations/`. Cada cambio es una migración nueva que se pueda aplicar dos veces sin error; no edites migraciones que ya llegaron a `main`.
- La integración con GitHub aplica las migraciones a producción al integrar en `main`: antes, usa `engineering:deploy-checklist`.
- Si aplicas una migración con el MCP de Supabase (`apply_migration`), Supabase la registra con la hora en que se aplicó. Renombra el archivo local con esa versión (`list_migrations`) antes de integrar en `main`, para que la integración no falle ni la repita.
- Después de cada migración, corre los asesores de seguridad y de rendimiento. Los avisos 0029 de las cuatro funciones que usan las cuentas son esperados: no les quites el permiso (ver `docs/cuentas-y-planes.md`).
- El plan solo cambia mediante funciones SQL; la app solo lee. Nunca des permisos de escritura sobre `suscripciones` o `pagos` a `anon` ni a `authenticated`.
- En `config.js` van solo la URL y la clave publicable. Nunca la clave secreta ni la `service_role`.
- Los precios están en dos lugares: `precio()` en la migración y `PRICES` en `index.html`.
- Especificación y diseño: `docs/cuentas-y-planes.md`.
