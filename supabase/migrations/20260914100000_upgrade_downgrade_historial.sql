-- FASE F14.2 (Billing / Monetización completa, autorizado) -- upgrade/downgrade
-- de plan no existía en ningún endpoint ni tabla. Esta migración es
-- puramente aditiva: una tabla nueva de historial y una columna nueva
-- (nullable) en dulabs_pagos. No toca ni borra ninguna fila existente.

-- Historial de cambios de plan por tenant. Responde "qué plan tenía este
-- cliente y cuándo cambió" (Fase 6) sin construir un sistema de auditoría
-- genérico -- solo lo que hace falta para trazabilidad comercial.
create table if not exists public.dulabs_historial_planes (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  plan_anterior text,
  plan_nuevo text not null,
  precio_anterior_cop integer,
  precio_nuevo_cop integer not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  motivo text,
  created_at timestamptz not null default now()
);

create index if not exists dulabs_historial_planes_tenant_idx
  on public.dulabs_historial_planes (id_tenant, created_at desc);

alter table public.dulabs_historial_planes enable row level security;

comment on table public.dulabs_historial_planes is
  'Historial de cambios de plan de un tenant (alta inicial, upgrade, downgrade). plan_anterior es null en el alta inicial. actor_user_id es quien ejecutó el cambio (null si lo hizo un proceso automático como el webhook de Wompi).';

-- Qué plan estaba vigente cuando se registró CADA pago -- sin esto, una vez
-- que existe upgrade/downgrade, el historial de dulabs_pagos ya no permite
-- reconstruir con certeza "a qué plan correspondió este cobro" si el tenant
-- cambió de plan después. Nullable y sin default: los pagos históricos
-- (anteriores a esta migración) quedan en null a propósito, nunca se
-- inventa un valor retroactivo.
alter table public.dulabs_pagos
  add column if not exists plan text;

comment on column public.dulabs_pagos.plan is
  'Plan vigente del tenant en el momento de este pago (copiado de dulabs_suscripciones.plan al insertar la fila). Null en pagos anteriores a esta columna -- no se puede reconstruir con certeza retroactivamente.';

-- Incremento atómico de mensajes_usados_mes -- hallazgo real: el código
-- anterior (lib/whatsapp-outbound.ts::incrementarUsoMensajes) leía el
-- contador, le sumaba 1 en JavaScript y lo volvía a escribir (leer-decidir-
-- escribir sin ninguna protección), así que dos mensajes salientes
-- concurrentes para el mismo número podían pisarse y perder un incremento --
-- el tenant terminaba usando más cupo real del que el contador reportaba.
-- Esta función hace el mismo cálculo (reinicia a 1 si mes_actual cambió)
-- pero DENTRO de un solo UPDATE atómico de Postgres.
create or replace function public.dulabs_incrementar_uso_mensajes(
  p_cliente_id bigint,
  p_mes_actual text
) returns void
language sql
security definer
set search_path = public
as $$
  update public.dulabs_clientes_config
  set mensajes_usados_mes = case when mes_actual = p_mes_actual then mensajes_usados_mes + 1 else 1 end,
      mes_actual = p_mes_actual
  where id = p_cliente_id;
$$;

revoke all on function public.dulabs_incrementar_uso_mensajes(bigint, text) from public;
grant execute on function public.dulabs_incrementar_uso_mensajes(bigint, text) to service_role;

comment on function public.dulabs_incrementar_uso_mensajes is
  'Incremento atómico de dulabs_clientes_config.mensajes_usados_mes (reinicia a 1 si mes_actual cambió). Reemplaza el patrón leer-decidir-escribir vulnerable a condición de carrera que tenía lib/whatsapp-outbound.ts::incrementarUsoMensajes antes de F14.2.';
