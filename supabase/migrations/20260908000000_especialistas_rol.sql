-- AMORE / DuLabs (Fase P, usuarios y permisos, autorizado) — separación
-- conceptual GENÉRICA entre "administrador" y "personal", aditiva sobre el
-- mecanismo de token ya existente (nunca se reemplaza, ver
-- lib/agenda-admin-auth.ts). Default 'administrador' para TODA fila
-- existente -- esto es intencional: preserva exactamente el comportamiento
-- actual (cualquier token ya emitido sigue teniendo acceso total) para
-- Daniela, Solo Talento y AMORE. Un negocio decide más adelante, desde
-- ProfesionalModal, degradar a 'personal' a quien corresponda.

alter table public.dulabs_especialistas
  add column if not exists rol text not null default 'administrador'
  check (rol in ('administrador', 'personal'));

comment on column public.dulabs_especialistas.rol is
  '"administrador": puede gestionar configuración/servicios/especialistas/contabilidad/comunicaciones/WhatsApp. "personal": acceso operativo (su propia agenda), sin las secciones administrativas. Default administrador para no romper ningún token ya emitido.';
