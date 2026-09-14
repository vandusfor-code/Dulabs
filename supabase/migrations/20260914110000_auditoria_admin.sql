-- FASE F15 (Operations Center, autorizado) -- registro genérico de acciones
-- administrativas del Panel de Operaciones. No existía ninguna tabla para
-- esto (la más cercana, dulabs_conversacion_eventos, está acotada a
-- eventos de conversación del Inbox, con un tipo restringido por check
-- constraint -- reusarla habría significado aflojar esa restricción para un
-- propósito distinto). Puramente aditiva.

create table if not exists public.dulabs_auditoria_admin (
  id bigint generated always as identity primary key,
  operador_user_id uuid references auth.users(id) on delete set null,
  operador_email text,
  accion text not null,
  id_tenant uuid,
  recurso text,
  resultado text not null default 'ok',
  motivo text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists dulabs_auditoria_admin_tenant_idx
  on public.dulabs_auditoria_admin (id_tenant, created_at desc);
create index if not exists dulabs_auditoria_admin_created_idx
  on public.dulabs_auditoria_admin (created_at desc);
create index if not exists dulabs_auditoria_admin_accion_idx
  on public.dulabs_auditoria_admin (accion);

alter table public.dulabs_auditoria_admin enable row level security;

comment on table public.dulabs_auditoria_admin is
  'Registro append-only de acciones administrativas ejecutadas desde el Panel de Operaciones (/admin). Nunca contiene secretos/tokens/contraseñas -- solo metadata segura (planes, estados, ids). Solo el service_role escribe/lee (RLS activo sin políticas, igual que el resto de tablas administrativas).';
comment on column public.dulabs_auditoria_admin.accion is
  'Constante en mayúsculas, ej. CREATE_CLIENT, PAUSE_BOT, RESUME_BOT, CHANGE_PLAN, ACTIVATE_SUBSCRIPTION, CANCEL_SUBSCRIPTION, DISCONNECT_WHATSAPP, CHANGE_ROLE, BLOCK_ACCOUNT, UNBLOCK_ACCOUNT.';
comment on column public.dulabs_auditoria_admin.resultado is
  'ok | error -- si la acción falló, motivo/metadata pueden traer el detalle del error (nunca un secreto).';

-- Estado (nueva/vista/resuelta) de las alertas de /admin/alertas. Las
-- alertas en sí NUNCA se almacenan -- se derivan en vivo de señales reales
-- (suscripción vencida, WhatsApp desconectado, bot pausado, etc., ver
-- lib/alertas-admin.ts). Esta tabla solo guarda el estado que el operador
-- le dio a una alerta identificada por una clave estable y determinística
-- (ej. "pago_vencido:<tenantId>"), para no perder ese seguimiento cada vez
-- que se recalculan las alertas.
create table if not exists public.dulabs_alertas_estado (
  clave text primary key,
  estado text not null default 'nueva' check (estado in ('nueva', 'vista', 'resuelta')),
  actualizado_por uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.dulabs_alertas_estado enable row level security;

comment on table public.dulabs_alertas_estado is
  'Estado operativo (nueva/vista/resuelta) de cada alerta derivada, identificada por una clave estable. Ver lib/alertas-admin.ts.';
