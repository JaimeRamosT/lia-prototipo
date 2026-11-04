-- Métricas: noches con estudio y amanecidas, y un resumen agregado para el tablero (docs/metricas.md).
-- Dos eventos nuevos, uno por noche como mucho: «estudio» (esa noche se estudió) y «madrugada» (se estudió después de
-- medianoche). Siguen sin cursos, horas, mensajes, nombre ni correo. metricas_resumen() solo devuelve totales.
-- Se puede aplicar dos veces sin error.

alter table public.eventos_uso drop constraint if exists eventos_uso_evento_check;
alter table public.eventos_uso add constraint eventos_uso_evento_check check (evento in ('instalacion', 'registro', 'abre', 'estudio', 'madrugada'));

create or replace function public.registrar_evento(p_instalacion uuid, p_evento text, p_dia date, p_plataforma text default 'otro', p_instalada boolean default false, p_pro boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  if p_instalacion is null or p_evento not in ('instalacion', 'registro', 'abre', 'estudio', 'madrugada') or p_dia is null or p_dia not between v_hoy - 1 and v_hoy + 1 then
    raise exception 'evento_invalido' using errcode = '22023';
  end if;
  if (select count(*) from public.eventos_uso where creado > now() - interval '1 hour') >= 5000 then
    raise exception 'ocupado' using errcode = 'P0001';
  end if;
  insert into public.eventos_uso (instalacion, evento, dia, plataforma, instalada, pro)
  values (p_instalacion, p_evento, p_dia, case when p_plataforma in ('ios', 'android') then p_plataforma else 'otro' end, coalesce(p_instalada, false), coalesce(p_pro, false))
  on conflict (instalacion, evento, dia) do nothing;
  return true;
end;
$$;

-- Totales de los últimos p_dias (1 a 90): instalaciones, registro completo, regreso al día 1 y al día 3 (solo de las
-- instalaciones que ya tuvieron ese día) y noches con estudio y con amanecida. Nada por persona.
create or replace function public.metricas_resumen(p_dias integer default 14)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with p as (select (now() at time zone 'America/Lima')::date as hoy, least(greatest(coalesce(p_dias, 14), 1), 90) as dias),
  cohorte as (
    select e.instalacion, e.dia as dia0 from public.eventos_uso e, p where e.evento = 'instalacion' and e.dia > p.hoy - p.dias
  ),
  marcas as (
    select c.instalacion, c.dia0,
      exists (select 1 from public.eventos_uso r where r.instalacion = c.instalacion and r.evento = 'registro') as registro,
      exists (select 1 from public.eventos_uso a where a.instalacion = c.instalacion and a.evento = 'abre' and a.dia = c.dia0 + 1) as d1,
      exists (select 1 from public.eventos_uso a where a.instalacion = c.instalacion and a.evento = 'abre' and a.dia = c.dia0 + 3) as d3
    from cohorte c
  )
  select jsonb_build_object(
    'dias', (select dias from p),
    'hasta', (select hoy from p),
    'instalaciones', (select count(*) from marcas),
    'registros', (select count(*) from marcas where registro),
    'base_d1', (select count(*) from marcas, p where dia0 <= p.hoy - 1),
    'volvieron_d1', (select count(*) from marcas, p where dia0 <= p.hoy - 1 and d1),
    'base_d3', (select count(*) from marcas, p where dia0 <= p.hoy - 3),
    'volvieron_d3', (select count(*) from marcas, p where dia0 <= p.hoy - 3 and d3),
    'noches_estudio', (select count(*) from public.eventos_uso e, p where e.evento = 'estudio' and e.dia > p.hoy - p.dias),
    'noches_madrugada', (select count(*) from public.eventos_uso e, p where e.evento = 'madrugada' and e.dia > p.hoy - p.dias),
    'abren_por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', d, 'n', n) order by d), '[]'::jsonb)
                      from (select e.dia as d, count(distinct e.instalacion) as n from public.eventos_uso e, p
                            where e.evento = 'abre' and e.dia > p.hoy - p.dias group by e.dia) x)
  );
$$;

revoke all on function public.metricas_resumen(integer) from public;
grant execute on function public.metricas_resumen(integer) to anon, authenticated;
