-- Coexistencia v2 · pausa humana POR CHAT + rename prompt_ia → prompt_sistema.
-- Ejecutar en Supabase (SQL Editor) después de 20260713150000.

-- 1. Renombrar prompt_ia → prompt_sistema (idempotente)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dulabs_clientes_config'
      and column_name = 'prompt_ia'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dulabs_clientes_config'
      and column_name = 'prompt_sistema'
  ) then
    alter table public.dulabs_clientes_config
      rename column prompt_ia to prompt_sistema;
  end if;
end $$;

-- 2. Tabla de pausas por conversación (negocio ↔ cliente final)
create table if not exists public.dulabs_pausas_chat (
  id bigint generated always as identity primary key,
  phone_number_id text not null,
  telefono_cliente text not null,
  pausado_hasta timestamptz not null,
  created_at timestamptz not null default now(),
  constraint dulabs_pausas_chat_unico_chat unique (phone_number_id, telefono_cliente)
);

create index if not exists dulabs_pausas_chat_expira_idx
  on public.dulabs_pausas_chat (pausado_hasta);

-- Solo el backend (service role) puede leer/escribir.
alter table public.dulabs_pausas_chat enable row level security;

comment on table public.dulabs_pausas_chat is
  'Pausas de IA por conversación: cuando el dueño responde desde su celular (eco de coexistencia), la IA guarda silencio en ESE chat hasta pausado_hasta.';
