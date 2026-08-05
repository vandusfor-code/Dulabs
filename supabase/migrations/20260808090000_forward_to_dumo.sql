-- Marca qué números reenvían eventos de WhatsApp a DuMo (CRM externo).
alter table public.dulabs_clientes_config
  add column if not exists forward_to_dumo boolean not null default false;

comment on column public.dulabs_clientes_config.forward_to_dumo is
  'true si este número reenvía webhooks a DuMo y la IA de dulabs queda en silencio (modo bandeja externa).';
