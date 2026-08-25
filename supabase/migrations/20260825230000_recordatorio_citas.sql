-- Marca si ya se envió el recordatorio de "1 hora antes" para una cita, así
-- el cron (cada ~10 min) no la vuelve a avisar en la siguiente pasada.
alter table public.dulabs_citas_especialista
  add column if not exists recordatorio_enviado boolean not null default false;
