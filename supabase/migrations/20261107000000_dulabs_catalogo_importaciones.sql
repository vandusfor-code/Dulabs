-- DuLabs Catálogo — Fase 4: carga masiva de productos (autorizado, "FASE 4 —
-- CARGA MASIVA PROFESIONAL DEL CATÁLOGO").
--
-- Qué agrega (100 % ADITIVO; requiere 20261105000000_dulabs_catalogo_fase1.sql):
--
--   1. dulabs_catalogo_importaciones: historial de cargas masivas por tenant
--      (archivo, quién, cuándo, filas, creados, omitidos, errores, fotos,
--      estado). Una importación pertenece a UN tenant (PK compuesta).
--
--   2. dulabs_inventario_productos.importacion_id / importacion_fila
--      (nullable): de qué importación y de qué fila del archivo salió un
--      producto. Con el índice UNIQUE parcial (id_tenant, importacion_id,
--      importacion_fila) un reintento del mismo lote (red caída, doble clic,
--      pestaña recargada) NUNCA crea el producto dos veces: el segundo INSERT
--      choca y el servicio devuelve el producto ya creado. La FK compuesta
--      garantiza que un producto solo puede apuntar a una importación de SU
--      propio tenant.
--
-- Lo que NO hace: no toca columnas existentes, no cambia la generación de
-- referencias (sigue siendo el trigger dulabs_catalogo_asignar_referencia,
-- con su contador bloqueado por fila: dos importaciones simultáneas nunca
-- obtienen la misma referencia) y no cambia el comportamiento de AMORE, el
-- Business Agent ni la cotización (las columnas nuevas son NULL para todo lo
-- que no venga de una carga masiva).
--
-- Rollback (si hiciera falta, en este orden):
--   alter table public.dulabs_inventario_productos
--     drop constraint if exists dulabs_inventario_productos_importacion_fk,
--     drop constraint if exists dulabs_inventario_productos_importacion_par,
--     drop column if exists importacion_fila,
--     drop column if exists importacion_id;
--   drop table if exists public.dulabs_catalogo_importaciones;
--
-- Se aplica manualmente en el SQL Editor de Supabase (ver PENDING_MIGRATIONS.md).

begin;

-- ============================================================
-- 1. HISTORIAL DE IMPORTACIONES
-- ============================================================
create table if not exists public.dulabs_catalogo_importaciones (
  id uuid not null default gen_random_uuid(),
  id_tenant uuid not null,
  creado_por uuid,
  -- Nombre del archivo tal como lo eligió la persona (solo informativo).
  archivo text not null check (char_length(btrim(archivo)) between 1 and 200),
  total_filas integer not null default 0 check (total_filas between 0 and 100000),
  creados integer not null default 0 check (creados >= 0),
  omitidos integer not null default 0 check (omitidos >= 0),
  errores integer not null default 0 check (errores >= 0),
  fotos_subidas integer not null default 0 check (fotos_subidas >= 0),
  fotos_fallidas integer not null default 0 check (fotos_fallidas >= 0),
  -- procesando: en curso (o interrumpida si nunca se finalizó); completada: terminó.
  estado text not null default 'procesando' check (estado in ('procesando', 'completada')),
  created_at timestamptz not null default now(),
  finalizada_at timestamptz,
  primary key (id_tenant, id)
);

create index if not exists dulabs_catalogo_importaciones_recientes_idx
  on public.dulabs_catalogo_importaciones (id_tenant, created_at desc);

alter table public.dulabs_catalogo_importaciones enable row level security;

comment on table public.dulabs_catalogo_importaciones is
  'Historial de cargas masivas del Catálogo por tenant. Solo el backend (service_role) lo escribe. Los productos creados apuntan aquí con importacion_id/importacion_fila.';

-- ============================================================
-- 2. ORIGEN DE CADA PRODUCTO IMPORTADO (idempotencia por fila)
-- ============================================================
alter table public.dulabs_inventario_productos
  add column if not exists importacion_id uuid,
  add column if not exists importacion_fila integer check (importacion_fila is null or importacion_fila between 1 and 1000000);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dulabs_inventario_productos_importacion_par') then
    -- Ambas o ninguna: una fila sin importación no puede tener número de fila.
    alter table public.dulabs_inventario_productos
      add constraint dulabs_inventario_productos_importacion_par
      check ((importacion_id is null) = (importacion_fila is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dulabs_inventario_productos_importacion_fk') then
    -- MATCH SIMPLE: con importacion_id NULL (todo lo existente) no se verifica nada.
    alter table public.dulabs_inventario_productos
      add constraint dulabs_inventario_productos_importacion_fk
      foreign key (id_tenant, importacion_id)
      references public.dulabs_catalogo_importaciones (id_tenant, id);
  end if;
end;
$$;

create unique index if not exists dulabs_inventario_productos_importacion_fila_uq
  on public.dulabs_inventario_productos (id_tenant, importacion_id, importacion_fila)
  where importacion_id is not null;

comment on column public.dulabs_inventario_productos.importacion_id is
  'Carga masiva (dulabs_catalogo_importaciones) que creó el producto; NULL si se creó por otro camino.';
comment on column public.dulabs_inventario_productos.importacion_fila is
  'Fila del archivo de la carga masiva. UNIQUE por (tenant, importación, fila): un reintento nunca duplica el producto.';

commit;
