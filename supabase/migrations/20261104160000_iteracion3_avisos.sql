-- LIA · iteración 3 (docs/iteracion-3.md, secciones 1 y 2): recordatorios de toda la agenda por WhatsApp y canales de
-- Google Calendar que vuelven a avisar. Se puede aplicar dos veces sin error.

-- ---------- 1. Google Calendar: recrear los canales de avisos ----------
-- Google manda el primer aviso del canal («sync») antes de que google_guardar lo guarde. lia-google respondía 404 y
-- Google no volvió a avisar en ese canal (registro del 3-nov, 22:49). Desde el arreglo de lia-google responde 200, pero
-- los canales que ya existen siguen mudos: vencen ya y la renovación de cada hora (google_canales_por_vencer, pg_cron
-- 'lia-google') los vuelve a crear. Aplicarla otra vez solo adelanta una renovación más.
update public.google_cuentas set canal_vence = now() where canal_id is not null;

-- ---------- 2. WhatsApp: recordatorios de toda la agenda publicada ----------
-- Antes solo avisaba del estudio y de las evaluaciones. Ahora de todo lo que publica la app en agenda_canales:
-- estudio, clases y eventos o rutinas («otro»), 15 minutos antes; evaluaciones, 2 horas antes. «pausa» (wa_avisos) los
-- apaga y un número sin verificar no recibe nada. Se marcan como avisados al tomarlos: dos llamadas seguidas no los
-- repiten. Fuera de las 24 horas desde el último mensaje de la persona, Meta solo entrega con la plantilla Utility
-- (WHATSAPP_PLANTILLA, docs/canales.md).
create or replace function public.tomar_avisos_whatsapp()
returns table (numero text, titulo text, inicio timestamptz, fin timestamptz, tipo text)
language sql security definer set search_path = '' as $$
  update public.agenda_canales a set avisado = true
  from public.canales c
  where c.user_id = a.user_id and c.wa_verificado and c.wa_avisos and not a.avisado
    and a.tipo in ('estudio', 'evaluacion', 'clase', 'otro') and a.inicio > now()
    and now() >= a.inicio - case when a.tipo = 'evaluacion' then interval '2 hours' else interval '15 minutes' end
  returning c.wa_numero, a.titulo, a.inicio, a.fin, a.tipo
$$;

revoke all on function public.tomar_avisos_whatsapp() from public, anon, authenticated;
grant execute on function public.tomar_avisos_whatsapp() to service_role;
