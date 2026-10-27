// LIA · Edge Function lia-ia: Lía entiende mensajes con Gemini (ver docs/ia-con-gemini.md).
// Toda la lógica está en logica.js, que se prueba con node --test (pruebas/ia-funcion.test.mjs).
// Secretos: GEMINI_API_KEY (obligatorio) y GEMINI_MODELO (opcional; por defecto, gemini-3.5-flash-lite).
// Supabase define SUPABASE_URL y SUPABASE_ANON_KEY. verify_jwt está activado: solo llegan cuentas con sesión.
import { manejar } from './logica.js';

Deno.serve((req: Request) =>
  manejar(req, {
    env: (nombre: string) => Deno.env.get(nombre),
    fetch: (url: string, opciones: RequestInit) => fetch(url, opciones),
    log: (dato: Record<string, unknown>) => console.log(JSON.stringify(dato)),
  })
);
