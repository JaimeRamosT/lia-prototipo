// LIA · Edge Function lia-avisos: envía los recordatorios al teléfono (ver docs/notificaciones.md).
// Toda la lógica está en logica.js y webpush.js, que se prueban con node --test (pruebas/avisos-*.test.mjs).
// verify_jwt está apagado: la llama pg_cron (con su secreto de Vault) y la app (la función revisa la sesión).
// Las claves VAPID las crea la propia función la primera vez y viven en Vault: no hay secretos que configurar.
import { manejar } from './logica.js';

Deno.serve((req: Request) =>
  manejar(req, {
    env: (nombre: string) => Deno.env.get(nombre),
    fetch: (url: string, opciones: RequestInit) => fetch(url, opciones),
    log: (dato: Record<string, unknown>) => console.log(JSON.stringify(dato)),
  })
);
