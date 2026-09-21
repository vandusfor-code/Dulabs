-- DuLabs Developer V1 -- GitHub Integration (Fase 1: conectar repo, autorizado).
-- ADITIVO y multi-tenant desde el inicio: todos los recursos se anclan a un
-- workspace_id (uuid), la MISMA unidad tenant que el resto de Developer V1
-- (dulabs_dev_*). Nunca toca tablas de Business/AMORE.
--
-- Objetivo Fase 1 (deliberadamente acotado, ver docs/GITHUB_INTEGRATION_SETUP.md):
--   workspace  ->  instalación de la GitHub App  ->  repositorio seleccionado.
-- NO se guarda código del cliente, NO se clonan repos, NO se persisten tokens
-- de instalación (son efímeros ~1h: se acuñan on-demand desde la private key
-- de la App que vive SOLO en variables de entorno del servidor). El único
-- secreto server-side es GITHUB_PRIVATE_KEY / GITHUB_WEBHOOK_SECRET (env), así
-- que estas tablas no almacenan ningún secreto (nada que cifrar acá).
--
-- Aislamiento: RLS con el helper existente dulabs_dev_workspaces_del_usuario()
-- (Fase 8) -- un workspace JAMÁS ve la instalación/repo de otro. La ESCRITURA
-- pasa siempre por service_role desde el backend (sin políticas de mutación
-- para `authenticated`), igual que api_keys/webhooks/números.

-- ============================================================
-- 1. Instalación de la GitHub App vinculada a un workspace
-- ============================================================
create table if not exists public.dulabs_dev_github_installations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  -- installation_id de GitHub (identidad de la instalación de la App). Con él
  -- se acuñan tokens de instalación efímeros; no se guarda ningún token acá.
  installation_id bigint not null,
  -- Cuenta de GitHub (usuario u organización) dueña de la instalación.
  github_account_login text not null,
  github_account_id bigint,
  github_account_type text check (github_account_type in ('User', 'Organization')),
  -- activo: instalación válida. sin_acceso: GitHub la suspendió (suspend) o
  -- perdió permisos. desconectado: el usuario la desvinculó desde DuLabs o la
  -- eliminó desde GitHub (installation.deleted vía webhook).
  estado text not null default 'activo' check (estado in ('activo', 'sin_acceso', 'desconectado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  desconectado_at timestamptz,
  -- Una conexión de GitHub por workspace (UX "Conectar / Cambiar repositorio").
  -- Reconectar reemplaza la fila (upsert por workspace_id).
  constraint dulabs_dev_github_installations_workspace_unico unique (workspace_id)
);

-- El webhook de GitHub identifica por installation_id (no trae workspace):
-- índice para resolver rápido qué fila(s) marcar ante installation.deleted/suspend.
create index if not exists dulabs_dev_github_installations_installation_idx
  on public.dulabs_dev_github_installations (installation_id);

comment on table public.dulabs_dev_github_installations is
  'DuLabs Developer V1 (GitHub Fase 1). Instalación de la GitHub App vinculada a un workspace. No guarda tokens (efímeros, acuñados on-demand desde la private key en env). RLS por workspace; escritura solo service_role.';

-- ============================================================
-- 2. Repositorio seleccionado por el workspace
-- ============================================================
create table if not exists public.dulabs_dev_github_repos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  installation_row_id uuid not null
    references public.dulabs_dev_github_installations (id) on delete cascade,
  -- Identidad del repo en GitHub (estable ante renombres del repo).
  repo_id bigint not null,
  owner_login text not null,
  repo_name text not null,
  full_name text not null,
  html_url text not null,
  private boolean not null default false,
  estado text not null default 'vinculado' check (estado in ('vinculado', 'desvinculado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un repo seleccionado por workspace (Fase 1). Reelegir reemplaza (upsert).
  constraint dulabs_dev_github_repos_workspace_unico unique (workspace_id)
);

comment on table public.dulabs_dev_github_repos is
  'DuLabs Developer V1 (GitHub Fase 1). Repositorio que el workspace vinculó (propiedad del usuario; DuLabs no lo modifica ni lo clona). RLS por workspace; escritura solo service_role.';

-- ============================================================
-- 3. Estados efímeros del flujo de instalación (anti-CSRF, single-use)
-- ============================================================
-- Liga la redirección a GitHub con el workspace que la inició, SIN confiar en
-- un workspace_id del query del callback (que llega sin sesión). Se crea en una
-- request autenticada (OWNER/ADMIN) y se consume una sola vez en el callback.
create table if not exists public.dulabs_dev_github_connect_states (
  state uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists dulabs_dev_github_connect_states_expira_idx
  on public.dulabs_dev_github_connect_states (expires_at);

comment on table public.dulabs_dev_github_connect_states is
  'DuLabs Developer V1 (GitHub Fase 1). Nonce single-use que liga el callback de instalación con el workspace/usuario que lo inició (anti-CSRF). Backend-only (service_role); sin políticas de lectura para authenticated.';

-- ============================================================
-- 4. Idempotencia del webhook de GitHub (dedupe por delivery id)
-- ============================================================
create table if not exists public.dulabs_dev_github_webhook_deliveries (
  delivery_id text primary key,
  evento text,
  recibido_en timestamptz not null default now()
);

comment on table public.dulabs_dev_github_webhook_deliveries is
  'DuLabs Developer V1 (GitHub Fase 1). Dedupe de entregas del webhook de GitHub (X-GitHub-Delivery). Backend-only (service_role).';

-- ============================================================
-- 5. RLS
-- ============================================================
alter table public.dulabs_dev_github_installations enable row level security;
alter table public.dulabs_dev_github_repos enable row level security;
alter table public.dulabs_dev_github_connect_states enable row level security;
alter table public.dulabs_dev_github_webhook_deliveries enable row level security;

-- Lectura por workspace (mismo helper y criterio EXACTO que api_keys/webhooks).
drop policy if exists tenant_select on public.dulabs_dev_github_installations;
create policy tenant_select on public.dulabs_dev_github_installations
  for select to authenticated
  using (workspace_id in (select public.dulabs_dev_workspaces_del_usuario()));

drop policy if exists tenant_select on public.dulabs_dev_github_repos;
create policy tenant_select on public.dulabs_dev_github_repos
  for select to authenticated
  using (workspace_id in (select public.dulabs_dev_workspaces_del_usuario()));

-- connect_states y webhook_deliveries: RLS habilitado y SIN políticas =>
-- `authenticated` no ve nada (deny-all). Solo el backend (service_role) los
-- toca. Nunca deben ser legibles desde el navegador.
