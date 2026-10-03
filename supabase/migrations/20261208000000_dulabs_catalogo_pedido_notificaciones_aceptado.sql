-- Fase 3B.8 — el aviso al cliente cuando el equipo ACEPTA un pedido pendiente de aceptación.
--
-- La tabla dulabs_catalogo_pedido_notificaciones (Bloque 31) es el REGISTRO y el CANDADO de idempotencia de lo que se le
-- escribe al cliente: una fila por (pedido, tipo), con clave única. Los tipos "cancelado" y "rechazado" ya existen (los usa
-- también el aviso tras rechazar o cancelar un pedido pendiente de aceptación); solo falta "aceptado".
--
-- Esta migración SOLO amplía el CHECK de `tipo` con 'aceptado'. No toca filas, columnas, índices, la clave única ni políticas.
--   * Sin ella, el aviso de "aceptado" no puede registrarse: el código lo trata como "no disponible" y NO envía nada (el pedido
--     queda aceptado igual; rechazar y cancelar no dependen de ella).
--   * Idempotente: se puede correr dos veces (quita el CHECK de tipos y lo vuelve a crear).
--   * Si la tabla todavía no existe (migración 20261130000000 sin aplicar), no hace nada.
--
-- NO se aplicó en producción: la aplica el dueño junto con el aprovisionamiento de ASLC (Fase 3B.9).
-- Rollback: supabase/rollbacks/20261208000000_dulabs_catalogo_pedido_notificaciones_aceptado.down.sql

do $$
declare
  c record;
begin
  if to_regclass('public.dulabs_catalogo_pedido_notificaciones') is null then
    raise notice 'dulabs_catalogo_pedido_notificaciones no existe: nada que ampliar (aplicar antes 20261130000000)';
    return;
  end if;

  -- El CHECK de `tipo` (cualquiera que sea su nombre): se reconoce por los tipos que lista.
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.dulabs_catalogo_pedido_notificaciones'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%pago_recibido%'
  loop
    execute format('alter table public.dulabs_catalogo_pedido_notificaciones drop constraint %I', c.conname);
  end loop;

  alter table public.dulabs_catalogo_pedido_notificaciones
    add constraint dulabs_catalogo_pedido_notificaciones_tipo_check
    check (tipo in ('pago_recibido', 'en_preparacion', 'enviado', 'entregado', 'completado', 'cancelado', 'rechazado', 'aceptado'));
end $$;
