// LIA · Edge Function lia-whatsapp: Lía en WhatsApp con la Cloud API de Meta (ver docs/canales.md y
// docs/whatsapp-lia.md). La lógica está en logica.js (pruebas/canales.test.mjs y pruebas/whatsapp-lia.test.mjs);
// reglas.js e ia.js son copias generadas con copiar.mjs (no se editan a mano).
// verify_jwt está apagado: llaman Meta (con firma), pg_cron (con el secreto de Vault) y la app (con su sesión).
// Secretos: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_APP_SECRET y WHATSAPP_VERIFY_TOKEN; WHATSAPP_PLANTILLA_CODIGO
// (código de vinculación); opcional WHATSAPP_PLANTILLA (avisos fuera de las 24 h). La IA (solo Pro) usa los mismos
// secretos que lia-ia: IA_PROVEEDOR, IA_RESPALDO, GROQ_API_KEY y GEMINI_API_KEY.
import { manejar } from './logica.js';

Deno.serve((req: Request) =>
  manejar(req, {
    env: (nombre: string) => Deno.env.get(nombre),
    fetch: (url: string, opciones: RequestInit) => fetch(url, opciones),
    log: (dato: Record<string, unknown>) => console.log(JSON.stringify(dato)),
    crypto: globalThis.crypto,
  })
);
