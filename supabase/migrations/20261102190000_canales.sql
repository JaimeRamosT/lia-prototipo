-- Canales de LIA (2-nov-2026, ver docs/canales.md): ver el estudio en Google Calendar con un enlace iCal secreto
-- (sin Google Cloud) y recibir avisos y consultas por WhatsApp (Cloud API de Meta).
-- Solo para cuentas que activan un canal. Al activarlo, la app publica sus próximas sesiones y evaluaciones CON
-- su título (por ejemplo «Estudiar Cálculo II»): es lo que se ve en el calendario y en WhatsApp. La persona lo
-- acepta al activar el canal y lo borra al desactivarlo.
-- Nadie lee ni escribe estas tablas desde la app: solo con las funciones de abajo. Se puede aplicar dos veces.

create table if not exists public.canales (
  user_id uuid primary key references auth.users (id) on delete cascade,
  cal_token text unique check (cal_token is null or length(cal_token) between 32 and 80),
  wa_numero text unique check (wa_numero is null or wa_numero ~ '^[0-9]{8,15}$'),
  wa_verificado boolean not null default false,
  wa_codigo text check (wa_codigo is null or wa_codigo ~ '^[0-9]{6}$'),
  wa_codigo_vence timestamptz,
  wa_avisos boolean not null default true,
  actualizado timestamptz not null default now()
);
alter table public.canales enable row level security;
revoke all on table public.canales from anon, authenticated;

create table if not exists public.agenda_canales (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  inicio timestamptz not null,
  fin timestamptz not null,
  titulo text not null check (length(titulo) between 1 and 80),
  tipo text not null check (tipo in ('estudio', 'evaluacion', 'clase', 'otro')),
  avisado boolean not null default false,
  check (fin > inicio)
);
create index if not exists agenda_canales_usuario on public.agenda_canales (user_id, inicio);
create index if not exists agenda_canales_por_avisar on public.agenda_canales (inicio) where not avisado;
alter table public.agenda_canales enable row level security;
revoke all on table public.agenda_canales from anon, authenticated;

-- ---------- Para la app (cuentas con sesión) ----------

-- Qué canales tiene activos la cuenta.
create or replace function public.canales_estado() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'calendario', c.cal_token,
    'whatsapp', case when c.wa_numero is null then null else jsonb_build_object(
      'numero', c.wa_numero, 'verificado', c.wa_verificado, 'avisos', c.wa_avisos,
      'codigo', case when not c.wa_verificado and c.wa_codigo_vence > now() then c.wa_codigo end) end)
  from (select auth.uid() as uid) u left join public.canales c on c.user_id = u.uid
  where u.uid is not null
$$;

-- Activa el enlace del calendario (o devuelve el que ya había).
create or replace function public.activar_calendario() returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_token text;
begin
  if v_uid is null then raise exception 'sesion' using errcode = '42501'; end if;
  insert into public.canales (user_id) values (v_uid) on conflict (user_id) do nothing;
  update public.canales set cal_token = coalesce(cal_token, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')), actualizado = now()
    where user_id = v_uid returning cal_token into v_token;
  return v_token;
end $$;

-- Deja de compartir: el enlace deja de funcionar. Si tampoco hay WhatsApp, se borra la agenda publicada.
create or replace function public.desactivar_calendario() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sesion' using errcode = '42501'; end if;
  update public.canales set cal_token = null, actualizado = now() where user_id = v_uid;
  delete from public.agenda_canales a where a.user_id = v_uid
    and not exists (select 1 from public.canales c where c.user_id = v_uid and c.wa_verificado);
end $$;

-- Pide un código para vincular un número de WhatsApp (válido 15 minutos). La persona lo envía por WhatsApp a LIA.
create or replace function public.pedir_codigo_whatsapp(p_numero text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_num text := regexp_replace(coalesce(p_numero, ''), '[^0-9]', '', 'g'); v_codigo text;
begin
  if v_uid is null then raise exception 'sesion' using errcode = '42501'; end if;
  if length(v_num) = 9 and left(v_num, 1) = '9' then v_num := '51' || v_num; end if;  -- celular peruano sin código de país
  if v_num !~ '^[0-9]{8,15}$' then raise exception 'numero_invalido' using errcode = '22023'; end if;
  if exists (select 1 from public.canales where wa_numero = v_num and wa_verificado and user_id <> v_uid) then
    raise exception 'numero_ocupado' using errcode = '23505';
  end if;
  update public.canales set wa_numero = null, wa_codigo = null where wa_numero = v_num and user_id <> v_uid;
  v_codigo := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into public.canales (user_id, wa_numero, wa_verificado, wa_codigo, wa_codigo_vence)
    values (v_uid, v_num, false, v_codigo, now() + interval '15 minutes')
    on conflict (user_id) do update set wa_numero = excluded.wa_numero, wa_verificado = false,
      wa_codigo = excluded.wa_codigo, wa_codigo_vence = excluded.wa_codigo_vence, actualizado = now();
  return v_codigo;
end $$;

-- Desvincula WhatsApp. Si tampoco hay calendario, se borra la agenda publicada.
create or replace function public.quitar_whatsapp() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sesion' using errcode = '42501'; end if;
  update public.canales set wa_numero = null, wa_verificado = false, wa_codigo = null, wa_codigo_vence = null, actualizado = now() where user_id = v_uid;
  delete from public.agenda_canales a where a.user_id = v_uid
    and not exists (select 1 from public.canales c where c.user_id = v_uid and c.cal_token is not null);
end $$;

-- Avisos por WhatsApp sí o no.
create or replace function public.avisos_whatsapp(p_activos boolean) returns void
language sql security definer set search_path = '' as $$
  update public.canales set wa_avisos = coalesce(p_activos, true), actualizado = now() where user_id = auth.uid()
$$;

-- Publica la agenda de los próximos días (reemplaza la anterior). Lo ya avisado sigue marcado, para no repetir avisos.
-- Solo con un canal activo; hasta 300 eventos, desde hace 14 días hasta dentro de 60.
create or replace function public.publicar_agenda(p_eventos jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_n integer;
begin
  if v_uid is null then raise exception 'sesion' using errcode = '42501'; end if;
  if not exists (select 1 from public.canales where user_id = v_uid and (cal_token is not null or wa_verificado)) then
    raise exception 'sin_canal' using errcode = '22023';
  end if;
  if jsonb_typeof(p_eventos) is distinct from 'array' or jsonb_array_length(p_eventos) > 300 then
    raise exception 'agenda_invalida' using errcode = '22023';
  end if;
  with viejos as (
    delete from public.agenda_canales where user_id = v_uid returning inicio, titulo, avisado
  ), nuevos as (
    select (e->>'inicio')::timestamptz as inicio, (e->>'fin')::timestamptz as fin,
           left(btrim(coalesce(e->>'titulo', '')), 80) as titulo, coalesce(e->>'tipo', 'otro') as tipo
    from jsonb_array_elements(p_eventos) e
  ), ins as (
    insert into public.agenda_canales (user_id, inicio, fin, titulo, tipo, avisado)
    select v_uid, n.inicio, n.fin, n.titulo, n.tipo,
           coalesce((select bool_or(v.avisado) from viejos v where v.inicio = n.inicio and v.titulo = n.titulo), false)
    from nuevos n
    where n.fin > n.inicio and n.fin - n.inicio <= interval '24 hours' and length(n.titulo) > 0
      and n.tipo in ('estudio', 'evaluacion', 'clase', 'otro')
      and n.fin > now() - interval '14 days' and n.inicio < now() + interval '60 days'
    returning 1
  ) select count(*) into v_n from ins;
  update public.canales set actualizado = now() where user_id = v_uid;
  return v_n;
end $$;

revoke all on function public.canales_estado() from public, anon;
revoke all on function public.activar_calendario() from public, anon;
revoke all on function public.desactivar_calendario() from public, anon;
revoke all on function public.pedir_codigo_whatsapp(text) from public, anon;
revoke all on function public.quitar_whatsapp() from public, anon;
revoke all on function public.avisos_whatsapp(boolean) from public, anon;
revoke all on function public.publicar_agenda(jsonb) from public, anon;
grant execute on function public.canales_estado() to authenticated;
grant execute on function public.activar_calendario() to authenticated;
grant execute on function public.desactivar_calendario() to authenticated;
grant execute on function public.pedir_codigo_whatsapp(text) to authenticated;
grant execute on function public.quitar_whatsapp() to authenticated;
grant execute on function public.avisos_whatsapp(boolean) to authenticated;
grant execute on function public.publicar_agenda(jsonb) to authenticated;

-- ---------- Para las Edge Functions lia-calendario y lia-whatsapp (solo service_role) ----------

create or replace function public.agenda_por_token(p_token text)
returns table (id bigint, inicio timestamptz, fin timestamptz, titulo text, tipo text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.inicio, a.fin, a.titulo, a.tipo
  from public.canales c join public.agenda_canales a on a.user_id = c.user_id
  where c.cal_token = p_token and length(coalesce(p_token, '')) >= 32
    and a.fin > now() - interval '14 days' and a.inicio < now() + interval '60 days'
  order by a.inicio
  limit 300
$$;

create or replace function public.vincular_whatsapp(p_numero text, p_codigo text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  update public.canales set wa_verificado = true, wa_codigo = null, wa_codigo_vence = null, actualizado = now()
    where wa_numero = p_numero and wa_codigo = p_codigo and wa_codigo_vence > now()
    returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- La agenda de un número vinculado entre dos momentos (para «¿qué tengo hoy?»). Sin filas si no está vinculado.
create or replace function public.agenda_whatsapp(p_numero text, p_desde timestamptz, p_hasta timestamptz)
returns table (inicio timestamptz, fin timestamptz, titulo text, tipo text)
language sql stable security definer set search_path = '' as $$
  select a.inicio, a.fin, a.titulo, a.tipo
  from public.canales c join public.agenda_canales a on a.user_id = c.user_id
  where c.wa_numero = p_numero and c.wa_verificado and a.fin > p_desde and a.inicio < p_hasta
  order by a.inicio
  limit 50
$$;

-- ¿Está vinculado este número? null si no; true o false según quiera avisos.
create or replace function public.whatsapp_vinculado(p_numero text) returns boolean
language sql stable security definer set search_path = '' as $$
  select c.wa_avisos from public.canales c where c.wa_numero = p_numero and c.wa_verificado
$$;

create or replace function public.avisos_whatsapp_numero(p_numero text, p_activos boolean) returns void
language sql security definer set search_path = '' as $$
  update public.canales set wa_avisos = p_activos, actualizado = now() where wa_numero = p_numero and wa_verificado
$$;

-- Los avisos que tocan: 15 minutos antes de cada sesión de estudio y 2 horas antes de cada evaluación.
-- Se marcan como avisados al tomarlos, así dos llamadas seguidas no los repiten.
create or replace function public.tomar_avisos_whatsapp()
returns table (numero text, titulo text, inicio timestamptz, fin timestamptz, tipo text)
language sql security definer set search_path = '' as $$
  update public.agenda_canales a set avisado = true
  from public.canales c
  where c.user_id = a.user_id and c.wa_verificado and c.wa_avisos and not a.avisado
    and a.tipo in ('estudio', 'evaluacion') and a.inicio > now()
    and now() >= a.inicio - case when a.tipo = 'estudio' then interval '15 minutes' else interval '2 hours' end
  returning c.wa_numero, a.titulo, a.inicio, a.fin, a.tipo
$$;

revoke all on function public.agenda_por_token(text) from public, anon, authenticated;
revoke all on function public.vincular_whatsapp(text, text) from public, anon, authenticated;
revoke all on function public.agenda_whatsapp(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.whatsapp_vinculado(text) from public, anon, authenticated;
revoke all on function public.avisos_whatsapp_numero(text, boolean) from public, anon, authenticated;
revoke all on function public.tomar_avisos_whatsapp() from public, anon, authenticated;
grant execute on function public.agenda_por_token(text) to service_role;
grant execute on function public.vincular_whatsapp(text, text) to service_role;
grant execute on function public.agenda_whatsapp(text, timestamptz, timestamptz) to service_role;
grant execute on function public.whatsapp_vinculado(text) to service_role;
grant execute on function public.avisos_whatsapp_numero(text, boolean) to service_role;
grant execute on function public.tomar_avisos_whatsapp() to service_role;

-- ---------- Cada minuto, pg_cron pide a lia-whatsapp que envíe los avisos que tocan ----------
-- Usa el mismo secreto de Vault que lia-avisos. Sin las claves de Meta, la función responde sin enviar nada.
select cron.schedule('lia-whatsapp', '* * * * *', $cron$
  select net.http_post(
    url := 'https://lvtthltugrpbqjezwnsd.supabase.co/functions/v1/lia-whatsapp',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-lia-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'lia_avisos_secreto')),
    body := '{"accion":"avisos"}'::jsonb,
    timeout_milliseconds := 25000)
$cron$);
