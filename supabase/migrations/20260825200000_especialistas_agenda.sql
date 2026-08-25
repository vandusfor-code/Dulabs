-- Agenda por especialista (ej. Nicol para pestañas). Reutiliza el mismo
-- principio que dulabs_marketplace_citas (nunca confiar en "consultar
-- disponibilidad -> esperar -> insertar" desde el código: dos solicitudes
-- casi simultáneas pasarían ambas la validación), pero resuelto con un
-- constraint EXCLUDE de Postgres en vez de una función RPC -- es la propia
-- base de datos la que rechaza atómicamente una cita que se solape con otra
-- del mismo especialista, sin ventana de carrera posible.

create extension if not exists btree_gist;

create table if not exists public.dulabs_especialistas (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null,
  nombre text not null,
  numero_whatsapp text not null, -- solo dígitos, con código de país
  servicio text not null, -- ej. "pestañas" -- una especialidad por persona alcanza por ahora
  duracion_min integer not null default 90,
  -- Clave secreta de su link de agenda (dulabs.co/agenda/{token}), sin login:
  -- quien tenga el link ve y gestiona SOLO las citas de esa persona.
  token text not null default encode(gen_random_bytes(18), 'base64url'),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_especialistas_numero_unico unique (phone_number_id, numero_whatsapp),
  constraint dulabs_especialistas_token_unico unique (token)
);

create table if not exists public.dulabs_citas_especialista (
  id bigint generated always as identity primary key,
  especialista_id bigint not null references public.dulabs_especialistas(id) on delete cascade,
  id_tenant uuid not null,
  phone_number_id text not null,
  telefono_cliente text,
  nombre_cliente text not null,
  servicio text not null,
  inicio timestamptz not null,
  fin timestamptz not null,
  estado text not null default 'pendiente', -- pendiente | confirmada | rechazada | cancelada
  motivo_rechazo text,
  origen text not null default 'manual', -- manual | whatsapp_ia
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_citas_especialista_horario_valido check (fin > inicio),
  constraint dulabs_citas_especialista_estado_valido check (estado in ('pendiente', 'confirmada', 'rechazada', 'cancelada'))
);

-- El corazón de la prevención de doble reserva: dos filas del MISMO
-- especialista no pueden tener rangos de tiempo que se toquen, mientras
-- ambas sigan "vivas" (pendiente o confirmada). rechazada/cancelada no
-- bloquean -- liberan el horario de inmediato en cuanto cambian de estado.
alter table public.dulabs_citas_especialista
  add constraint dulabs_citas_especialista_sin_solape
  exclude using gist (
    especialista_id with =,
    tstzrange(inicio, fin) with &&
  ) where (estado in ('pendiente', 'confirmada'));

create index if not exists dulabs_citas_especialista_especialista_idx
  on public.dulabs_citas_especialista (especialista_id, inicio);

alter table public.dulabs_especialistas enable row level security;
alter table public.dulabs_citas_especialista enable row level security;

comment on table public.dulabs_especialistas is
  'Personas del negocio con agenda propia (ej. Nicol, pestañas). El token en la URL es la única autenticación de su link -- sin login, pensado para ser simple de usar desde el celular.';
comment on table public.dulabs_citas_especialista is
  'Citas por especialista. El constraint EXCLUDE (no dulabs_citas_especialista_sin_solape) es lo que impide atómicamente que dos solicitudes para el mismo horario ambas pasen -- lo hace Postgres, no el código de la aplicación.';
