-- LIA · tu horario en tu cuenta (solo LIA Pro). Ver docs/horario-en-cuenta.md.
--
-- Una fila por cuenta con el horario como documento (jsonb) y un número de versión (rev). La app sube el documento
-- entero junto con la versión que conocía: si alguien guardó antes desde otro dispositivo, no se pisa nada y la app
-- pregunta cuál conservar. La app no lee ni escribe la tabla directamente: solo con estas tres funciones.
--
-- Nunca se guarda el chat, el plan, la cuenta ni nada que vino de Google Calendar: la función rechaza el documento.
--
-- Esta migración se puede aplicar más de una vez sin error.

-- Las versiones salen de una secuencia de todas las cuentas: nunca se repiten, aunque la copia se borre y se vuelva a
-- crear. Así un dispositivo que conocía una versión vieja nunca la confunde con la nueva y pisa lo que no vio.
create sequence if not exists public.horarios_rev;
revoke all on sequence public.horarios_rev from public, anon, authenticated;

create table if not exists public.horarios (
  user_id uuid primary key references auth.users (id) on delete cascade,
  datos jsonb not null check (jsonb_typeof(datos) = 'object'),
  rev bigint not null default nextval('public.horarios_rev') check (rev > 0),
  actualizado timestamptz not null default now()
);
comment on table public.horarios is 'Horario de cada cuenta Pro (sin chat ni datos de Google). Solo cambia con guardar_horario() y borrar_horario().';

alter table public.horarios enable row level security;
revoke all on table public.horarios from anon, authenticated;

-- El horario de quien llama. {pro:false} sin Pro; {pro:true, rev:0} si no hay copia.
create or replace function public.mi_horario() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.suscripciones;
  h public.horarios;
begin
  s := public.mi_suscripcion();  -- exige sesión iniciada y aplica vencimientos
  if s.plan <> 'pro' then
    return jsonb_build_object('pro', false);
  end if;
  select * into h from public.horarios where user_id = s.user_id;
  if not found then
    return jsonb_build_object('pro', true, 'rev', 0);
  end if;
  return jsonb_build_object('pro', true, 'rev', h.rev, 'datos', h.datos, 'actualizado', h.actualizado);
end
$$;

-- Guarda el horario si p_rev es la versión actual (0 si todavía no hay copia).
-- Devuelve {ok:true, rev, actualizado} o {ok:false, motivo}: solo_pro, no_permitido, muy_grande o conflicto (con rev).
create or replace function public.guardar_horario(p_datos jsonb, p_rev bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.suscripciones;
  v_rev bigint;
  v_cuando timestamptz;
begin
  s := public.mi_suscripcion();
  if s.plan <> 'pro' then
    return jsonb_build_object('ok', false, 'motivo', 'solo_pro');
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' or p_rev is null or p_rev < 0
     or jsonb_path_exists(p_datos, 'strict $.**.gcal') or jsonb_path_exists(p_datos, 'strict $.**.chat')
     or jsonb_path_exists(p_datos, 'strict $.**.sub') or jsonb_path_exists(p_datos, 'strict $.**.cuenta')
     or jsonb_path_exists(p_datos, 'strict $.**.borrador') then
    return jsonb_build_object('ok', false, 'motivo', 'no_permitido');
  end if;
  if octet_length(p_datos::text) > 512 * 1024 then
    return jsonb_build_object('ok', false, 'motivo', 'muy_grande');
  end if;

  -- Una escritura a la vez por cuenta: dos dispositivos que guardan juntos no se pisan.
  perform pg_advisory_xact_lock(hashtextextended('horario:' || s.user_id::text, 0));
  select rev into v_rev from public.horarios where user_id = s.user_id;
  if coalesce(v_rev, 0) <> p_rev then
    return jsonb_build_object('ok', false, 'motivo', 'conflicto', 'rev', coalesce(v_rev, 0));
  end if;

  if v_rev is null then
    insert into public.horarios (user_id, datos, rev) values (s.user_id, p_datos, nextval('public.horarios_rev'))
    returning rev, actualizado into v_rev, v_cuando;
  else
    update public.horarios set datos = p_datos, rev = nextval('public.horarios_rev'), actualizado = now()
     where user_id = s.user_id
    returning rev, actualizado into v_rev, v_cuando;
  end if;
  return jsonb_build_object('ok', true, 'rev', v_rev, 'actualizado', v_cuando);
end
$$;

-- Borra la copia de la cuenta de quien llama (con o sin Pro: los datos son suyos).
create or replace function public.borrar_horario() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Necesitas iniciar sesión' using errcode = '42501';
  end if;
  delete from public.horarios where user_id = auth.uid();
end
$$;

revoke all on function public.mi_horario(), public.guardar_horario(jsonb, bigint), public.borrar_horario() from public, anon;
grant execute on function public.mi_horario(), public.guardar_horario(jsonb, bigint), public.borrar_horario() to authenticated;
