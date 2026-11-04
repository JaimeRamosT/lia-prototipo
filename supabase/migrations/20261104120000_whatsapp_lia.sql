-- Lía en WhatsApp, igual que en la app (docs/whatsapp-lia.md, ADR-006). Se puede aplicar dos veces sin error.
-- - contexto_whatsapp: lo que Lía necesita para entender (evaluaciones, rutinas y horas de sueño), que publica la app
--   mientras WhatsApp está vinculado. Sin nombre ni correo.
-- - propuestas_whatsapp: lo entendido (nunca el texto del mensaje): borrador (Lía preguntó un dato, 10 minutos),
--   pendiente (espera el «sí», 30 minutos) y confirmada (la app la guarda y la borra; 14 días).
-- - whatsapp_senal: un contador por cuenta que la app abierta escucha con Realtime (como google_senal).
-- - whatsapp_vistos: el hash del id de cada mensaje de Meta por 2 días, para no responder dos veces.
-- Sin permisos directos: solo funciones. La app solo publica su contexto, lee sus confirmadas y las borra.

create table if not exists public.contexto_whatsapp (
  user_id uuid primary key references auth.users (id) on delete cascade,
  contexto jsonb not null,
  actualizado timestamptz not null default now()
);

create table if not exists public.propuestas_whatsapp (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  estado text not null check (estado in ('borrador', 'pendiente', 'confirmada')),
  intencion jsonb not null,
  creado timestamptz not null default now(),
  vence timestamptz not null
);
create index if not exists propuestas_whatsapp_cuenta on public.propuestas_whatsapp (user_id, estado);

create table if not exists public.whatsapp_senal (
  user_id uuid primary key references auth.users (id) on delete cascade,
  n bigint not null default 0,
  actualizado timestamptz not null default now()
);

create table if not exists public.whatsapp_vistos (
  hash text primary key,
  creado timestamptz not null default now()
);

alter table public.contexto_whatsapp enable row level security;
alter table public.propuestas_whatsapp enable row level security;
alter table public.whatsapp_senal enable row level security;
alter table public.whatsapp_vistos enable row level security;
revoke all on public.contexto_whatsapp, public.propuestas_whatsapp, public.whatsapp_senal, public.whatsapp_vistos from anon, authenticated;
grant select on public.whatsapp_senal to authenticated;
drop policy if exists whatsapp_senal_propia on public.whatsapp_senal;
create policy whatsapp_senal_propia on public.whatsapp_senal for select to authenticated using ((select auth.uid()) = user_id);

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_senal') then
    alter publication supabase_realtime add table public.whatsapp_senal;
  end if;
end $$;

-- ---------- Para la app (authenticated) ----------

-- Publica el contexto (reemplaza el anterior). Solo con WhatsApp vinculado y hasta 60 000 caracteres.
create or replace function public.publicar_contexto_whatsapp(p_contexto jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sesion' using errcode = '42501'; end if;
  if not exists (select 1 from public.canales where user_id = v_uid and wa_verificado) then return false; end if;
  if p_contexto is null or jsonb_typeof(p_contexto) <> 'object' or length(p_contexto::text) > 60000 then
    raise exception 'contexto_invalido' using errcode = '22023';
  end if;
  insert into public.contexto_whatsapp (user_id, contexto, actualizado) values (v_uid, p_contexto, now())
  on conflict (user_id) do update set contexto = excluded.contexto, actualizado = now();
  return true;
end $$;

-- Lo que la persona confirmó por WhatsApp y la app todavía no guarda, del más antiguo al más nuevo.
create or replace function public.propuestas_whatsapp_confirmadas()
returns table (id uuid, intencion jsonb, creado timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.intencion, p.creado from public.propuestas_whatsapp p
  where p.user_id = auth.uid() and p.estado = 'confirmada' and p.vence > now()
  order by p.creado
  limit 20
$$;

-- La app ya las guardó (o no se podían guardar): se borran.
create or replace function public.quitar_propuestas_whatsapp(p_ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_n integer;
begin
  if v_uid is null then raise exception 'sesion' using errcode = '42501'; end if;
  delete from public.propuestas_whatsapp where user_id = v_uid and estado = 'confirmada' and id = any (coalesce(p_ids, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Al desvincular WhatsApp también se borran el contexto y lo propuesto (además de lo que ya hacía).
create or replace function public.quitar_whatsapp() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sesion' using errcode = '42501'; end if;
  update public.canales set wa_numero = null, wa_verificado = false, wa_codigo = null, wa_codigo_vence = null, actualizado = now() where user_id = v_uid;
  delete from public.agenda_canales a where a.user_id = v_uid
    and not exists (select 1 from public.canales c where c.user_id = v_uid and c.cal_token is not null);
  delete from public.contexto_whatsapp where user_id = v_uid;
  delete from public.propuestas_whatsapp where user_id = v_uid;
end $$;

revoke all on function public.publicar_contexto_whatsapp(jsonb) from public, anon;
revoke all on function public.propuestas_whatsapp_confirmadas() from public, anon;
revoke all on function public.quitar_propuestas_whatsapp(uuid[]) from public, anon;
revoke all on function public.quitar_whatsapp() from public, anon;
grant execute on function public.publicar_contexto_whatsapp(jsonb) to authenticated;
grant execute on function public.propuestas_whatsapp_confirmadas() to authenticated;
grant execute on function public.quitar_propuestas_whatsapp(uuid[]) to authenticated;
grant execute on function public.quitar_whatsapp() to authenticated;

-- ---------- Para lia-whatsapp (solo service_role) ----------

-- La cuenta de un número vinculado (null si no lo está).
create or replace function public.cuenta_whatsapp(p_numero text) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.user_id from public.canales c where c.wa_numero = p_numero and c.wa_verificado
$$;

-- Todo lo que lia-whatsapp necesita de un número en una sola llamada. null si no está vinculado.
-- pro: el plan vigente (como isPro() de la app); la IA vuelve a revisarlo con usar_ia_whatsapp().
create or replace function public.whatsapp_estado(p_numero text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.cuenta_whatsapp(p_numero); v jsonb;
begin
  if v_uid is null then return null; end if;
  delete from public.propuestas_whatsapp where user_id = v_uid and vence <= now();
  select jsonb_build_object(
    'avisos', (select c.wa_avisos from public.canales c where c.user_id = v_uid),
    'pro', exists (select 1 from public.suscripciones s where s.user_id = v_uid and s.plan = 'pro'
                   and (s.hasta > public.hoy_lima() or s.renovacion_automatica)),
    'contexto', (select x.contexto from public.contexto_whatsapp x where x.user_id = v_uid),
    'propuesta', (select jsonb_build_object('id', p.id, 'estado', p.estado, 'intencion', p.intencion, 'creado', p.creado)
                  from public.propuestas_whatsapp p where p.user_id = v_uid and p.estado in ('borrador', 'pendiente')
                  order by p.creado desc limit 1),
    'confirmadas', (select count(*) from public.propuestas_whatsapp p where p.user_id = v_uid and p.estado = 'confirmada')
  ) into v;
  return v;
end $$;

-- Guarda lo entendido. Un borrador o una propuesta nueva reemplaza al anterior sin confirmar (como en la app).
create or replace function public.guardar_propuesta_whatsapp(p_numero text, p_estado text, p_intencion jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.cuenta_whatsapp(p_numero); v_id uuid;
begin
  if v_uid is null then return null; end if;
  if p_estado not in ('borrador', 'pendiente') or p_intencion is null or jsonb_typeof(p_intencion) <> 'object' or length(p_intencion::text) > 8000 then
    raise exception 'propuesta_invalida' using errcode = '22023';
  end if;
  delete from public.propuestas_whatsapp where user_id = v_uid and estado in ('borrador', 'pendiente');
  insert into public.propuestas_whatsapp (user_id, estado, intencion, vence)
  values (v_uid, p_estado, p_intencion, now() + case when p_estado = 'borrador' then interval '10 minutes' else interval '30 minutes' end)
  returning id into v_id;
  return v_id;
end $$;

-- «sí»: la última propuesta pendiente (de menos de 30 minutos) pasa a confirmada y avisa a la app abierta.
-- Hasta 20 confirmadas esperando a la app; la más antigua sale si se pasa.
create or replace function public.confirmar_propuesta_whatsapp(p_numero text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.cuenta_whatsapp(p_numero); v_id uuid;
begin
  if v_uid is null then return false; end if;
  update public.propuestas_whatsapp set estado = 'confirmada', vence = now() + interval '14 days'
  where id = (select id from public.propuestas_whatsapp where user_id = v_uid and estado = 'pendiente' and vence > now() order by creado desc limit 1)
  returning id into v_id;
  if v_id is null then return false; end if;
  delete from public.propuestas_whatsapp where id in (
    select id from public.propuestas_whatsapp where user_id = v_uid and estado = 'confirmada' order by creado desc offset 20);
  insert into public.whatsapp_senal as s (user_id, n, actualizado) values (v_uid, 1, now())
  on conflict (user_id) do update set n = s.n + 1, actualizado = now();
  return true;
end $$;

-- «no»: se descarta lo que esperaba respuesta (borrador o pendiente).
create or replace function public.descartar_propuesta_whatsapp(p_numero text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.cuenta_whatsapp(p_numero);
begin
  if v_uid is null then return false; end if;
  delete from public.propuestas_whatsapp where user_id = v_uid and estado in ('borrador', 'pendiente');
  return found;
end $$;

-- El mismo cupo de la IA que el chat de la app: llama a usar_ia() con la cuenta del número como usuario, solo dentro
-- de esta transacción. Así el cupo sigue cambiando solo mediante usar_ia() (y con sus renovaciones y vencimientos).
create or replace function public.usar_ia_whatsapp(p_numero text, p_sumar boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.cuenta_whatsapp(p_numero);
begin
  if v_uid is null then return jsonb_build_object('permitido', false, 'motivo', 'sin_vincular', 'restantes_dia', 0, 'restantes_mes', 0); end if;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  return public.usar_ia(coalesce(p_sumar, false));
end $$;

-- ¿Es la primera vez que llega este mensaje? Guarda el hash de su id por 2 días.
create or replace function public.whatsapp_visto(p_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_hash is null or length(p_hash) <> 64 then return true; end if;
  delete from public.whatsapp_vistos where creado < now() - interval '2 days';
  insert into public.whatsapp_vistos (hash) values (p_hash) on conflict (hash) do nothing;
  return found;
end $$;

revoke all on function public.cuenta_whatsapp(text) from public, anon, authenticated;
revoke all on function public.whatsapp_estado(text) from public, anon, authenticated;
revoke all on function public.guardar_propuesta_whatsapp(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.confirmar_propuesta_whatsapp(text) from public, anon, authenticated;
revoke all on function public.descartar_propuesta_whatsapp(text) from public, anon, authenticated;
revoke all on function public.usar_ia_whatsapp(text, boolean) from public, anon, authenticated;
revoke all on function public.whatsapp_visto(text) from public, anon, authenticated;
grant execute on function public.cuenta_whatsapp(text) to service_role;
grant execute on function public.whatsapp_estado(text) to service_role;
grant execute on function public.guardar_propuesta_whatsapp(text, text, jsonb) to service_role;
grant execute on function public.confirmar_propuesta_whatsapp(text) to service_role;
grant execute on function public.descartar_propuesta_whatsapp(text) to service_role;
grant execute on function public.usar_ia_whatsapp(text, boolean) to service_role;
grant execute on function public.whatsapp_visto(text) to service_role;
