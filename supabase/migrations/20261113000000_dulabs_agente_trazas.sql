-- DuLabs — Bloque 13: trazas persistentes del agente y diagnóstico por conversación.
--
-- 100 % ADITIVO. Sin esta migración el agente funciona igual (las trazas solo van a los
-- logs de Vercel, que se borran pronto).
--
--   dulabs_agente_trazas         una fila por turno del agente (y por error de su frontera):
--                                qué entró (wamids, cantidad, largo — nunca el texto), el contexto
--                                (canal, etapa, carrito, opciones abiertas), cada herramienta con su
--                                resultado, la respuesta (anclaje, reintentos, uso de tokens) y la
--                                entrega (wamid del texto y de cada foto, errores de Meta).
--                                NUNCA: teléfono (solo contact_ref, un hash corto), texto del cliente,
--                                tokens, API keys ni secretos.
--   dulabs_agente_diagnosticar   por negocio (y opcionalmente por teléfono, que se convierte en el
--                                MISMO hash sin guardarse): cada turno con el estado REAL de entrega
--                                de Meta (enviado / entregado / leído / fallido + código de error)
--                                del texto y de cada foto, leído de dulabs_mensajes_log.
--   dulabs_agente_trazas_purgar  borra trazas más viejas que N días (por defecto 90).
--
-- Uso (SQL Editor):
--   select * from dulabs_agente_diagnosticar('<id_tenant>', '573001112233', 20);
--   select dulabs_agente_trazas_purgar(90);
--
-- Rollback:
--   drop function if exists public.dulabs_agente_trazas_purgar(integer);
--   drop function if exists public.dulabs_agente_diagnosticar(uuid, text, integer);
--   drop table if exists public.dulabs_agente_trazas;
--
-- Se aplica manualmente en el SQL Editor de Supabase (ver PENDING_MIGRATIONS.md).

begin;

create table if not exists public.dulabs_agente_trazas (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  id_tenant uuid not null,
  phone_number_id text not null check (char_length(phone_number_id) between 1 and 64),
  -- Hash corto del wa_id (lib/catalogo/pedidos/log.ts contactRef): correlaciona sin el teléfono.
  contact_ref text not null check (contact_ref ~ '^[0-9a-f]{12}$'),
  tipo text not null check (tipo in ('turn', 'boundary')),
  wamid text check (wamid is null or char_length(wamid) <= 200),
  resultado text not null check (char_length(resultado) between 1 and 40),
  traza jsonb not null check (jsonb_typeof(traza) = 'object' and pg_column_size(traza) <= 32768)
);

create index if not exists dulabs_agente_trazas_tenant_idx on public.dulabs_agente_trazas (id_tenant, created_at desc);
create index if not exists dulabs_agente_trazas_conversacion_idx on public.dulabs_agente_trazas (phone_number_id, contact_ref, created_at desc);

comment on table public.dulabs_agente_trazas is
  'Bloque 13 — trazas del agente sin datos personales (contact_ref = hash del wa_id; nunca teléfono, texto, tokens ni secretos). Diagnóstico: dulabs_agente_diagnosticar. Solo service_role.';

alter table public.dulabs_agente_trazas enable row level security;
revoke all on table public.dulabs_agente_trazas from anon, authenticated;

create or replace function public.dulabs_agente_diagnosticar(p_tenant uuid, p_telefono text default null, p_limite integer default 30)
returns table (
  creado timestamptz,
  tipo text,
  resultado text,
  etapa text,
  herramientas text,
  respuesta_enviada boolean,
  entrega_texto text,
  error_texto text,
  fotos jsonb,
  error text,
  pedido text,
  wamid text,
  traza jsonb
)
language sql
stable
set search_path = public, pg_temp
as $$
  with ref as (
    -- El teléfono se convierte en el MISMO hash que usa el backend; nunca se guarda.
    select case when p_telefono is null then null
                else left(encode(sha256(convert_to('dulabs:contact:' || regexp_replace(p_telefono, '\D', '', 'g'), 'UTF8')), 'hex'), 12) end as contact_ref
  )
  select t.created_at,
         t.tipo,
         t.resultado,
         coalesce(t.traza #>> '{stage,start}', '') || case when t.traza #>> '{stage,end}' is not null then ' -> ' || (t.traza #>> '{stage,end}') else '' end,
         (select string_agg((c ->> 'name') || ':' || (c ->> 'result'), ', ') from jsonb_array_elements(coalesce(t.traza -> 'tool_calls', '[]'::jsonb)) c),
         (t.traza ->> 'sent')::boolean,
         mt.estado_entrega,
         case when mt.error_codigo is not null then mt.error_codigo::text || ' ' || coalesce(mt.error_detalle, '') else t.traza #>> '{delivery,text_error}' end,
         (select jsonb_agg(jsonb_build_object(
                    'referencia', i ->> 'reference',
                    'registrada', (i ->> 'recorded')::boolean,
                    'estado', mi.estado_entrega,
                    'error', coalesce(mi.error_codigo::text || ' ' || coalesce(mi.error_detalle, ''), i ->> 'error')))
            from jsonb_array_elements(coalesce(t.traza #> '{delivery,images}', '[]'::jsonb)) i
            left join public.dulabs_mensajes_log mi on mi.wamid = i ->> 'wamid'),
         coalesce(t.traza ->> 'error_kind', t.traza ->> 'reason'),
         t.traza ->> 'order_id',
         t.wamid,
         t.traza
    from public.dulabs_agente_trazas t
    cross join ref
    left join public.dulabs_mensajes_log mt on mt.wamid = t.traza #>> '{delivery,text_wamid}'
   where t.id_tenant = p_tenant
     and (ref.contact_ref is null or t.contact_ref = ref.contact_ref)
   order by t.created_at desc
   limit least(greatest(coalesce(p_limite, 30), 1), 500)
$$;

create or replace function public.dulabs_agente_trazas_purgar(p_dias integer default 90)
returns bigint
language sql
volatile
set search_path = public, pg_temp
as $$
  with borradas as (
    delete from public.dulabs_agente_trazas where created_at < now() - make_interval(days => greatest(coalesce(p_dias, 90), 7)) returning 1
  )
  select count(*) from borradas
$$;

revoke all on function public.dulabs_agente_diagnosticar(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.dulabs_agente_trazas_purgar(integer) from public, anon, authenticated;
grant execute on function public.dulabs_agente_diagnosticar(uuid, text, integer) to service_role;
grant execute on function public.dulabs_agente_trazas_purgar(integer) to service_role;

commit;
