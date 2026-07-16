-- Permite pausar la IA de un número completo desde el dashboard (distinto
-- de la pausa por chat que ya existe cuando el dueño responde manualmente).

alter table public.dulabs_clientes_config
  add column if not exists ia_pausada boolean not null default false;

comment on column public.dulabs_clientes_config.ia_pausada is
  'true si el dueño pausó manualmente la IA para todo este número desde Agentes de IA. Los mensajes entrantes se siguen registrando, pero la IA no responde.';
