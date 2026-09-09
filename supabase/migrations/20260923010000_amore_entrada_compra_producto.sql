-- AMORE (autorizado, Fase 3 -- flujo de compra de producto) -- amplía el
-- "puente" conversacional (dulabs_amore_entrada, Fases 9/1/2) con dos modos
-- nuevos para el flujo básico de compra por WhatsApp desde la tienda
-- (/amore/tienda). Migración puramente ADITIVA: no toca ninguna fila
-- existente, no borra ningún valor permitido de `modo`, no afecta a ningún
-- otro tenant (la tabla ya es exclusiva de AMORE).
--
-- 'compra_producto_opcion'  -- ya se saludó a la clienta y se le mostró el
--                              menú "1. Pagar producto / 2. Hablar con un
--                              asesor", esperando su elección.
-- 'compra_esperando_pago'   -- eligió "1", se le compartió el mensaje de
--                              métodos de pago (pendiente de definir) y se
--                              le pidió escribir "Ya pagué" al terminar.
--
-- producto_interes_nombre guarda el nombre del producto detectado (por el
-- link de la tienda o por texto libre) mientras dura el flujo, para poder
-- incluirlo en los mensajes al cliente y en la notificación a Jessica sin
-- tener que volver a preguntarlo. Nunca es una FK al producto real -- un
-- texto simple es suficiente para esta fase (spec: sin sobreingeniería) y
-- evita romper el flujo si el producto se renombra o se desactiva mientras
-- la clienta todavía está conversando.
--
-- Reversible: `alter table ... drop constraint ...` + recrear el CHECK
-- anterior (sin los dos modos de compra) y `alter table ... drop column
-- producto_interes_nombre` -- seguro mientras ninguna fila real tenga
-- todavía uno de estos dos modos (si ya lo tuviera, revertir el CHECK
-- fallaría, que es el comportamiento correcto de Postgres).

alter table public.dulabs_amore_entrada
  drop constraint if exists dulabs_amore_entrada_modo_check;

alter table public.dulabs_amore_entrada
  add constraint dulabs_amore_entrada_modo_check
  check (modo in (
    'inicio', 'gemini', 'atencion_humana',
    'registro_nombre', 'registro_dia', 'registro_mes',
    'compra_producto_opcion', 'compra_esperando_pago'
  ));

alter table public.dulabs_amore_entrada
  add column if not exists producto_interes_nombre text;

comment on column public.dulabs_amore_entrada.producto_interes_nombre is
  'Fase 3 (compra de producto) -- nombre del producto detectado (link de la tienda o texto libre) mientras modo está en compra_producto_opcion/compra_esperando_pago. Texto simple, no FK -- se usa solo para mostrarlo en mensajes y en la notificación a Jessica.';
