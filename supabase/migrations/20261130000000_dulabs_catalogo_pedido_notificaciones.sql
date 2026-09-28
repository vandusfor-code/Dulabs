-- Bloque 31 — NOTIFICACIONES AUTOMÁTICAS DE ESTADO DE PEDIDOS POR WHATSAPP.
--
-- Cuando alguien del equipo cambia el estado de un pedido en Dashboard -> Pedidos, el backend (sin
-- IA) le escribe al cliente por WhatsApp. Esta tabla es el REGISTRO y el CANDADO de idempotencia:
--
--   * UNA fila por (pedido, tipo). Una transición concreta ("enviado", "pago_recibido"…) ocurre una
--     sola vez en la vida de un pedido (las etapas solo avanzan), así que la clave única garantiza
--     que un doble clic, una recarga, un reintento o dos pestañas NUNCA envíen dos mensajes.
--   * estado: pendiente -> enviando -> enviada | fallida | ventana_vencida | desconocido | omitida.
--     Un reintento toma la fila con compare-and-set (de fallida/ventana_vencida a enviando).
--   * Guarda estado anterior/nuevo, canal, message_id de Meta, código y mensaje de error, intentos,
--     la persona del equipo y las fechas: soporte ve qué pasó con cada notificación.
--
-- ADITIVA E IDEMPOTENTE: solo crea esta tabla (RLS activo, sin políticas: solo service_role). No toca
-- pedidos, eventos, mensajes ni otra tabla. Sin ella, cambiar el estado funciona igual y el panel
-- dice que la notificación no está disponible (nunca falla la acción).
--
-- Rollback: drop table if exists public.dulabs_catalogo_pedido_notificaciones;

create table if not exists public.dulabs_catalogo_pedido_notificaciones (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  pedido_id uuid not null references public.dulabs_catalogo_pedidos (id) on delete cascade,
  pedido_publico text not null check (pedido_publico ~ '^DL-ORD-[0-9A-HJKMNP-TV-Z]{6}$'),
  tipo text not null check (tipo in ('pago_recibido', 'en_preparacion', 'enviado', 'entregado', 'completado', 'cancelado', 'rechazado')),
  estado_desde text check (estado_desde is null or char_length(estado_desde) <= 40),
  estado_hacia text not null check (char_length(estado_hacia) <= 40),
  canal text not null default 'whatsapp' check (canal = 'whatsapp'),
  phone_number_id text check (phone_number_id is null or char_length(phone_number_id) <= 64),
  telefono_cliente text check (telefono_cliente is null or telefono_cliente ~ '^[0-9]{6,20}$'),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviando', 'enviada', 'fallida', 'ventana_vencida', 'desconocido', 'omitida')),
  motivo text check (motivo is null or char_length(motivo) <= 60),
  error_codigo text check (error_codigo is null or char_length(error_codigo) <= 40),
  error_mensaje text check (error_mensaje is null or char_length(error_mensaje) <= 300),
  message_id text check (message_id is null or char_length(message_id) <= 200),
  intentos integer not null default 0 check (intentos >= 0 and intentos <= 20),
  miembro_id bigint,
  enviada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_catalogo_pedido_notificaciones_unica unique (pedido_id, tipo)
);

create index if not exists dulabs_catalogo_pedido_notificaciones_tenant_idx
  on public.dulabs_catalogo_pedido_notificaciones (id_tenant, created_at desc);

alter table public.dulabs_catalogo_pedido_notificaciones enable row level security;
revoke all on public.dulabs_catalogo_pedido_notificaciones from anon, authenticated;

comment on table public.dulabs_catalogo_pedido_notificaciones is
  'Bloque 31: notificación por WhatsApp de cada cambio de estado de un pedido (una por pedido y tipo; idempotente). Solo service_role.';
