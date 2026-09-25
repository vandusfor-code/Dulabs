-- Publi Bordados — preludio para probar 20261120000000_dulabs_pb_solicitudes.sql en un
-- PostgreSQL LOCAL EFÍMERO (nunca contra producción).
--
-- Crea SOLO si no existen: roles de Supabase y las columnas reales que la migración usa de las
-- tablas compartidas (mismas definiciones que sus migraciones originales:
-- 20260825250000_clientes_conocidos.sql + 20260926000000 (custom_fields),
-- 20260713120000_create_dulabs_clientes_config.sql, 20260718090300_rls_tenant_por_membresia.sql,
-- 20260828100000_dulabs_flow_store.sql y 20260714150000_mensajes_log_y_plantillas.sql).
--
-- Orden: \i este preludio → \i la migración (dos veces: idempotente) → \i el .test.sql

\set ON_ERROR_STOP 1

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

create table if not exists public.dulabs_clientes_config (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text unique,
  nombre_negocio text
);

create table if not exists public.dulabs_clientes_conocidos (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null,
  telefono_cliente text not null,
  nombre text not null,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_clientes_conocidos_unico unique (phone_number_id, telefono_cliente)
);

create table if not exists public.dulabs_miembros_equipo (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  email text not null,
  nombre text,
  rol text not null default 'agente',
  estado text not null default 'invitado',
  created_at timestamptz not null default now()
);

create table if not exists public.dulabs_flow_executions (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  flow_id uuid not null,
  flow_version_id uuid not null,
  execution_id text not null,
  phone_number_id text not null,
  telefono_cliente text not null,
  status text not null,
  current_node_id text,
  variables jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create table if not exists public.dulabs_mensajes_log (
  id bigint generated always as identity primary key,
  phone_number_id text not null,
  telefono_cliente text not null,
  direccion text not null,
  contenido text not null,
  created_at timestamptz not null default now()
);
