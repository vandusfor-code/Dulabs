-- DuLabs — Fase 8: runtime del agente conversacional (Gemini) por número de WhatsApp.
--
-- 100 % ADITIVO. No toca tablas existentes. Sin filas, nada cambia: el webhook
-- sigue exactamente igual (Business Agent / Flow / legacy).
--
--   1. dulabs_agente_runtime_config: configuración EXPLÍCITA del agente de un
--      número (proveedor, modelo, referencia a la credencial, herramientas
--      permitidas, configuración del negocio). Sin valores por defecto para
--      proveedor/modelo/credencial: si faltan, la fila no se puede crear.
--      El secreto NUNCA se guarda aquí: `credencial_ref` apunta a una variable
--      de entorno del servidor (p. ej. env:GEMINI_KEY_DELACOUR).
--
--   2. dulabs_agente_conversaciones: memoria de CORTO PLAZO estructurada por
--      conversación (canal, carrito de referencias, candidatos mostrados,
--      propuesta presentada…), con versión para compare-and-set. La memoria
--      de negocio persistente sigue en las tablas existentes (clientes
--      conocidos, pedidos de la Fase 7).
--
-- Rollback:
--   drop table if exists public.dulabs_agente_conversaciones;
--   drop table if exists public.dulabs_agente_runtime_config;
--
-- Se aplica manualmente en el SQL Editor de Supabase (ver PENDING_MIGRATIONS.md).

begin;

create table if not exists public.dulabs_agente_runtime_config (
  id uuid primary key default gen_random_uuid(),
  id_tenant uuid not null,
  -- Un agente por número (el número identifica al negocio en el webhook).
  phone_number_id text not null check (char_length(phone_number_id) between 1 and 64),
  tipo text not null check (tipo in ('catalog_sales')),
  habilitado boolean not null default false,
  -- SIN default: el proveedor se declara siempre. La lista de modelos válidos vive en el código (lib/ia-proveedores/registro.ts).
  proveedor text not null check (proveedor in ('gemini')),
  modelo text not null check (modelo ~ '^[a-z0-9][a-z0-9.-]{1,60}$'),
  credencial_ref text not null check (credencial_ref ~ '^env:[A-Z][A-Z0-9_]{1,60}$'),
  nivel_razonamiento text check (nivel_razonamiento is null or nivel_razonamiento in ('minimal', 'low', 'medium', 'high')),
  -- Allowlist de herramientas (se valida contra el registro del código al cargar).
  herramientas text[] not null check (cardinality(herramientas) between 1 and 30),
  -- Canal de precios del número: detal salvo que el negocio lo declare mayorista.
  canal text not null default 'retail' check (canal in ('retail', 'wholesale')),
  -- Configuración del negocio (tono, políticas). Corta: nunca el catálogo.
  negocio jsonb not null default '{}'::jsonb check (jsonb_typeof(negocio) = 'object' and pg_column_size(negocio) <= 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_agente_runtime_config_numero unique (phone_number_id)
);

create index if not exists dulabs_agente_runtime_config_tenant_idx on public.dulabs_agente_runtime_config (id_tenant);

comment on table public.dulabs_agente_runtime_config is
  'Fase 8 — agente conversacional por número de WhatsApp: proveedor/modelo EXPLÍCITOS (sin default), referencia a la credencial (nunca el secreto), herramientas permitidas. Solo service_role.';

alter table public.dulabs_agente_runtime_config enable row level security;

create table if not exists public.dulabs_agente_conversaciones (
  id_tenant uuid not null,
  phone_number_id text not null,
  wa_id text not null check (wa_id ~ '^[0-9]{6,20}$'),
  version integer not null default 0 check (version >= 0),
  estado jsonb not null default '{}'::jsonb check (jsonb_typeof(estado) = 'object' and pg_column_size(estado) <= 32768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (phone_number_id, wa_id)
);

create index if not exists dulabs_agente_conversaciones_tenant_idx on public.dulabs_agente_conversaciones (id_tenant, updated_at desc);

comment on table public.dulabs_agente_conversaciones is
  'Fase 8 — memoria de corto plazo ESTRUCTURADA por conversación (compare-and-set por version). No guarda precios ni stock: solo referencias, cantidades e ids públicos. Solo service_role.';

alter table public.dulabs_agente_conversaciones enable row level security;

revoke all on table public.dulabs_agente_runtime_config from anon, authenticated;
revoke all on table public.dulabs_agente_conversaciones from anon, authenticated;

commit;
