// LIA · Edge Function lia-calendario: el enlace iCal secreto para ver el estudio de LIA en Google Calendar
// sin Google Cloud (ver docs/canales.md). La lógica está en logica.js (pruebas/canales-calendario.test.mjs).
// verify_jwt está apagado: Google Calendar pide el enlace sin sesión; el token secreto es la llave.
import { manejar } from './logica.js';

Deno.serve((req: Request) =>
  manejar(req, {
    env: (nombre: string) => Deno.env.get(nombre),
    fetch: (url: string, opciones: RequestInit) => fetch(url, opciones),
    log: (dato: Record<string, unknown>) => console.log(JSON.stringify(dato)),
  })
);
