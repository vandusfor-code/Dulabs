-- DuLabs Developer V1 -- Fase 2 (Data Model + Security, autorizado).
-- Migración puramente aditiva, aislada del esquema de Business. Ninguna
-- tabla existente se modifica ni se borra.
--
-- Decisión de la Fase 1, confirmada y ahora probada a nivel de RLS: NO se
-- crea una tabla "workspaces" nueva. Un workspace de Developer ES un tenant
-- de DuLabs (dulabs_miembros_equipo / auth.users), exactamente el mismo
-- modelo que ya usa Business -- workspace_id en todas las tablas de abajo
-- ES id_tenant/tenant_id en el resto del sistema.
--
-- RLS: se reutiliza public.dulabs_tenant_del_usuario() (ya existe, ver
-- 20260718090300_rls_tenant_por_membresia.sql) -- resuelve el tenant del
-- usuario autenticado vía membresía ACTIVA, no se reinventa. Mismo
-- criterio que el resto del repo: RLS habilitado, política de SELECT para
-- `authenticated` filtrando por ese tenant, SIN políticas de INSERT/
-- UPDATE/DELETE (esas mutaciones son responsabilidad exclusiva del backend
-- con service_role, que bypassea RLS por diseño de Supabase -- ver sección
-- de "capas de seguridad" en el documento de arquitectura de Fase 2 para
-- la explicación completa de por qué esto SÍ es defensa en profundidad
-- real y no un teatro de seguridad).

-- ============================================================
-- 1. API KEYS
-- ============================================================
create table if not exists public.dulabs_dev_api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  key_hash text not null,
  prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- Único GLOBAL (no compuesto con workspace_id): una request entrante trae
-- SOLO la API key, todavía no sabe a qué workspace pertenece -- resolver
-- "¿qué workspace es este hash?" es justo lo que este índice permite en
-- O(1). Que sea único también garantiza, como efecto estructural, que
-- jamás pueda existir la misma key en dos workspaces (satisface el pedido
-- de unique(workspace_id, key_hash) de forma más estricta, no más floja).
create unique index if not exists dulabs_dev_api_keys_hash_idx
  on public.dulabs_dev_api_keys (key_hash);

create index if not exists dulabs_dev_api_keys_workspace_idx
  on public.dulabs_dev_api_keys (workspace_id) where revoked_at is null;

alter table public.dulabs_dev_api_keys enable row level security;

drop policy if exists tenant_select on public.dulabs_dev_api_keys;
create policy tenant_select on public.dulabs_dev_api_keys
  for select to authenticated
  using (workspace_id = public.dulabs_tenant_del_usuario());

comment on table public.dulabs_dev_api_keys is
  'DuLabs Developer V1 (Fase 2). key_hash es SHA-256 de la key completa -- el valor en claro NUNCA se persiste, es estructuralmente irrecuperable desde esta tabla. revoked_at no nulo = key inválida (no se borra la fila, necesaria para auditoría).';

-- ============================================================
-- 2. WHATSAPP NUMBERS
-- ============================================================
create table if not exists public.dulabs_dev_whatsapp_numbers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  phone_number_id text not null,
  whatsapp_business_account_id text,
  display_name text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'conectado', 'desconectado', 'error')),
  -- Token de Meta cifrado con lib/developer/secure-crypto.ts (prefijo
  -- "dev1:", fail-closed) -- NUNCA en texto plano. Nulo mientras el número
  -- está en 'pendiente' (todavía no completó el Embedded Signup).
  meta_token_cifrado text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un phone_number_id de Meta es único EN TODO META, no solo en DuLabs --
-- estructuralmente no puede pertenecer a dos workspaces a la vez. Este
-- constraint es lo que hace IMPOSIBLE (a nivel de base de datos, no solo
-- de "el código revisa antes de insertar") que un workspace malicioso
-- reclame un número que ya conectó otro workspace.
create unique index if not exists dulabs_dev_whatsapp_numbers_phone_idx
  on public.dulabs_dev_whatsapp_numbers (phone_number_id);

create index if not exists dulabs_dev_whatsapp_numbers_workspace_idx
  on public.dulabs_dev_whatsapp_numbers (workspace_id);

alter table public.dulabs_dev_whatsapp_numbers enable row level security;

drop policy if exists tenant_select on public.dulabs_dev_whatsapp_numbers;
create policy tenant_select on public.dulabs_dev_whatsapp_numbers
  for select to authenticated
  using (workspace_id = public.dulabs_tenant_del_usuario());

comment on table public.dulabs_dev_whatsapp_numbers is
  'DuLabs Developer V1 (Fase 2). Números de WhatsApp de los CLIENTES de un desarrollador, conectados vía Meta Embedded Signup (mismo flujo real que ya usa Business, ver app/api/auth/meta-callback/route.ts -- Fase 4 lo reusará, no lo duplicará).';

-- ============================================================
-- 3. WEBHOOK CONFIGURATIONS
-- ============================================================
create table if not exists public.dulabs_dev_webhook_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  whatsapp_number_id uuid not null references public.dulabs_dev_whatsapp_numbers (id) on delete cascade,
  url text not null,
  -- Secreto HMAC cifrado con secure-crypto -- ver lib/developer/webhook-signature.ts.
  secret_cifrado text not null,
  estado text not null default 'activo' check (estado in ('activo', 'pausado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rotated_at timestamptz
);

-- "Un webhook por número" (sección 8 del brief de Fase 1) -- estructural,
-- no una regla que el código deba recordar aplicar.
create unique index if not exists dulabs_dev_webhook_configs_number_idx
  on public.dulabs_dev_webhook_configs (whatsapp_number_id);

create index if not exists dulabs_dev_webhook_configs_workspace_idx
  on public.dulabs_dev_webhook_configs (workspace_id);

alter table public.dulabs_dev_webhook_configs enable row level security;

drop policy if exists tenant_select on public.dulabs_dev_webhook_configs;
create policy tenant_select on public.dulabs_dev_webhook_configs
  for select to authenticated
  using (workspace_id = public.dulabs_tenant_del_usuario());

comment on table public.dulabs_dev_webhook_configs is
  'DuLabs Developer V1 (Fase 2). La URL se valida con lib/developer/ssrf-guard.ts ANTES de insertar/actualizar (aplicación, no la DB -- Postgres no puede resolver DNS por su cuenta). El secreto se cifra con secure-crypto, nunca en claro.';

-- ============================================================
-- 4. JOBS (respaldo persistente de lib/developer/outbound-state-machine.ts)
-- ============================================================
create table if not exists public.dulabs_dev_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  whatsapp_number_id uuid not null references public.dulabs_dev_whatsapp_numbers (id),
  status text not null default 'created'
    check (status in ('created', 'queued', 'sending', 'success_confirmed', 'failed_by_meta', 'retry_pending', 'reconciliation_pending')),
  physical_outcome text not null default 'pre_send'
    check (physical_outcome in ('pre_send', 'uncertain', 'success_confirmed')),
  network_attempts int not null default 0 check (network_attempts >= 0),
  next_attempt_at timestamptz,
  -- Ownership/lease (sección 10 del brief) -- ver lib/developer/jobs-store.ts
  -- para el CAS real. lease_id nulo = nadie lo tiene tomado ahora mismo.
  lease_id uuid,
  locked_at timestamptz,
  -- Contador optimista: cada mutación real del job lo incrementa. Sirve
  -- DOS propósitos a la vez -- CAS de ownership (sección 10) Y guardia de
  -- monotonicidad (sección 14: "un evento viejo no debe hacer retroceder
  -- el estado") -- un UPDATE que trae un version_token viejo simplemente
  -- no matchea ninguna fila.
  version_token bigint not null default 0,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Consulta crítica de un Worker real: "dame los jobs listos para
-- reintentar" -- sección 18 del brief pide explícitamente un índice para
-- next_attempt_at.
create index if not exists dulabs_dev_jobs_retry_idx
  on public.dulabs_dev_jobs (next_attempt_at)
  where status = 'retry_pending';

create index if not exists dulabs_dev_jobs_workspace_idx
  on public.dulabs_dev_jobs (workspace_id);

-- Consulta de reconciliación: "dame los jobs atascados en incertidumbre".
create index if not exists dulabs_dev_jobs_reconciliation_idx
  on public.dulabs_dev_jobs (status)
  where status = 'reconciliation_pending';

alter table public.dulabs_dev_jobs enable row level security;

drop policy if exists tenant_select on public.dulabs_dev_jobs;
create policy tenant_select on public.dulabs_dev_jobs
  for select to authenticated
  using (workspace_id = public.dulabs_tenant_del_usuario());

comment on table public.dulabs_dev_jobs is
  'DuLabs Developer V1 (Fase 2). Persistencia real de la máquina de estados de lib/developer/outbound-state-machine.ts. version_token es el mecanismo de CAS real (sección 10/14 del brief) -- todo UPDATE de mutación debe incluir WHERE version_token = <valor leído> y verificar rowCount === 1 después.';

-- job_id de dulabs_dev_idempotency_keys (Fase 1) se deja SIN foreign key
-- hacia esta tabla a propósito en esta ronda: cambiar esa tabla rompería
-- el contrato ya probado de Fase 1 (56/56 tests en verde, "no rehagas lo
-- que ya funciona"). lib/developer/jobs-store.ts::crearJobConIdempotencia
-- es la función NUEVA que conecta ambos de forma atómica hacia adelante
-- (reclama idempotencia y crea la fila de job con el MISMO id) -- ver
-- documento de arquitectura, sección "Integración idempotencia <-> jobs".

-- ============================================================
-- 5. USAGE LEDGER
-- ============================================================
create table if not exists public.dulabs_dev_usage_ledger (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  job_id uuid not null,
  estado text not null default 'reservado' check (estado in ('reservado', 'confirmado', 'liberado')),
  cantidad int not null default 1 check (cantidad > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- LA garantía anti-doble-cobro pedida explícitamente (sección 13 del
-- brief): un job jamás puede tener dos filas de ledger. reservar/
-- confirmar/liberar son transiciones de ESTADO sobre la MISMA fila
-- (UPDATE), nunca un INSERT nuevo -- ver lib/developer/usage-ledger.ts.
create unique index if not exists dulabs_dev_usage_ledger_job_idx
  on public.dulabs_dev_usage_ledger (job_id);

create index if not exists dulabs_dev_usage_ledger_workspace_idx
  on public.dulabs_dev_usage_ledger (workspace_id);

alter table public.dulabs_dev_usage_ledger enable row level security;

drop policy if exists tenant_select on public.dulabs_dev_usage_ledger;
create policy tenant_select on public.dulabs_dev_usage_ledger
  for select to authenticated
  using (workspace_id = public.dulabs_tenant_del_usuario());

comment on table public.dulabs_dev_usage_ledger is
  'DuLabs Developer V1 (Fase 2). UNIQUE(job_id) es la garantía real de "nunca dos cargos lógicos para el mismo job" (sección 13 y 20 del brief de Fase 1). Billing comercial completo (facturación, moneda, tasas) queda fuera de esta fase -- esto es solo el ledger técnico de consumo.';

-- ============================================================
-- 6. EVENTS (trazabilidad / message lifecycle)
-- ============================================================
create table if not exists public.dulabs_dev_events (
  id bigint generated always as identity primary key,
  event_id uuid not null,
  workspace_id uuid not null,
  job_id uuid,
  request_id text,
  correlation_id text,
  tipo text not null check (tipo in ('received', 'queued', 'sending', 'sent', 'failed')),
  created_at timestamptz not null default now()
);

-- Deduplicación real contra la entrega at-least-once de Pub/Sub (sección
-- 19 del brief): el mismo event_id reentregado por Pub/Sub simplemente no
-- vuelve a insertar -- ver lib/developer/events-store.ts. Esto es lo que
-- convierte "at-least-once" en "procesado exactamente una vez" desde la
-- perspectiva de negocio.
create unique index if not exists dulabs_dev_events_event_id_idx
  on public.dulabs_dev_events (event_id);

create index if not exists dulabs_dev_events_job_idx
  on public.dulabs_dev_events (job_id) where job_id is not null;

create index if not exists dulabs_dev_events_workspace_idx
  on public.dulabs_dev_events (workspace_id);

alter table public.dulabs_dev_events enable row level security;

drop policy if exists tenant_select on public.dulabs_dev_events;
create policy tenant_select on public.dulabs_dev_events
  for select to authenticated
  using (workspace_id = public.dulabs_tenant_del_usuario());

comment on table public.dulabs_dev_events is
  'DuLabs Developer V1 (Fase 2). Log APEND-ONLY (nunca se actualiza una fila existente) -- la protección de monotonicidad real ("un evento viejo no debe retroceder el estado") vive en dulabs_dev_jobs.version_token, no acá: este log es la traza de auditoría, el estado autoritativo del job vive en la tabla de jobs.';
