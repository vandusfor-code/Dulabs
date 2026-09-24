-- DuLabs — Bloque 17: el diagnóstico del agente muestra la INTENCIÓN y el MOTIVO de la asesora.
--
-- 100 % ADITIVO sobre datos: no crea tablas ni toca filas. Solo reemplaza la función de
-- diagnóstico del Bloque 13 (20261113000000_dulabs_agente_trazas.sql, requerida) con tres
-- columnas nuevas. Cambiar las columnas de salida exige drop + create (Postgres no deja
-- "create or replace" con otro tipo de retorno); ambos van en la misma transacción.
--
-- Desde el Bloque 16 cada turno guarda en la traza:
--   traza.intent   = search | more_results | similar | product_detail | cart | order |
--                    confirm_order | photos | handoff | catalog_link | conversation (o null)
--   traza.handoff  = {source: customer | model | system, motive: <lista cerrada>} (o null)
-- Aquí se traducen a códigos en español de una LISTA CERRADA (misma que
-- lib/agente/atencion-humana.ts: INTENCIONES y MOTIVOS_ASESORA; una prueba compara ambas).
-- Un valor fuera de la lista se muestra como 'desconocida' / 'sin_detalle', nunca tal cual.
--
--   dulabs_agente_diagnosticar(negocio, teléfono opcional, límite)
--     … columnas del Bloque 13 … + intencion, asesora_motivo, asesora_origen
--
-- Sin datos personales: el teléfono se convierte en el mismo hash del backend y no se guarda
-- ni se devuelve; la traza no tiene teléfono, texto del cliente, tokens ni secretos. Solo
-- service_role puede ejecutarla, y siempre para UN negocio (p_tenant; null => nada).
--
-- Rollback: volver a correr la función de 20261113000000_dulabs_agente_trazas.sql
--   (drop function public.dulabs_agente_diagnosticar(uuid, text, integer); y su create).
--
-- Se aplica manualmente en el SQL Editor de Supabase (ver PENDING_MIGRATIONS.md). Sin esta
-- migración nada se rompe: la intención y el motivo siguen en la columna `traza`.

begin;

drop function if exists public.dulabs_agente_diagnosticar(uuid, text, integer);

create function public.dulabs_agente_diagnosticar(p_tenant uuid, p_telefono text default null, p_limite integer default 30)
returns table (
  creado timestamptz,
  tipo text,
  resultado text,
  intencion text,
  asesora_motivo text,
  asesora_origen text,
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
         -- intenciones (lista cerrada)
         case when t.traza ->> 'intent' is null then null else case t.traza ->> 'intent'
           when 'search' then 'buscar'
           when 'more_results' then 'ver_mas'
           when 'similar' then 'similares'
           when 'product_detail' then 'detalle'
           when 'cart' then 'carrito'
           when 'order' then 'pedido'
           when 'confirm_order' then 'confirmar'
           when 'photos' then 'fotos'
           when 'handoff' then 'asesora'
           when 'catalog_link' then 'link_catalogo'
           when 'conversation' then 'conversacion'
           else 'desconocida'
         end end,
         -- motivos (lista cerrada)
         case
           when t.traza -> 'handoff' is null or jsonb_typeof(t.traza -> 'handoff') <> 'object' then
             case when t.resultado = 'handoff' and t.tipo = 'turn' then 'sin_detalle' end
           else case t.traza #>> '{handoff,motive}'
             when 'customer_request' then 'cliente_pidio_asesora'
             when 'order_issue' then 'problema_pedido'
             when 'payment_or_delivery' then 'pago_o_entrega'
             when 'complaint' then 'reclamo'
             when 'out_of_scope' then 'fuera_de_alcance'
             when 'other' then 'otro'
             when 'repeated_failures' then 'fallas_del_asistente'
             when 'limit_contact_day' then 'limite_uso_cliente'
             when 'limit_tenant_tokens_day' then 'limite_uso_negocio'
             else 'sin_detalle'
           end
         end,
         case t.traza #>> '{handoff,source}'
           when 'customer' then 'cliente'
           when 'model' then 'asistente'
           when 'system' then 'sistema'
           else case when t.resultado = 'handoff' and t.tipo = 'turn' then 'asistente' end
         end,
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

comment on function public.dulabs_agente_diagnosticar(uuid, text, integer) is
  'Bloques 13 y 17 — diagnóstico de UN negocio (y opcionalmente una conversación por teléfono -> hash): intención, motivo de la asesora, herramientas, entrega real de Meta. Sin datos personales. Solo service_role.';

revoke all on function public.dulabs_agente_diagnosticar(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.dulabs_agente_diagnosticar(uuid, text, integer) to service_role;

commit;
