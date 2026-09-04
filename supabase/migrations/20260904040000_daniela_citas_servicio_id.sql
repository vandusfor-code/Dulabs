-- Fase 3 del sistema de reservas de Daniela (autorizado) — referencia
-- estructurada opcional de una cita a su servicio del catálogo nuevo
-- (dulabs_servicios, Fase 1). Aditiva: no se toca ni se elimina la columna
-- `servicio` (texto libre) que usa TODO el código existente (LEGACY, Flow no
-- activado, panel) -- servicio_id es NULLABLE y solo lo llenan las citas
-- creadas por reservarCitaPorServicio (lib/disponibilidad-servicio.ts).
--
-- Se revisaron todas las referencias existentes a la columna `servicio`
-- antes de este cambio (especialistaPorServicio, categoriaDeServicio,
-- COLUMNAS_CITA, las herramientas de IA, el POST manual del panel) -- ninguna
-- se toca ni se ve afectada por agregar esta columna nueva.

alter table public.dulabs_citas_especialista
  add column servicio_id uuid;

-- FK compuesta por (id_tenant, servicio_id) -- mismo patrón ya usado en
-- dulabs_servicio_especialista/dulabs_horario_especialista/dulabs_bloqueos
-- (Fase 1): impide a nivel de Postgres que una cita quede apuntando a un
-- servicio de OTRO tenant. Con servicio_id NULL (el caso de toda cita
-- LEGACY) la FK simplemente no se evalúa (MATCH SIMPLE estándar).
alter table public.dulabs_citas_especialista
  add constraint dulabs_citas_especialista_servicio_fk
  foreign key (id_tenant, servicio_id)
  references public.dulabs_servicios (id_tenant, id)
  on delete set null;

create index dulabs_citas_especialista_servicio_idx
  on public.dulabs_citas_especialista (servicio_id)
  where servicio_id is not null;
