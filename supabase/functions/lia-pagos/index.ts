// LIA · Edge Function lia-pagos: cobro de LIA Pro con Mercado Pago Checkout Pro (docs/pagos.md, borrador).
// La lógica está en logica.js (pruebas/pagos-mp.test.mjs). Apagada mientras PAGOS_MODO no sea «prueba» o «real».
// verify_jwt está apagado: llaman Mercado Pago (aviso firmado) y la app (con su sesión, que se revisa en logica.js).
// Secretos: MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, PAGOS_MODO (demo | prueba | real) y PAGOS_CORREOS (para «prueba»).
import { manejar } from './logica.js';

Deno.serve((req: Request) =>
  manejar(req, {
    env: (nombre: string) => Deno.env.get(nombre),
    fetch: (url: string, opciones: RequestInit) => fetch(url, opciones),
    log: (dato: Record<string, unknown>) => console.log(JSON.stringify(dato)),
    crypto: globalThis.crypto,
  })
);
