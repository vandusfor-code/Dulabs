-- AMORE (autorizado, módulo Inventario) -- catálogo de productos físicos de
-- AMORE para la tienda pública (/amore/tienda) e integración con el bot de
-- WhatsApp. Migración nueva y aislada: no toca ninguna tabla existente
-- (dulabs_servicios sigue siendo el catálogo de SERVICIOS de spa, esto es un
-- catálogo de PRODUCTOS con stock, un dominio distinto).
--
-- Mismo patrón estructural que dulabs_servicios
-- (20260904030000_daniela_reservas_modelo_v1.sql): PK compuesta
-- (id_tenant, id), índice por tenant, índice parcial por activo, RLS
-- habilitado sin policy (el acceso real es 100% vía service_role desde el
-- backend, que ignora RLS -- igual que el resto del proyecto).
--
-- Diseñada para poder evolucionar más adelante hacia pedidos/ventas/
-- movimientos de stock (FK futura hacia esta tabla por (id_tenant, id)) sin
-- necesitar rediseño, pero esos módulos NO se implementan en esta fase.

create table public.dulabs_inventario_productos (
  id uuid not null default gen_random_uuid(),
  id_tenant uuid not null,
  nombre text not null,
  descripcion text,
  precio integer not null check (precio >= 0),
  stock integer not null default 0 check (stock >= 0),
  categoria text,
  foto_url text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id_tenant, id)
);

create index dulabs_inventario_productos_tenant_idx on public.dulabs_inventario_productos (id_tenant);
create index dulabs_inventario_productos_tenant_activo_idx on public.dulabs_inventario_productos (id_tenant) where activo;

comment on table public.dulabs_inventario_productos is
  'AMORE (autorizado) -- catálogo de productos de la tienda pública (/amore/tienda) y del flujo de compra por WhatsApp. Precio en COP, entero (sin decimales, igual que dulabs_servicios.precio). Stock se administra manualmente: ningún flujo automático (tienda, botón Comprar, "Ya pagué") lo descuenta.';
comment on column public.dulabs_inventario_productos.precio is 'COP, entero >= 0. El negocio no maneja centavos.';
comment on column public.dulabs_inventario_productos.stock is 'Entero >= 0, administrado manualmente desde el panel. Nunca se descuenta automáticamente por la tienda ni por el bot.';
comment on column public.dulabs_inventario_productos.foto_url is 'URL pública en el bucket inventario-productos, o null (la tienda muestra un placeholder). Opcional también en la carga masiva por Excel.';

alter table public.dulabs_inventario_productos enable row level security;

-- Bucket público para fotos de producto (primer upload real de imágenes del
-- proyecto -- no existía ninguno reutilizable, ver auditoría previa). Mismo
-- patrón de creación que el bucket existente 'chats-media'
-- (20260911000000_chats_whatsapp.sql), pero público porque la tienda es
-- pública y sin login: las fotos deben poder cargarse directo en <img src>
-- sin pasar por un endpoint de descarga autenticado.
insert into storage.buckets (id, name, public)
values ('inventario-productos', 'inventario-productos', true)
on conflict (id) do nothing;
