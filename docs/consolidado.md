# LIA · Importar el consolidado de matrícula

2 de noviembre de 2026. Cierra la idea B del plan del 31-oct (paridad con Kairo en el primer minuto): en lugar de escribir las clases, la persona sube el PDF de su consolidado de matrícula.

## Cómo funciona

1. En el registro («Importar mi consolidado de matrícula») o en «Agregar» → «Consolidado de matrícula», la persona elige el PDF.
2. La app lo lee **en el teléfono** con pdf.js (`vendor/pdfjs`, Mozilla, Apache 2.0). El PDF no se envía a ningún lado. pdf.js se descarga solo la primera vez que se usa y luego queda guardado para abrir sin internet.
3. `leerConsolidado()` (en la lógica de `index.html`) busca la columna de horarios («Lunes Teoría 20:00-22:00 A901»), junta los horarios partidos en dos líneas o entre páginas, y asigna cada horario al curso de su fila. No lee el nombre ni el código del alumno.
4. La persona ve los cursos con sus horarios, desmarca lo que no quiera y toca «Agregar cursos». Cada curso queda como una rutina de clases (un horario por par de horas, con todos sus días). Lo que ya estaba igual no se duplica, y todo se deshace con un solo Deshacer.

## Qué entra y qué no

- Entra: PDF con texto (el que se descarga de la intranet), probado con el formato de UTEC y con el de una fila por horario.
- No entra todavía: fotos o PDF escaneados (sin texto); para eso haría falta OCR (por ejemplo, Mistral OCR, US$ 4 por 1 000 páginas).
- Pendiente: probar con consolidados reales de UPC, UTP, PUCP y San Marcos (con permiso de cada estudiante y sin subirlos al repositorio).

## Pruebas

- `pruebas/consolidado.test.mjs`: el lector con `pruebas/consolidado/items-ejemplo.json`.
- `pruebas/navegador/consolidado.nav.mjs`: el flujo completo con `pruebas/consolidado/consolidado-ejemplo.pdf` y pdf.js real, en iPhone y Android.
- Los dos archivos de ejemplo se generaron con datos inventados. **Nunca subas al repositorio un consolidado real**: trae nombre y código del alumno.
