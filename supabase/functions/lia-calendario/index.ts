// LIA · Edge Function lia-calendario: Google Calendar en los dos sentidos sin Google Cloud (ver docs/canales.md y
// docs/calendario.md). GET ?t=<token>: el enlace iCal secreto con lo de LIA. POST {accion:'importar', url}: lee la
// dirección secreta del calendario de la persona y la devuelve a la app. La lógica está en logica.js
// (pruebas/canales.test.mjs y pruebas/calendario-funcion.test.mjs).
// verify_jwt está apagado: Google Calendar pide el enlace sin sesión (el token secreto es la llave); el POST revisa la
// sesión de la persona en logica.js.
import { manejar } from './logica.js';

Deno.serve((req: Request) =>
  manejar(req, {
    env: (nombre: string) => Deno.env.get(nombre),
    fetch: (url: string, opciones: RequestInit) => fetch(url, opciones),
    log: (dato: Record<string, unknown>) => console.log(JSON.stringify(dato)),
    ahora: () => new Date(),
  })
);
