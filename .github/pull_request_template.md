<!-- Fábrica de LIA (docs/fabrica.md). Borra lo que no aplique. -->
## Qué cambia y por qué

## Especificación
- Pedido u observación que cierra:
- Criterios de aceptación:

## Pruebas
- [ ] `node --test`
- [ ] `node pruebas/ia/evaluar.mjs --solo-reglas` (97 % o más)
- [ ] Pruebas de navegador (iPhone y Android) en la CI
- [ ] Si toca a Lía: evaluación con el modelo real (etiqueta `ia`), «lo que ve la persona» ≥ 90 % y 0 peor que las reglas
- [ ] Vista previa de Cloudflare probada en un celular

## Revisión
- [ ] Revisado por un agente o modelo distinto del que programó (`revisor`)
- [ ] Sin claves en el diff; `config.js` solo con la clave publicable
- [ ] Versión subida (`APP_VERSION` y `VERSION` de `sw.js`), `SHELL` y `.assetsignore` al día
- [ ] Migraciones nuevas que se pueden aplicar dos veces

## Después de integrar
- [ ] Funciones de Supabase desplegadas (si cambiaron) y secretos configurados
- [ ] Registro en Notion
