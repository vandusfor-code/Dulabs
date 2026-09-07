-- AGENDA V2 (autorizado) — FASE 8: gestión de citas existentes (consultar,
-- cancelar, reprogramar). Migración puramente ADITIVA: no toca ninguna fila
-- existente, no borra ninguna columna, no cambia el comportamiento de nada
-- que ya funciona.
--
-- 1. Amplía el CHECK de `step` con 3 pasos nuevos, exclusivos de la gestión
--    de citas (S1_SERVICIO..S5_CONFIRMAR se REUTILIZAN tal cual para la
--    porción "elegir nueva fecha/hora" de la reprogramación -- nunca se
--    duplican esos steps).
-- 2. Agrega `cita_objetivo_id` (la cita real, de dulabs_citas_especialista,
--    sobre la que se está consultando/cancelando/reprogramando) y
--    `accion_gestion` (qué acción se pidió, mientras se resuelve cuál cita
--    en `SG_SELECCIONAR_CITA`).
-- 3. Tabla nueva `dulabs_agenda_v2_citas_nylas`: mapeo mínimo cita->evento de
--    Nylas para que cancelar/reprogramar puedan encontrar y tocar el evento
--    de calendario correcto -- dulabs_citas_especialista nunca guardó este
--    dato (crearCitaConNylas lo devolvía solo en memoria), así que sin esta
--    tabla no hay forma real de mantener DuLabs y el calendario consistentes.

alter table public.dulabs_agenda_v2_sesiones
  drop constraint if exists dulabs_agenda_v2_sesiones_step_check;

alter table public.dulabs_agenda_v2_sesiones
  add constraint dulabs_agenda_v2_sesiones_step_check
  check (step in (
    'S1_SERVICIO', 'S2_PROFESIONAL', 'S3_DIA', 'S4_HORA', 'S5_CONFIRMAR',
    'SG_SELECCIONAR_CITA', 'SG_CANCELAR_CONFIRMAR', 'SG_REPROGRAMAR_CONFIRMAR_INICIO'
  ));

alter table public.dulabs_agenda_v2_sesiones
  add column if not exists cita_objetivo_id bigint references public.dulabs_citas_especialista(id),
  add column if not exists accion_gestion text
    check (accion_gestion in ('consultar', 'cancelar', 'reprogramar'));

create table if not exists public.dulabs_agenda_v2_citas_nylas (
  cita_id bigint primary key references public.dulabs_citas_especialista(id) on delete cascade,
  nylas_event_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dulabs_agenda_v2_citas_nylas enable row level security;

comment on table public.dulabs_agenda_v2_citas_nylas is
  'AGENDA V2 (Fase 8) -- mapeo cita_id -> evento real de Nylas para esa cita. Escrito por Fase 7 al confirmar una reserva nueva; leído/actualizado por Fase 8 al cancelar/reprogramar, para mantener DuLabs y el calendario consistentes. Best-effort: su ausencia para una cita puntual nunca bloquea cancelarla en DuLabs, solo impide sincronizar el calendario para ESA cita.';
comment on column public.dulabs_agenda_v2_sesiones.cita_objetivo_id is
  'FASE 8 -- la cita real (dulabs_citas_especialista) sobre la que se está consultando/cancelando/reprogramando. Nunca se acepta un valor enviado por el cliente: siempre se resuelve en servidor vía tenant_id+telefono_cliente.';
comment on column public.dulabs_agenda_v2_sesiones.accion_gestion is
  'FASE 8 -- qué gestión se pidió (consultar/cancelar/reprogramar), mientras la sesión está en SG_SELECCIONAR_CITA esperando que el cliente elija cuál de sus varias citas.';
