-- AMORE / DuLabs (Fase 8, confirmaciones y recordatorios, autorizado) —
-- configuración GENÉRICA por tenant del motor de comunicaciones de citas.
-- Ningún dato de cita/cliente vive acá -- eso sigue siendo
-- dulabs_citas_especialista/dulabs_clientes_conocidos, sin cambios.
-- Aditiva: tabla nueva.

create table if not exists public.dulabs_comunicaciones_config (
  id_tenant uuid primary key,
  confirmacion_activa boolean not null default false,
  confirmacion_mensaje text not null,
  recordatorio_activo boolean not null default false,
  recordatorio_anticipacion_horas smallint not null default 24 check (recordatorio_anticipacion_horas > 0),
  recordatorio_mensaje text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dulabs_comunicaciones_config enable row level security;

comment on table public.dulabs_comunicaciones_config is
  'Configuración por tenant del motor de confirmaciones/recordatorios de citas (Fase 8): activo/inactivo de cada tipo, anticipación del recordatorio y plantillas de mensaje. Genérica -- cualquier tenant puede tener su propia fila, no es exclusiva de AMORE. Sin fila para ningún tenant todavía -- se configura en una subfase posterior (el motor no tiene canal real de envío hasta la Fase 9).';
comment on column public.dulabs_comunicaciones_config.confirmacion_mensaje is
  'Plantilla del mensaje de confirmación. Soporta {{servicio}}, {{profesional}}, {{fecha}}, {{hora}} (y {{nombre}} si la plantilla lo usa).';
comment on column public.dulabs_comunicaciones_config.recordatorio_mensaje is
  'Plantilla del mensaje de recordatorio. Soporta {{nombre}}, {{servicio}}, {{profesional}}, {{fecha}}, {{hora}}.';
