-- Permite que una campaña de captación NO pida RUT/teléfono/compañía y
-- transfiera el lead de inmediato al presionar SÍ (ej. masivo_wom). Default
-- true preserva el comportamiento actual (pedir los 3 datos) para toda
-- campaña ya configurada, como oferta_equipo_pie_cero. Migración aditiva.

alter table public.dulabs_campaign_bot_config
  add column if not exists collect_data boolean not null default true;

comment on column public.dulabs_campaign_bot_config.collect_data is
  'Si es false, el SÍ captura el lead de inmediato (sin pedir RUT/teléfono/compañía) y solo envía confirm_template -- para campañas que solo quieren transferir el contacto a una ejecutiva sin formulario previo.';
