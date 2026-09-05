-- Login AMORE (autorizado) — usuarios reales con contraseña, GENÉRICO para
-- cualquier tenant (no exclusivo de AMORE). Un tenant "activa" el login
-- simplemente teniendo filas acá -- ver lib/auth/authz.ts::requireAuth.
-- Daniela y Solo Talento no tienen ninguna fila, así que su flujo sin login
-- (el token de la URL como única autenticación) sigue exactamente igual.
--
-- username es único GLOBALMENTE (no solo por tenant): la ruta /login es una
-- sola para toda la plataforma y necesita resolver el tenant a partir del
-- username antes de conocerlo -- una unicidad global es más estricta que
-- "único por tenant" (la cumple por definición) y es lo que hace posible
-- una sola pantalla de login sin pedir de antemano a qué negocio pertenece
-- la cuenta. Si en el futuro se onboardan muchos tenants con alta de
-- usuarios self-service, esto debería evolucionar a un selector de
-- tenant/subdominio -- hoy, con un puñado de tenants dados de alta a mano,
-- es una simplificación razonable y explícita.
create table if not exists public.dulabs_usuarios (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  especialista_id bigint references public.dulabs_especialistas(id) on delete set null,
  username text not null,
  password_hash text not null,
  nombre text not null,
  rol text not null check (rol in ('administrador', 'colaboradora')),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_usuarios_username_unico unique (username),
  constraint dulabs_usuarios_colaboradora_requiere_especialista
    check (rol <> 'colaboradora' or especialista_id is not null)
);

create index if not exists dulabs_usuarios_tenant_idx on public.dulabs_usuarios (id_tenant);
create index if not exists dulabs_usuarios_especialista_idx on public.dulabs_usuarios (especialista_id);

alter table public.dulabs_usuarios enable row level security;

comment on table public.dulabs_usuarios is
  'Cuentas de login reales (Login AMORE). password_hash SIEMPRE en formato scrypt:<saltHex>:<hashHex> (ver lib/auth/password.ts) -- nunca texto plano, nunca se selecciona hacia una ruta que responda al navegador.';
comment on column public.dulabs_usuarios.rol is
  '"administrador": acceso completo al tenant (todos los módulos). "colaboradora": solo su propia agenda operativa -- especialista_id obligatoria.';
comment on column public.dulabs_usuarios.especialista_id is
  'Especialista vinculada (dulabs_especialistas). Obligatoria si rol=colaboradora; opcional si rol=administrador (una administradora puede o no ser también profesional).';

-- Sesiones OPACAS (no JWT): la cookie del navegador solo guarda un token
-- aleatorio: token_hash es el hash sha256 de ese token, nunca el valor
-- crudo -- ver lib/auth/session.ts. "Cerrar sesión" y "revocar todo" son un
-- UPDATE real sobre esta tabla, no depender de que un JWT expire solo.
create table if not exists public.dulabs_usuarios_sesiones (
  id bigint generated always as identity primary key,
  usuario_id bigint not null references public.dulabs_usuarios(id) on delete cascade,
  token_hash text not null unique,
  creado_en timestamptz not null default now(),
  expira_en timestamptz not null,
  revocada_en timestamptz
);

create index if not exists dulabs_usuarios_sesiones_usuario_idx on public.dulabs_usuarios_sesiones (usuario_id);

alter table public.dulabs_usuarios_sesiones enable row level security;

comment on table public.dulabs_usuarios_sesiones is
  'Sesiones de login activas/expiradas/revocadas (Login AMORE). token_hash es sha256 del token crudo que vive en la cookie httpOnly -- la tabla nunca guarda el valor que un atacante podría reusar directamente.';
