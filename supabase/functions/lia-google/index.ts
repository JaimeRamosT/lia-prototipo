// LIA · Edge Function lia-google: «Conectar con Google» (docs/google.md). La lógica está en logica.js
// (pruebas/google-funcion.test.mjs). verify_jwt está apagado: Google (regreso del permiso y avisos) y pg_cron no tienen
// sesión; las llamadas de la app mandan la sesión de la persona y se revisa en logica.js.
import { manejar } from './logica.js';

Deno.serve((req: Request) =>
  manejar(req, {
    env: (nombre: string) => Deno.env.get(nombre),
    fetch: (url: string, opciones: RequestInit) => fetch(url, opciones),
    log: (dato: Record<string, unknown>) => console.log(JSON.stringify(dato)),
    ahora: () => new Date(),
  })
);
