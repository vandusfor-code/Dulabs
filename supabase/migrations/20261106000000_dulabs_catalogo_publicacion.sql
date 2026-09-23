-- DuLabs Catálogo — publicación del catálogo como HTML público (autorizado).
--
-- El dashboard (/dashboard/catalogo) queda SOLO para cargar y administrar
-- productos. La vitrina se ve en links públicos, fuera del dashboard:
--   /catalogo/{slug}                         -> precios DETAL (clientes finales)
--   /catalogo/{slug}/mayor/{token_mayor}     -> precios MAYOR (mayoristas)
--
-- El link mayorista lleva un token secreto de 256 bits generado por la BD:
-- un cliente final no puede adivinarlo a partir del link detal. Se puede
-- rotar (el link anterior deja de funcionar) si se filtra.
--
-- Aditiva y aislada: no toca ninguna tabla existente. Requiere
-- 20261105000000_dulabs_catalogo_fase1.sql aplicada antes.

begin;

create table if not exists public.dulabs_catalogo_publicacion (
  id_tenant uuid primary key,
  -- Parte legible y pública de la URL (ej. "delacour"). Única en toda la plataforma.
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$'),
  -- Nombre que ve el cliente en la cabecera del catálogo.
  nombre_publico text not null check (char_length(btrim(nombre_publico)) between 1 and 80),
  -- 64 caracteres hex de dos UUIDv4 (gen_random_uuid, núcleo de Postgres): ~244 bits aleatorios.
  token_mayor text not null
    default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
    check (token_mayor ~ '^[0-9a-f]{64}$'),
  -- false => ambos links responden 404 sin borrar nada.
  publicado boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists dulabs_catalogo_publicacion_slug_uq
  on public.dulabs_catalogo_publicacion (slug);
create unique index if not exists dulabs_catalogo_publicacion_token_uq
  on public.dulabs_catalogo_publicacion (token_mayor);

alter table public.dulabs_catalogo_publicacion enable row level security;

comment on table public.dulabs_catalogo_publicacion is
  'Publicación del Catálogo como HTML público por tenant: /catalogo/{slug} (detal) y /catalogo/{slug}/mayor/{token_mayor} (mayor). Solo el backend (service_role) la lee; el token mayorista nunca se expone en la página detal.';

commit;
