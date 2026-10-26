-- LIA · cupo de mensajes con IA (Lía con Gemini, ver docs/ia-con-gemini.md).
--
-- Cada cuenta Pro puede enviar a la IA hasta 25 mensajes por día y 300 por mes, en hora de Lima.
-- La app solo puede LEER su propio uso. El contador solo cambia mediante usar_ia(), que la Edge Function
-- lia-ia llama con la sesión de la persona: primero para revisar (p_sumar = false) y, si Gemini respondió,
-- para sumar el mensaje (p_sumar = true). Así un error de Gemini no le gasta un mensaje a nadie.
--
-- Esta migración se puede aplicar más de una vez sin error.

create table if not exists public.uso_ia (
  user_id uuid not null references auth.users (id) on delete cascade,
  dia date not null,
  mensajes integer not null default 0 check (mensajes >= 0),
  primary key (user_id, dia)
);
comment on table public.uso_ia is 'Mensajes que cada cuenta envió a la IA por día (hora de Lima). Solo cambia mediante usar_ia().';

alter table public.uso_ia enable row level security;

drop policy if exists "Cada cuenta ve su uso de la IA" on public.uso_ia;
create policy "Cada cuenta ve su uso de la IA" on public.uso_ia
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.uso_ia from anon, authenticated;
grant select on table public.uso_ia to authenticated;

-- Revisa el plan y el cupo de quien llama y, con p_sumar, suma un mensaje.
-- Devuelve {permitido, motivo, restantes_dia, restantes_mes}; motivo es solo_pro, cupo_dia o cupo_mes.
create or replace function public.usar_ia(p_sumar boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tope_dia constant integer := 25;
  v_tope_mes constant integer := 300;
  v_hoy date := public.hoy_lima();
  v_inicio_mes date := date_trunc('month', public.hoy_lima())::date;
  s public.suscripciones;
  v_dia integer;
  v_mes integer;
begin
  s := public.mi_suscripcion();  -- exige sesión iniciada y aplica vencimientos y renovaciones
  if s.plan <> 'pro' then
    return jsonb_build_object('permitido', false, 'motivo', 'solo_pro', 'restantes_dia', 0, 'restantes_mes', 0);
  end if;

  -- Un pedido a la vez por cuenta: dos mensajes simultáneos no pasan el tope.
  perform pg_advisory_xact_lock(hashtextextended('uso_ia:' || s.user_id::text, 0));

  select coalesce(sum(mensajes), 0)::integer into v_mes
    from public.uso_ia where user_id = s.user_id and dia >= v_inicio_mes;
  select coalesce(sum(mensajes), 0)::integer into v_dia
    from public.uso_ia where user_id = s.user_id and dia = v_hoy;

  if v_dia >= v_tope_dia then
    return jsonb_build_object('permitido', false, 'motivo', 'cupo_dia',
      'restantes_dia', 0, 'restantes_mes', greatest(v_tope_mes - v_mes, 0));
  end if;
  if v_mes >= v_tope_mes then
    return jsonb_build_object('permitido', false, 'motivo', 'cupo_mes',
      'restantes_dia', greatest(v_tope_dia - v_dia, 0), 'restantes_mes', 0);
  end if;

  if p_sumar then
    insert into public.uso_ia (user_id, dia, mensajes) values (s.user_id, v_hoy, 1)
    on conflict (user_id, dia) do update set mensajes = public.uso_ia.mensajes + 1;
    v_dia := v_dia + 1;
    v_mes := v_mes + 1;
  end if;

  return jsonb_build_object('permitido', true, 'motivo', null,
    'restantes_dia', v_tope_dia - v_dia, 'restantes_mes', v_tope_mes - v_mes);
end
$$;

revoke all on function public.usar_ia(boolean) from public, anon;
grant execute on function public.usar_ia(boolean) to authenticated;
