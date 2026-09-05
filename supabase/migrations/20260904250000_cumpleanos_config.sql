-- AMORE (Fase 6A, cumpleaños automáticos, autorizado) — configuración
-- GENÉRICA por tenant del módulo de cumpleaños. Ningún dato de cliente vive
-- acá (eso sigue siendo dulabs_clientes_conocidos, sin cambios) -- esta
-- tabla solo guarda CÓMO quiere cada negocio que se comporte el módulo.
-- Aditiva: tabla nueva, no toca nada existente.

create table if not exists public.dulabs_cumpleanos_config (
  id_tenant uuid primary key,
  activo boolean not null default false,
  mensaje text not null,
  nombre_negocio text,
  hora_envio time not null default '09:00',
  zona_horaria text not null default 'America/Bogota',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dulabs_cumpleanos_config enable row level security;

comment on table public.dulabs_cumpleanos_config is
  'Configuración por tenant del módulo de cumpleaños automáticos (Fase 6A): activo/inactivo, plantilla del mensaje, zona horaria y hora de envío. Genérica -- cualquier tenant puede tener su propia fila, no es exclusiva de AMORE.';
comment on column public.dulabs_cumpleanos_config.mensaje is
  'Plantilla del mensaje de cumpleaños. Soporta {{nombre}} (obligatorio) y {{negocio}} (opcional, usa nombre_negocio si viene). Debe ser SOLO de felicitación -- no vende, no invita a reservar, sin descuentos ni botones.';
comment on column public.dulabs_cumpleanos_config.hora_envio is
  'Hora local (zona_horaria) a la que debería correr el envío para este tenant. Todavía no hay cron de producción activado (Fase 6A) -- este campo queda preparado para la siguiente subfase.';
