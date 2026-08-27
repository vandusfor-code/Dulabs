-- Panel de Operaciones/Admin de DuLabs: estado de implementación por cliente
-- (post-onboarding). Migración puramente aditiva -- no modifica ni elimina
-- ninguna columna existente.
--
-- Vive en dulabs_onboarding_sesiones (no en una tabla nueva) porque esa fila
-- YA es "el registro operativo de este tenant después de pagar" -- un
-- estado de implementación aparte duplicaría lo que ya existe ahí.

alter table public.dulabs_onboarding_sesiones
  add column if not exists estado_implementacion text not null default 'PENDIENTE'
    check (estado_implementacion in ('PENDIENTE', 'EN_CONFIGURACION', 'EN_PRUEBAS', 'ACTIVO', 'REQUIERE_ATENCION'));

comment on column public.dulabs_onboarding_sesiones.estado_implementacion is
  'Estado de la implementación técnica post-onboarding, gestionado desde el Panel de Operaciones. Independiente de dulabs_onboarding_sesiones.estado (que es el progreso de la CONVERSACIÓN del bot, no de la implementación real).';

-- "Fecha de inicio si existe" (pedido explícito del brief para el detalle de
-- cliente) -- no es lo mismo que iniciado_at (que marca cuándo arrancó la
-- CONVERSACIÓN de onboarding). Null hasta que un especialista mueva el
-- estado fuera de PENDIENTE por primera vez.
alter table public.dulabs_onboarding_sesiones
  add column if not exists implementacion_iniciada_at timestamptz;

comment on column public.dulabs_onboarding_sesiones.implementacion_iniciada_at is
  'Se llena la primera vez que estado_implementacion sale de PENDIENTE. Null mientras siga pendiente.';
