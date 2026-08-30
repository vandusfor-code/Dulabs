-- Fase 2 (bug crítico real, prueba 314 sin confirmación) — opt-in explícito
-- por tenant para exigir confirmación explícita antes de crear una cita vía
-- la herramienta LEGACY crear_solicitud_cita.
--
-- Contexto: la cita real #553 (Daniela, 2026-08-30) se creó sin que la
-- clienta enviara nunca un "sí"/"confirmo" -- crear_solicitud_cita no exigía
-- (ni exige hoy, mientras esta columna no exista) ningún campo confirmado.
-- crearCitaEspecialista/crearCitaEnCategoria (lib/especialistas.ts) son
-- funciones compartidas con el formulario web público
-- (app/api/agenda/[token]/route.ts) y el asistente de administración
-- (lib/especialista-admin-ia.ts) -- NO se modifican para exigir confirmación
-- globalmente. La protección vive en la capa de la herramienta conversacional
-- de cliente final (lib/especialista-solicitud-ia.ts), aislada por tenant.
--
-- Default false en la columna: CERO cambio de comportamiento para cualquier
-- tenant existente, incluida Daniela, hasta que alguien active
-- requiere_confirmacion_cita=true a mano para un phone_number_id puntual.
--
-- NO EJECUTAR EN PRODUCCIÓN TODAVÍA -- pendiente de autorización explícita
-- (ver informe "DEPLOY FIX A + FIX B" / auditoría cita #553).

alter table public.dulabs_clientes_config
  add column if not exists requiere_confirmacion_cita boolean not null default false;

comment on column public.dulabs_clientes_config.requiere_confirmacion_cita is
  'Opt-in explícito: true = crear_solicitud_cita (lib/especialista-solicitud-ia.ts) exige confirmado=true antes de crear la cita real. Default false — no afecta a ningún tenant existente hasta activarse a mano. NO usar para inferir nada más (no reemplaza flow_activo, no tiene relación con el motor Flow).';
