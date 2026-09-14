-- FASE F16.1 (Commercial Scale — Dunning, autorizado) — recuperación de
-- pagos fallidos y retención de suscripciones.
--
-- Hallazgo real que motiva esta fase (diagnóstico F16, cierre de F15): hoy,
-- cuando una renovación de Wompi es rechazada, tanto app/api/wompi/
-- cobro-mensual/route.ts como app/api/wompi/webhook/route.ts marcan la
-- suscripción como 'vencida' DE INMEDIATO (vía resolverEstadoPago(), ver
-- lib/wompi.ts) -- el cliente pierde el servicio en el acto (planDelTenant()
-- en lib/plan-limits.ts filtra por estado='activa', así que 'vencida' ya
-- implica SIN_PLAN, límite 0 en todo, sin necesidad de ningún gate nuevo) y
-- nunca recibe ninguna comunicación proactiva -- solo el operador lo ve en
-- /admin/alertas. Esta migración agrega el ESTADO necesario para un período
-- de gracia real: la suscripción permanece 'activa' mientras dura el ciclo
-- de dunning, y solo se vence al agotar la política de reintentos (ver
-- lib/dunning/*.ts). No se toca dulabs_suscripciones.estado acá -- lo sigue
-- escribiendo el mismo código de siempre (cobro-mensual/webhook), ahora
-- indirectamente a través de lib/dunning/dunning-domain.ts.

-- Un ciclo por tenant (igual que dulabs_suscripciones: una fila = el ciclo
-- de dunning VIGENTE o el último que hubo). Un ciclo nuevo se abre
-- reescribiendo la fila anterior (upsert on conflict), nunca se acumulan
-- filas históricas de ciclos acá -- el historial detallado vive en
-- dulabs_dunning_eventos (append-only, abajo).
create table if not exists public.dulabs_dunning_ciclos (
  id bigint generated always as identity primary key,
  id_tenant uuid not null unique,
  estado text not null default 'activo' check (estado in ('activo', 'recuperado', 'vencido_final')),
  intentos int not null default 1,
  motivo_ultimo_fallo text,
  primer_fallo_at timestamptz not null default now(),
  ultimo_intento_at timestamptz not null default now(),
  proximo_intento_at timestamptz,
  -- Reclamo atómico para el cron de reintentos (mismo principio que
  -- dulabs_reservar_suscripcion, ver 20260827090000_precio_negociado.sql):
  -- mientras reclamado_en no sea null, ningún otro proceso puede reclamar
  -- este ciclo -- dulabs_dunning_reclamar_reintento() es quien lo pone y
  -- quien lo limpia (ver función abajo). Un reclamo "atascado" (proceso que
  -- murió a mitad de un cobro) se libera solo tras 5 minutos -- ver el WHERE
  -- de la función, nunca requiere intervención manual.
  reclamado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dulabs_dunning_ciclos_proximo_intento_idx
  on public.dulabs_dunning_ciclos (proximo_intento_at)
  where estado = 'activo';

comment on table public.dulabs_dunning_ciclos is
  'F16.1 -- estado del ciclo de recuperación de pago VIGENTE de cada tenant (una fila por tenant, igual que dulabs_suscripciones). estado=activo mientras se reintenta con período de gracia (la suscripción sigue "activa" en dulabs_suscripciones); recuperado cuando un reintento aprueba; vencido_final cuando se agota la política (lib/dunning/politica.ts) y recién ahí se marca la suscripción como vencida.';

-- Historial append-only de TODO evento de dunning (sistema + manual). Es la
-- fuente para: (a) auditoría completa, (b) idempotencia de notificaciones
-- (un mismo tipo de notificación nunca se manda dos veces para el mismo
-- ciclo -- ver el índice único parcial abajo), (c) lo que ve el operador en
-- /admin/alertas.
create table if not exists public.dulabs_dunning_eventos (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  ciclo_id bigint references public.dulabs_dunning_ciclos (id) on delete set null,
  tipo text not null check (tipo in (
    'payment_failed',
    'dunning_started',
    'notification_payment_failed_sent',
    'notification_payment_failed_failed',
    'notification_reminder_sent',
    'notification_reminder_failed',
    'notification_expired_sent',
    'notification_expired_failed',
    'notification_recovered_sent',
    'notification_recovered_failed',
    'retry_scheduled',
    'retry_started',
    'retry_succeeded',
    'retry_failed',
    'subscription_recovered',
    'subscription_expired',
    'manual_retry',
    'manual_notification'
  )),
  -- Solo para eventos manual_* -- quién lo disparó desde /admin. Null en
  -- todos los eventos generados por el sistema (cron/webhook).
  actor_user_id uuid,
  -- Nunca tarjeta/CVV/secretos de Wompi -- solo campos de negocio (motivo de
  -- rechazo de Wompi, número de intento, id de transacción). Ver sección de
  -- seguridad del reporte F16.1: se audita explícitamente que este jsonb
  -- nunca reciba nada de eso.
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists dulabs_dunning_eventos_tenant_idx
  on public.dulabs_dunning_eventos (id_tenant, created_at desc);
create index if not exists dulabs_dunning_eventos_ciclo_idx
  on public.dulabs_dunning_eventos (ciclo_id);

-- Idempotencia real de notificaciones: cada tipo de notificación (rechazo /
-- recordatorio / vencimiento / recuperado) puede existir A LO SUMO una vez
-- por ciclo. Un índice único parcial (no una comprobación en la app) es lo
-- que hace esto seguro bajo concurrencia real -- dos webhooks/crons
-- disparando el mismo evento casi al mismo tiempo chocan acá, no en una
-- carrera de "leer-decidir-escribir" en el código.
create unique index if not exists dulabs_dunning_eventos_notificacion_unica
  on public.dulabs_dunning_eventos (ciclo_id, tipo)
  where tipo in (
    'notification_payment_failed_sent',
    'notification_reminder_sent',
    'notification_expired_sent',
    'notification_recovered_sent',
    'dunning_started',
    'subscription_recovered',
    'subscription_expired'
  );

comment on table public.dulabs_dunning_eventos is
  'F16.1 -- historial append-only de eventos de dunning (payment_failed, notificaciones, reintentos, recuperación/vencimiento, acciones manuales de admin). El índice único parcial dulabs_dunning_eventos_notificacion_unica es la garantía real de "nunca se manda una notificación duplicada", no una comprobación de aplicación.';

-- Reclamo atómico de UN ciclo vencido para reintento (mismo principio que
-- dulabs_reservar_suscripcion): UPDATE...WHERE...RETURNING en una sola
-- sentencia. Devuelve 0 filas si el ciclo no existe, no está activo, no le
-- toca todavía, o ya lo tiene reclamado otro proceso -- el caller debe
-- abortar sin cobrar en ese caso, exactamente igual que con la reserva de
-- suscripción.
-- p_ignorar_horario permite el reintento MANUAL (cliente desde
-- /dashboard/cuenta, o admin desde /admin) sin esperar a proximo_intento_at
-- -- el pedido de negocio es explícito: "DÍA 1-2: permitir recuperación
-- manual desde checkout/pago", antes de que le toque al primer reintento
-- automático (día 3). La protección real contra doble cobro sigue siendo
-- el reclamo atómico en sí (UPDATE...WHERE...RETURNING) y la ventana de 5
-- minutos, NO el horario -- por eso es seguro saltárselo acá.
create or replace function public.dulabs_dunning_reclamar_reintento(
  p_tenant uuid,
  p_ignorar_horario boolean default false
) returns table (id bigint, intentos int, motivo_ultimo_fallo text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.dulabs_dunning_ciclos as c
  set reclamado_en = now()
  where c.id_tenant = p_tenant
    and c.estado = 'activo'
    and (p_ignorar_horario or (c.proximo_intento_at is not null and c.proximo_intento_at <= now()))
    and (c.reclamado_en is null or c.reclamado_en < now() - interval '5 minutes')
  returning c.id, c.intentos, c.motivo_ultimo_fallo;
end;
$$;

comment on function public.dulabs_dunning_reclamar_reintento is
  'F16.1 -- reclama atómicamente el ciclo de dunning vigente de un tenant para reintentar el cobro. Devuelve 0 filas si no hay ciclo activo, todavía no toca reintentar (salvo p_ignorar_horario=true, camino manual), o ya está reclamado por otro proceso (protección real contra doble cobro bajo ejecución concurrente). El caller es responsable de liberar el reclamo (reclamado_en = null) al terminar, éxito o error.';

revoke all on function public.dulabs_dunning_reclamar_reintento(uuid, boolean) from public;
grant execute on function public.dulabs_dunning_reclamar_reintento(uuid, boolean) to service_role;

alter table public.dulabs_dunning_ciclos enable row level security;
alter table public.dulabs_dunning_eventos enable row level security;
-- Sin policies para authenticated/anon a propósito -- mismo criterio que
-- dulabs_auditoria_admin y dulabs_flow_credentials: uso exclusivo de
-- service_role, nunca leído directo por el cliente (siempre a través de
-- /api/dashboard/admin/* o /api/dashboard/suscripcion/*, ya autenticados).
