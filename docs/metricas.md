# LIA · Métricas de uso

1 de noviembre de 2026. Responde dos preguntas del plan del 31-oct: ¿cuántas personas terminan el registro? ¿Cuántas vuelven al día 1 y al día 3?

## Qué se guarda

Una fila por evento en `eventos_uso`, sin nada que identifique a la persona:

| Campo | Qué es |
| --- | --- |
| `instalacion` | Un identificador al azar que crea la app la primera vez (`lia.instalacion` en el teléfono). «Borrar todo» lo borra. |
| `evento` | `instalacion` (primera vez que abre), `registro` (terminó o saltó el registro) o `abre` (una vez por día). |
| `dia` | La fecha del teléfono. El servidor solo acepta de ayer a mañana, según la hora de Lima. |
| `plataforma` | `ios`, `android` u `otro`. |
| `instalada` | Si la abrió como app instalada. |
| `pro` | Si tenía LIA Pro. |

No se envían horarios, cursos, mensajes, nombre ni correo. La app solo puede agregar filas con `registrar_evento()`; nadie las lee desde la app. Se consultan en el editor SQL de Supabase.

La persona lo puede apagar en Perfil → «Ayudar a mejorar LIA». En `localhost` no se envía nada; para probar, guarda `lia.metricas = 'forzar'` en el navegador.

## Consultas

Registro completo (de las instalaciones de los últimos 14 días):

```sql
select count(*) filter (where e.evento = 'instalacion') as instalaciones,
       count(*) filter (where e.evento = 'registro') as registros,
       round(100.0 * count(*) filter (where e.evento = 'registro') / nullif(count(*) filter (where e.evento = 'instalacion'), 0), 1) as pct
from public.eventos_uso e
where e.instalacion in (select instalacion from public.eventos_uso where evento = 'instalacion' and dia >= current_date - 14);
```

Regreso al día 1 y al día 3 (por día de instalación):

```sql
with cohorte as (
  select instalacion, dia as dia0 from public.eventos_uso where evento = 'instalacion'
)
select c.dia0,
       count(*) as instalaciones,
       count(*) filter (where exists (select 1 from public.eventos_uso a where a.instalacion = c.instalacion and a.evento = 'abre' and a.dia = c.dia0 + 1)) as volvio_d1,
       count(*) filter (where exists (select 1 from public.eventos_uso a where a.instalacion = c.instalacion and a.evento = 'abre' and a.dia = c.dia0 + 3)) as volvio_d3
from cohorte c
group by c.dia0
order by c.dia0 desc;
```

El día 3 de una cohorte solo cuenta cuando ya pasaron tres días: las cohortes más recientes salen en cero.

## Límites

- Una persona que borra los datos del navegador, o que usa la app en el navegador y además instalada, cuenta como dos instalaciones.
- En iPhone, la app instalada tiene su propio almacenamiento: abrirla instalada después de usarla en Safari crea otra instalación.
- Los eventos se pierden si el teléfono no tiene internet en ese momento; se vuelven a intentar la siguiente vez que abre.
