-- Flag por tenant: cuando está activo, el número usa la herramienta real de
-- captura de leads (guardar_lead_interesado, ver lib/lead-solicitud-ia.ts)
-- en vez del asistente genérico sin herramientas. Pensado primero para el
-- propio número de DuLabs, pero queda disponible para cualquier tenant.
alter table dulabs_clientes_config
  add column if not exists captura_leads boolean not null default false;
