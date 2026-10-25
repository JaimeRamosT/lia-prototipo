# LIA · instrucciones para Claude

LIA es un prototipo de app web instalable (HTML, CSS y JavaScript en un solo `index.html`) que arma horarios de estudio en las horas libres de universitarios que trabajan. Es del Grupo 8, en Perú. Se publica con GitHub Pages desde `main`. Los datos viven en `localStorage` (`lia.app.v1`). El prototipo no incluye pagos. Responde y escribe en español.

## Skills: llámalos, no los omitas

Antes de empezar cada tarea, revisa esta tabla. Si una fila aplica, carga ese skill con la herramienta de skills antes de trabajar, no después.

| Situación | Skill |
|---|---|
| Vas a cambiar `plan()`, `interpret()` o el formato de los datos guardados | `engineering:testing-strategy` antes; `engineering:code-review` al terminar |
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
- Si agregas un archivo que la app necesita sin internet, súmalo a `SHELL` en `sw.js` y sube `VERSION`.
- GitHub Pages sirve para el prototipo. No se usa para cobrar: antes de eso hay que mudar el hosting.

## Flujo de trabajo: trunk-based development (desde el 25 de octubre de 2026)

- `main` es el tronco y siempre debe poder publicarse, porque GitHub Pages despliega todo lo que llega a `main`.
- Cada cambio va en una rama corta que sale de `main` (`feat/…`, `fix/…`, `chore/…`), dura uno o dos días y vuelve pronto a `main`.
- Commits pequeños. Integra a `main` seguido en vez de acumular cambios.
- Lo que aún no debe ver el público entra a `main` apagado detrás de una bandera (por ejemplo `pagos`), no en una rama larga.
- Antes de integrar a `main`, corre las pruebas.
- En esta carpeta, usa `git -c core.autocrlf=true`: la copia se clonó en Windows y sus archivos tienen fin de línea CRLF.
