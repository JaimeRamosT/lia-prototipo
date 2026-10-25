# LIA · prototipo

LIA arma un horario de estudio en las horas libres de universitarios que estudian y trabajan. Este repositorio contiene el prototipo funcional del Grupo 8. Es una sola página que corre en el navegador. Se puede instalar como app y abre sin internet.

> **Prototipo de prueba.** No tiene cuentas, servidor ni pagos. Los datos de cada persona se guardan solo en su dispositivo.

## Publicarlo en GitHub Pages

1. En el repositorio, entra a **Settings → Pages**.
2. En **Build and deployment → Source**, elige **Deploy from a branch**.
3. Elige la rama `main` y la carpeta `/ (root)`, y pulsa **Save**.
4. Espera unos minutos. La dirección aparece arriba de esa misma página y tiene la forma `https://TU-USUARIO.github.io/lia-prototipo/`.

En el plan gratuito de GitHub, Pages solo publica repositorios públicos.

## Actualizarlo

Cada cambio que llega a la rama `main` se publica solo. Quien ya tenga la app instalada recibe la versión nueva la próxima vez que la abre con internet.

Si agregas un archivo nuevo que la app necesite sin internet, súmalo a la lista `SHELL` de `sw.js` y sube el número de `VERSION` en ese mismo archivo.

## Probarlo en tu computadora

Con Python 3 instalado, abre una terminal en esta carpeta y ejecuta:

```
python3 -m http.server 8000
```

Luego abre <http://localhost:8000> en el navegador. Si abres `index.html` con doble clic, la app también funciona, pero no se puede instalar ni usar sin internet.

## Qué hay aquí

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La app completa: estilos, pantallas y lógica. |
| `manifest.webmanifest` | Nombre, colores e íconos para instalarla como app. |
| `sw.js` | Guarda una copia de la app para abrirla sin internet. |
| `icons/` | Íconos de la app y del navegador. |
| `fonts/` | Fuente Inter y su licencia. |
| `.nojekyll` | Le indica a GitHub Pages que publique los archivos tal cual. |

## Qué funciona y qué no

Funciona:

- **Primer uso.** Datos de ejemplo, o tu propio horario con un registro de 2 pasos.
- **Horario automático.** Bloques de estudio en tus horas libres, que se reorganizan cuando algo cambia.
- **Pantallas.** Hoy, Semana, Evaluaciones, chat con Lía (entiende frases simples, sin IA) y modo sesión con temporizador.
- **Dictado por voz.** Solo en navegadores con reconocimiento de voz, como Chrome. En los demás, la app pide usar el micrófono del teclado.
- **App instalable.** Se agrega a la pantalla de inicio y abre sin internet.

Límites de esta versión:

- **Datos solo en el dispositivo.** Viven en el navegador de cada dispositivo, no se sincronizan entre dispositivos y se pierden si se borran los datos del sitio.
- **iPhone sin instalar.** Si LIA no está instalada, Safari borra los datos de un sitio que no se abre en 7 días de uso. Instalada en la pantalla de inicio, eso no pasa.
- **Sin funciones de servidor.** No hay cuentas, recordatorios con la app cerrada ni pagos.

## Créditos

Fuente [Inter](https://github.com/rsms/inter), de The Inter Project Authors, bajo la SIL Open Font License 1.1 (`fonts/OFL.txt`).
