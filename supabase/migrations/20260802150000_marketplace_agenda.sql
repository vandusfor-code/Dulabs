-- Módulo de Agenda/Citas real para los agentes del Marketplace con caso de
-- uso de reservas (Barbería, Clínica, Gimnasio, Inmobiliaria, Abogado — no
-- Restaurante/Tienda, cuyo caso real es toma de pedidos, no citas; ver
-- lib/marketplace.ts `usaAgenda`). Antes de esto NO existía ningún sistema
-- de agenda en el código: el "Agendado ✓" del sitio de marketing era un
-- mockup visual, sin persistencia real. Migración aditiva.

create table if not exists public.dulabs_marketplace_citas (
  id bigint generated always as identity primary key,
  activacion_id bigint not null references public.dulabs_marketplace_activaciones(id) on delete cascade,
  -- Denormalizado (mismo patrón que dulabs_survey_sessions.phone_number_id):
  -- permite RLS y consultas del webhook sin un join extra.
  phone_number_id text not null,
  numero_cliente text not null,
  nombre_cliente text,
  fecha date not null,
  hora_inicio time not null,
  duracion_min int not null default 30,
  servicio text,
  estado text not null default 'agendada'
    check (estado in ('agendada', 'cancelada', 'reagendada', 'completada', 'no_asistio')),
  -- Evita reenviar el recordatorio del cron más de una vez por cita.
  recordatorio_enviado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dulabs_marketplace_citas_activacion_fecha_idx
  on public.dulabs_marketplace_citas (activacion_id, fecha)
  where estado = 'agendada';

create index if not exists dulabs_marketplace_citas_cliente_idx
  on public.dulabs_marketplace_citas (numero_cliente, fecha)
  where estado = 'agendada';

create index if not exists dulabs_marketplace_citas_numero_idx
  on public.dulabs_marketplace_citas (phone_number_id);

create index if not exists dulabs_marketplace_citas_recordatorio_idx
  on public.dulabs_marketplace_citas (fecha, recordatorio_enviado)
  where estado = 'agendada' and recordatorio_enviado = false;

alter table public.dulabs_marketplace_citas enable row level security;

drop policy if exists tenant_select on public.dulabs_marketplace_citas;
create policy tenant_select on public.dulabs_marketplace_citas
  for select to authenticated
  using (phone_number_id in (select public.dulabs_numeros_del_tenant()));

comment on table public.dulabs_marketplace_citas is
  'Citas reales agendadas por el motor de agenda de los agentes del Marketplace con caso de uso de reservas. El backend (webhook, vía tool-use de Claude en lib/marketplace-agenda-ia.ts), nunca la IA por sí sola en texto libre, decide y persiste cada cambio de estado. "reagendada" queda en el check constraint para uso futuro (auditoría); reagendar hoy actualiza la misma fila y la deja en estado agendada.';

-- Campos nuevos de la plantilla de configuración (lib/agente-config.ts):
-- cuántos recursos (sillas/doctores/canchas) atienden en simultáneo y la
-- duración estándar de una cita, para calcular disponibilidad real. También
-- un nombre de plantilla Meta opcional para el recordatorio fuera de la
-- ventana de 24h (igual patrón que dulabs_survey_bot_config.reminder_template_name).
alter table public.dulabs_marketplace_activaciones
  add column if not exists recursos_disponibles int not null default 1,
  add column if not exists duracion_estandar_min int not null default 30,
  add column if not exists recordatorio_template_name text;
