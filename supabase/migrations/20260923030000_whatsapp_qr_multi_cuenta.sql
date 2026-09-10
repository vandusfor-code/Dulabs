-- WhatsApp multi-cuenta (autorizado, Fase Final) — permite que un tenant
-- conecte hasta 2 cuentas de WhatsApp-QR/Baileys independientes ("slot" 1 y
-- 2), reutilizando EXACTAMENTE la misma tabla/estructura de siempre (nunca
-- se crea una tabla nueva). Aditivo y seguro para las filas ya existentes:
-- `slot` tiene default 1, así que cada sesión real de hoy (una fila por
-- tenant, incluida AMORE) queda intacta como su "WhatsApp principal" -- el
-- mismo comportamiento de siempre, cero migración de datos manual.
--
-- slot 1 ("WhatsApp principal") es la ÚNICA conexión que el bot/Flow
-- Engine/recordatorios/cumpleaños/fidelización usan (ver
-- worker/src/whatsapp-qr/socket-baileys.ts) -- eso NO cambia con esta
-- migración, es una decisión de código, no de esquema. slot 2 es una
-- segunda conexión real e independiente, pensada para atención manual desde
-- Chats (nunca automática).

alter table public.dulabs_whatsapp_qr_sesiones
  add column if not exists slot integer not null default 1;

alter table public.dulabs_whatsapp_qr_sesiones
  drop constraint if exists dulabs_whatsapp_qr_sesiones_slot_check;
alter table public.dulabs_whatsapp_qr_sesiones
  add constraint dulabs_whatsapp_qr_sesiones_slot_check check (slot in (1, 2));

-- La PK pasa de (id_tenant) a (id_tenant, slot) -- cada fila existente ya
-- tiene slot=1 (el default recién agregado), así que el par (id_tenant, 1)
-- sigue siendo único automáticamente: ningún dato se pierde ni se duplica.
alter table public.dulabs_whatsapp_qr_sesiones
  drop constraint if exists dulabs_whatsapp_qr_sesiones_pkey;
alter table public.dulabs_whatsapp_qr_sesiones
  add primary key (id_tenant, slot);

comment on column public.dulabs_whatsapp_qr_sesiones.slot is
  'Hasta 2 cuentas de WhatsApp-QR independientes por tenant. 1 = "WhatsApp principal" (única que usa el bot/Flow Engine/recordatorios/cumpleaños/fidelización). 2 = cuenta adicional, solo atención manual desde Chats, nunca automática.';

-- Chats AMORE (autorizado) — cada conversación queda asociada al slot por
-- el que realmente llegó, para que un mismo cliente escribiendo a las 2
-- cuentas conectadas nunca se mezcle en un solo hilo. Aditivo: default 1
-- preserva el comportamiento exacto de siempre para toda conversación ya
-- existente (todas llegaron por la única cuenta de hoy, el "principal").
alter table public.dulabs_chat_conversaciones
  add column if not exists slot integer not null default 1;

alter table public.dulabs_chat_conversaciones
  drop constraint if exists dulabs_chat_conversaciones_slot_check;
alter table public.dulabs_chat_conversaciones
  add constraint dulabs_chat_conversaciones_slot_check check (slot in (1, 2));

-- Reemplaza la restricción única (id_tenant, telefono) por
-- (id_tenant, telefono, slot): el mismo cliente escribiendo a las 2 cuentas
-- del tenant ahora puede tener 2 hilos independientes, nunca uno que se
-- pisa con el otro.
alter table public.dulabs_chat_conversaciones
  drop constraint if exists dulabs_chat_conversaciones_unica;
alter table public.dulabs_chat_conversaciones
  add constraint dulabs_chat_conversaciones_unica unique (id_tenant, telefono, slot);

comment on column public.dulabs_chat_conversaciones.slot is
  'Cuenta de WhatsApp-QR (1 o 2) por la que llegó esta conversación -- ver dulabs_whatsapp_qr_sesiones.slot. Evita que un mismo cliente escribiendo a las 2 cuentas del tenant se mezcle en un solo hilo.';
