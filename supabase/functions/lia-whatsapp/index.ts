// LIA · Edge Function lia-whatsapp: Lía en WhatsApp con la Cloud API de Meta
// (ver docs/canales.md). La lógica está en logica.js (pruebas/canales-whatsapp.test.mjs).
// verify_jwt está apagado: llaman Meta (con firma) y pg_cron (con el secreto de Vault).
// Secretos: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_APP_SECRET y WHATSAPP_VERIFY_TOKEN; opcionales
// WHATSAPP_PLANTILLA (avisos fuera de las 24 h) y GROQ_API_KEY (preguntas libres).
import { manejar } from './logica.js';

Deno.serve((req: Request) =>
  manejar(req, {
    env: (nombre: string) => Deno.env.get(nombre),
    fetch: (url: string, opciones: RequestInit) => fetch(url, opciones),
    log: (dato: Record<string, unknown>) => console.log(JSON.stringify(dato)),
  })
);
