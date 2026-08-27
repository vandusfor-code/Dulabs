-- Panel de Operaciones -- Fase 9 (métricas): "tiempo promedio desde pago
-- hasta activación" necesita saber CUÁNDO un cliente llegó a ACTIVO por
-- primera vez. updated_at no sirve para esto: se pisa con cualquier cambio
-- posterior (ej. si después pasa a REQUIERE_ATENCION y vuelve a ACTIVO).
-- Migración puramente aditiva.

alter table public.dulabs_onboarding_sesiones
  add column if not exists activado_at timestamptz;

comment on column public.dulabs_onboarding_sesiones.activado_at is
  'Se llena la PRIMERA vez que estado_implementacion pasa a ACTIVO. No se sobreescribe en cambios posteriores -- es el hito histórico "cuándo quedó activo por primera vez", no "el último momento en que estuvo activo".';
