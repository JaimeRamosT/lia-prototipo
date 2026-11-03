-- Vincular WhatsApp recibiendo el código (2-nov-2026, pedido de Coconut): la persona escribe su número en LIA, la
-- función lia-whatsapp le envía el código con una plantilla de autenticación y la persona lo escribe en la app.
-- El código enviado así nunca se muestra en la app (si se mostrara, cualquiera podría vincular un número ajeno).
-- Si no hay plantilla o Meta no lo envía, sigue el camino anterior: la app muestra el código y la persona lo envía.
-- Hasta 5 intentos por código y un código nuevo cada 60 segundos. Se puede aplicar dos veces.

alter table public.canales add column if not exists wa_metodo text not null default 'enviar' check (wa_metodo in ('enviar', 'recibir'));
alter table public.canales add column if not exists wa_intentos integer not null default 0;
alter table public.canales add column if not exists wa_codigo_pedido timestamptz;

-- El código solo se muestra si la persona debe enviarlo ella (camino anterior). Con el código recibido, «esperando».
create or replace function public.canales_estado() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'calendario', c.cal_token,
    'whatsapp', case when c.wa_numero is null then null else jsonb_build_object(
      'numero', c.wa_numero, 'verificado', c.wa_verificado, 'avisos', c.wa_avisos,
      'codigo', case when not c.wa_verificado and c.wa_metodo = 'enviar' and c.wa_codigo_vence > now() then c.wa_codigo end,
      'esperando', not c.wa_verificado and c.wa_metodo = 'recibir' and c.wa_codigo_vence > now() and c.wa_intentos < 5) end)
  from (select auth.uid() as uid) u left join public.canales c on c.user_id = u.uid
  where u.uid is not null
$$;

-- Pide un código (válido 15 minutos, uno cada 60 segundos). Empieza en el camino anterior; lia-whatsapp lo cambia a
-- «recibir» solo si logró enviarlo.
create or replace function public.pedir_codigo_whatsapp(p_numero text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_num text := regexp_replace(coalesce(p_numero, ''), '[^0-9]', '', 'g'); v_codigo text;
begin
  if v_uid is null then raise exception 'sesion' using errcode = '42501'; end if;
  if length(v_num) = 9 and left(v_num, 1) = '9' then v_num := '51' || v_num; end if;  -- celular peruano sin código de país
  if v_num !~ '^[0-9]{8,15}$' then raise exception 'numero_invalido' using errcode = '22023'; end if;
  if exists (select 1 from public.canales where user_id = v_uid and wa_codigo_pedido > now() - interval '60 seconds') then
    raise exception 'espera' using errcode = '22023';
  end if;
  if exists (select 1 from public.canales where wa_numero = v_num and wa_verificado and user_id <> v_uid) then
    raise exception 'numero_ocupado' using errcode = '23505';
  end if;
  update public.canales set wa_numero = null, wa_codigo = null where wa_numero = v_num and user_id <> v_uid;
  v_codigo := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into public.canales (user_id, wa_numero, wa_verificado, wa_codigo, wa_codigo_vence, wa_metodo, wa_intentos, wa_codigo_pedido)
    values (v_uid, v_num, false, v_codigo, now() + interval '15 minutes', 'enviar', 0, now())
    on conflict (user_id) do update set wa_numero = excluded.wa_numero, wa_verificado = false,
      wa_codigo = excluded.wa_codigo, wa_codigo_vence = excluded.wa_codigo_vence, wa_metodo = 'enviar',
      wa_intentos = 0, wa_codigo_pedido = now(), actualizado = now();
  return v_codigo;
end $$;

-- La persona escribe en la app el código que recibió por WhatsApp. Hasta 5 intentos por código.
create or replace function public.confirmar_codigo_whatsapp(p_codigo text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_ok boolean;
begin
  if v_uid is null then raise exception 'sesion' using errcode = '42501'; end if;
  update public.canales set wa_verificado = true, wa_codigo = null, wa_codigo_vence = null, wa_intentos = 0, actualizado = now()
    where user_id = v_uid and not wa_verificado and wa_metodo = 'recibir' and wa_codigo_vence > now()
      and wa_intentos < 5 and wa_codigo = btrim(coalesce(p_codigo, ''))
    returning true into v_ok;
  if v_ok then return true; end if;
  update public.canales set wa_intentos = wa_intentos + 1 where user_id = v_uid and not wa_verificado and wa_metodo = 'recibir';
  return false;
end $$;

-- lia-whatsapp marca que el código salió por WhatsApp: desde ahí la app ya no lo muestra.
create or replace function public.codigo_whatsapp_enviado(p_numero text) returns void
language sql security definer set search_path = '' as $$
  update public.canales set wa_metodo = 'recibir' where wa_numero = p_numero and not wa_verificado and wa_codigo_vence > now()
$$;

revoke all on function public.confirmar_codigo_whatsapp(text) from public, anon;
grant execute on function public.confirmar_codigo_whatsapp(text) to authenticated;
revoke all on function public.codigo_whatsapp_enviado(text) from public, anon, authenticated;
grant execute on function public.codigo_whatsapp_enviado(text) to service_role;
