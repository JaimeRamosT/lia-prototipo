# LIA · Fábrica de software

2 de noviembre de 2026. Responde a la observación del supervisor (30-oct): programar «solo con skills» no basta; se espera una línea de producción con agentes, pruebas automáticas y puertas de calidad.

## La línea

Cada pedido pasa por los mismos pasos. Ninguna persona ni ningún agente revisa su propio trabajo.

| Paso | Quién | Entrega | Puerta |
| --- | --- | --- | --- |
| 1. Especificación | Agente `producto` | Problema, alcance, criterios de aceptación y frases de prueba | Coconut la aprueba |
| 2. Pruebas primero | Agente `pruebas` | Pruebas que fallan (`node --test`, navegador, frases) | Fallan antes del cambio |
| 3. Código | Agente `desarrollo` (Claude Code; Codex u OpenCode para tareas simples) | Rama corta con commits convencionales | Pasan todas las pruebas |
| 4. CI | GitHub Actions (`pruebas.yml`) | Lógica, reglas y navegador en iPhone y Android | En verde |
| 5. IA | Agente `evaluador-ia` y `eval-ia.yml` (etiqueta `ia`) | Evaluación con el modelo real | ≥ 90 % y 0 peor que las reglas |
| 6. Revisión | Agente `revisor` con otro modelo u otra herramienta | Hallazgos y veredicto | Aprobado |
| 7. Experiencia | Agente `ux` (si cambia algo visible) | Ajustes de pantalla, accesibilidad y textos | AA y textos revisados |
| 8. Publicación | Agente `publicador` y Coconut | Integración a `main`, funciones de Supabase, prueba en producción | Coconut integra |
| 9. Registro | Quien publicó | Notion: qué cambió, resultado y pendientes | — |

Los agentes están en `.claude/agents/`. En Claude Code se llaman por su nombre («usa el agente revisor con el PR #42»). Cada uno carga los skills que pide CLAUDE.md.

## Trabajo en paralelo

- Una persona o un agente por rama, en su propio worktree (`git worktree add ../lia-<rama> -b <rama> origin/main`).
- Las funciones nuevas van en archivos propios cuando se puede, para no chocar dentro de `index.html`.
- Si dos ramas suben la versión, la segunda en integrarse la resuelve con el número siguiente.

## Lo que falta configurar (lo hace quien administra el repositorio)

- **Proteger `main`** (Settings → Branches → Add rule): exigir los checks «Lógica (node --test)» y «Navegador (iPhone y Android)», y un PR antes de integrar.
- **Secretos de GitHub** (Settings → Secrets and variables → Actions): `GROQ_API_KEY` para `eval-ia.yml`. Opcional: `GEMINI_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`.
- **Revisión automática opcional** con `anthropics/claude-code-action`: con el token de una suscripción gasta los créditos de quien lo generó.

## Herramientas y costo

Ver la página de Notion «LIA · Siguiente iteración: modelos, fábrica de software y costos». GitHub Actions es gratis en repositorios públicos.
