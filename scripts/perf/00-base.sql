-- Rendimiento (Bloque 20) — tablas mínimas EXISTENTES de producción que las migraciones del
-- catálogo no crean (solo las columnas que usa el catálogo). SOLO en una BD LOCAL EFÍMERA.
create table if not exists public.dulabs_clientes_config (
  id uuid primary key default gen_random_uuid(),
  id_tenant uuid not null,
  nombre_negocio text,
  phone_number_id text unique,
  telefono_negocio text,
  updated_at timestamptz default now()
);
