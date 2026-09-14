-- Fase 10 (Analytics + Scalability + Production QA, autorizado) — índices
-- compuestos e instrumentación mínima para soportar analytics multi-tenant
-- y corregir un hallazgo real de escalabilidad en el Inbox (F9).
--
-- Cero tablas nuevas: F10 reutiliza dulabs_mensajes_log, dulabs_flow_executions
-- y dulabs_flow_effects tal cual (ver auditoría F10-A). Este archivo solo
-- agrega índices y una función de lectura; no toca datos existentes.

-- ---------------------------------------------------------------------------
-- 1. Índice compuesto para "última fila por conversación"
-- ---------------------------------------------------------------------------
-- dulabs_mensajes_log solo tenía (phone_number_id, created_at desc). Para
-- resolver "el mensaje más reciente de CADA conversación de este número" de
-- forma indexada (DISTINCT ON, ver función más abajo) hace falta que
-- telefono_cliente también esté en el índice.
create index if not exists dulabs_mensajes_log_conversacion_idx
  on public.dulabs_mensajes_log (phone_number_id, telefono_cliente, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Índices para analytics de Flow/AI/Integraciones por rango de fecha
-- ---------------------------------------------------------------------------
-- Los índices existentes de dulabs_flow_executions (tenant_id+flow_id,
-- tenant_id+execution_id, etc.) sirven para el runtime del engine, pero
-- ninguno cubre "todas las ejecuciones de este tenant en un rango de fechas,
-- agrupadas por status" -- el patrón que necesita analytics/flows.
create index if not exists dulabs_flow_executions_tenant_status_fecha_idx
  on public.dulabs_flow_executions (tenant_id, status, created_at desc);

-- Mismo caso para efectos: analytics de IA e integraciones necesita
-- "efectos de este tenant, de este kind (ai/action/send_message), en un
-- rango de fechas" -- el índice existente (tenant_id, flow_execution_id,
-- status) no cubre ese acceso porque no incluye kind ni requested_at.
create index if not exists dulabs_flow_effects_tenant_kind_status_fecha_idx
  on public.dulabs_flow_effects (tenant_id, kind, status, requested_at desc);

-- ---------------------------------------------------------------------------
-- 3. Función: última fila por conversación (reemplaza el escaneo con .limit(500))
-- ---------------------------------------------------------------------------
-- Hallazgo F10-B (Scalability Audit): app/api/dashboard/conversaciones/route.ts
-- construía la lista de conversaciones tomando los 500 mensajes MÁS
-- RECIENTES de todo el tenant y deduplicando en memoria. Con tráfico alto y
-- distribuido de forma despareja (pocas conversaciones muy activas), ese
-- corte de 500 filas puede no incluir el último mensaje de conversaciones
-- reales pero menos activas -- desaparecerían del Inbox sin ningún error.
--
-- Esta función resuelve "el mensaje más reciente de cada conversación" con
-- DISTINCT ON dentro de Postgres (indexado por el índice de arriba), y solo
-- DESPUÉS ordena y limita el resultado ya deduplicado -- ninguna
-- conversación real puede desaparecer por el límite, sin importar cuántos
-- mensajes tenga cualquier otra conversación del mismo tenant.
--
-- SECURITY DEFINER no hace falta: se invoca siempre con el service-role key
-- desde el backend (mismo patrón que el resto de dulabs_dashboard/*, que
-- jamás depende de RLS porque usa el client admin) -- el filtrado por tenant
-- ya lo resuelve el caller pasando su propia lista de phone_number_id.
create or replace function public.dulabs_conversaciones_recientes(
  p_phone_number_ids text[],
  p_limite int default 200
)
returns table (
  phone_number_id text,
  telefono_cliente text,
  contenido text,
  direccion text,
  created_at timestamptz
)
language sql
stable
as $$
  select ultimos.phone_number_id, ultimos.telefono_cliente, ultimos.contenido, ultimos.direccion, ultimos.created_at
  from (
    select distinct on (m.phone_number_id, m.telefono_cliente)
      m.phone_number_id, m.telefono_cliente, m.contenido, m.direccion, m.created_at
    from public.dulabs_mensajes_log m
    where m.phone_number_id = any(p_phone_number_ids)
    order by m.phone_number_id, m.telefono_cliente, m.created_at desc
  ) ultimos
  order by ultimos.created_at desc
  limit greatest(p_limite, 0)
$$;

comment on function public.dulabs_conversaciones_recientes is
  'Fase 10 -- última fila de cada conversación (phone_number_id, telefono_cliente) para los números dados, ordenada por actividad reciente. Reemplaza el patrón "traer 500 mensajes y deduplicar en memoria" que podía perder conversaciones reales con tráfico alto y desparejo.';

-- SEGURIDAD (Fase 10, hallazgo de la propia auditoría) -- esta función NO
-- valida tenant/ownership de p_phone_number_ids: confía en que el caller
-- (siempre backend con service-role, ver lib/conversaciones-inbox.ts) ya
-- resolvió esa lista a partir del tenant de la sesión real. Postgres otorga
-- EXECUTE a PUBLIC por defecto en funciones nuevas -- sin este REVOKE
-- explícito, CUALQUIER usuario autenticado (o anónimo) podría invocar este
-- RPC vía PostgREST pasando el phone_number_id de OTRO tenant y leer sus
-- conversaciones. Mismo criterio que el resto de funciones RPC de este
-- proyecto (ver GRANT ... TO service_role en migraciones previas, ej.
-- 20260801090000_planes_agentes_campanas.sql) -- nunca queda expuesta por
-- default a authenticated/anon.
revoke all on function public.dulabs_conversaciones_recientes(text[], int) from public;
grant execute on function public.dulabs_conversaciones_recientes(text[], int) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Función: conversaciones "nuevas" en un rango de fechas
-- ---------------------------------------------------------------------------
-- "Nueva" = su PRIMER mensaje (de cualquier dirección) cae dentro del rango.
-- Usa el mismo índice compuesto que la función anterior, solo que ordenando
-- ascendente para quedarse con la primera fila de cada conversación en vez
-- de la última.
create or replace function public.dulabs_conversaciones_nuevas_contar(
  p_phone_number_ids text[],
  p_desde timestamptz,
  p_hasta timestamptz
)
returns bigint
language sql
stable
as $$
  select count(*)
  from (
    select distinct on (m.phone_number_id, m.telefono_cliente)
      m.created_at
    from public.dulabs_mensajes_log m
    where m.phone_number_id = any(p_phone_number_ids)
    order by m.phone_number_id, m.telefono_cliente, m.created_at asc
  ) primeros
  where primeros.created_at between p_desde and p_hasta
$$;

comment on function public.dulabs_conversaciones_nuevas_contar is
  'Fase 10 -- cuenta conversaciones cuyo primer mensaje (cualquier dirección) cae dentro de [p_desde, p_hasta], para los phone_number_id dados.';

-- Mismo motivo que el REVOKE/GRANT de dulabs_conversaciones_recientes de
-- arriba -- sin esto, cualquier authenticated/anon podría contar
-- conversaciones de un tenant ajeno pasando su phone_number_id.
revoke all on function public.dulabs_conversaciones_nuevas_contar(text[], timestamptz, timestamptz) from public;
grant execute on function public.dulabs_conversaciones_nuevas_contar(text[], timestamptz, timestamptz) to service_role;
