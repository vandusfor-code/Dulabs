-- Nombre personalizable del agente de IA de cada número (distinto del
-- nombre del negocio) — un cliente con varios números puede llamar a cada
-- asistente distinto (ej. "Ava" en Soporte, "Nova" en Ventas).

alter table public.dulabs_clientes_config
  add column if not exists nombre_agente text;

comment on column public.dulabs_clientes_config.nombre_agente is
  'Nombre personalizado del asistente de IA de este número, usado en el feed de actividad y el briefing del Command Center. Si es null, se muestra un nombre genérico.';
