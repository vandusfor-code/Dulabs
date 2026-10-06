-- AMORE — «MI CITA»: enlace personal y seguro para gestionar UNA cita (ver, reprogramar, cancelar) sin iniciar sesión.
--
-- Migración puramente ADITIVA: crea una tabla nueva. No toca ninguna fila, columna ni tabla existente.
--
-- Diseño de seguridad:
--   * El token es ALEATORIO (32 bytes de CSPRNG, 256 bits): no se deriva del id de la cita ni de nada predecible, no lleva información embebida y no
--     se puede enumerar. El id de la cita NUNCA viaja en la URL: el servidor lo resuelve SIEMPRE a partir del token.
--   * Se guarda el HASH (sha256, único) para validar, y una copia CIFRADA (AES-256-GCM con TOKEN_ENCRYPTION_KEY, igual que los tokens de Meta) solo para
--     poder reenviar el MISMO enlace en los recordatorios. Una copia de la base por sí sola no revela ningún enlace.
--   * Revocable (revocado_at) y con vencimiento (expira_at). Un solo enlace ACTIVO por cita (índice único parcial).
--   * RLS activado SIN políticas: solo el backend (service_role) la lee o escribe; el cliente (anon/authenticated) no ve nada.
--   * Si la cita se borra, el enlace se borra con ella (on delete cascade).
--
-- Si esta migración no está aplicada, el código es tolerante: las reservas siguen funcionando, solo que sin enlace de gestión (se registra en el log).

create table if not exists public.dulabs_cita_enlaces (
  id uuid primary key default gen_random_uuid(),
  id_tenant uuid not null,
  cita_id bigint not null references public.dulabs_citas_especialista(id) on delete cascade,
  token_hash text not null,
  token_cifrado text not null,
  created_at timestamptz not null default now(),
  expira_at timestamptz not null,
  revocado_at timestamptz,
  ultimo_uso_at timestamptz,
  constraint dulabs_cita_enlaces_token_hash_formato check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint dulabs_cita_enlaces_vigencia check (expira_at > created_at)
);

-- Búsqueda por token (validación): único, así dos citas jamás comparten enlace.
create unique index if not exists dulabs_cita_enlaces_token_hash_uk on public.dulabs_cita_enlaces (token_hash);

-- Un solo enlace activo (no revocado) por cita: pedirlo dos veces devuelve el mismo, nunca crea otro.
create unique index if not exists dulabs_cita_enlaces_cita_activo_uk on public.dulabs_cita_enlaces (cita_id) where revocado_at is null;

create index if not exists dulabs_cita_enlaces_tenant_idx on public.dulabs_cita_enlaces (id_tenant);

alter table public.dulabs_cita_enlaces enable row level security;

comment on table public.dulabs_cita_enlaces is
  'AMORE «Mi cita» -- enlace personal para ver/reprogramar/cancelar UNA cita. token_hash = sha256 del token aleatorio (validación); token_cifrado = el mismo token cifrado (solo para reenviar el enlace en recordatorios). Nunca expone el id de la cita. Solo service_role (RLS sin políticas).';
comment on column public.dulabs_cita_enlaces.token_hash is 'sha256 (hex, 64) del token. Se valida SIEMPRE por hash; el token en claro nunca se guarda.';
comment on column public.dulabs_cita_enlaces.token_cifrado is 'Token cifrado con TOKEN_ENCRYPTION_KEY (AES-256-GCM). Permite reconstruir el MISMO enlace para un recordatorio; no sirve sin la clave del servidor.';
comment on column public.dulabs_cita_enlaces.expira_at is 'Vencimiento del enlace (hoy: 14 días después del fin de la cita). Pasada esta fecha el enlace deja de abrir.';
comment on column public.dulabs_cita_enlaces.revocado_at is 'Si no es null, el enlace está revocado y deja de abrir.';
