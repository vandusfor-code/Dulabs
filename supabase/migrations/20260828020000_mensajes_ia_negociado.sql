-- Cupo de mensajes de IA negociado/heredado por tenant, mismo patrón que
-- precio_negociado_cop (20260827090000_precio_negociado.sql). null = usa el
-- cupo estándar del plan (lib/planes.ts). Se usa para respetar el cupo que
-- tenía un cliente cuando pagó, si luego se ajustan los cupos estándar del
-- plan hacia abajo -- sin esto, bajar un cupo general afectaría de
-- inmediato a quien ya estaba usando el anterior.
alter table public.dulabs_suscripciones
  add column if not exists mensajes_ia_mes_negociado integer;

comment on column public.dulabs_suscripciones.mensajes_ia_mes_negociado is
  'Cupo mensual de mensajes de IA específico de este tenant, si es distinto al del plan. Null = usa dulabs_clientes_config vía PLANES[plan].limites.mensajesIAMes.';
