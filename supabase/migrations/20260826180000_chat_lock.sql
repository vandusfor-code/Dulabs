-- Candado real por conversación (phone_number_id + telefono_cliente): evita
-- que dos mensajes de la MISMA clienta, separados por más de los ~2.5s del
-- freno de ráfaga en app/webhook-dulabs/route.ts, disparen dos llamadas a la
-- IA en PARALELO -- cada una revisando disponibilidad e intentando agendar
-- por su cuenta, sin saber que la otra ya lo resolvió. Eso causaba que una
-- clienta recibiera "quedó agendada" seguido de "ya no hay espacio", cuando
-- en realidad ya tenía una cita real confirmada creada por el primer hilo.
--
-- Migración puramente aditiva: no toca ninguna tabla existente.

create table if not exists public.dulabs_chat_lock (
  phone_number_id text not null,
  telefono_cliente text not null,
  wamid text not null,
  bloqueado_at timestamptz not null default now(),
  primary key (phone_number_id, telefono_cliente)
);
