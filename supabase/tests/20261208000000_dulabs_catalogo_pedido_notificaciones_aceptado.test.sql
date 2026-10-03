-- Prueba SQL de 20261208000000_dulabs_catalogo_pedido_notificaciones_aceptado.sql (Fase 3B.8).
-- Se corre SOLO en una BD local efímera (nunca en producción), con las migraciones anteriores ya aplicadas.
-- Cada bloque lanza una excepción si algo no se cumple. Todo queda dentro de una transacción que se revierte.
begin;

do $$
declare
  t uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid();
  p2 uuid := gen_random_uuid();
  fallo boolean;
begin
  -- Pedidos mínimos para colgar las notificaciones (solo las columnas que exige la tabla de pedidos).
  insert into public.dulabs_catalogo_pedidos (id, id_tenant, pedido_publico, canal, origen, estado, clave_idempotencia)
  values (p1, t, 'DL-ORD-AAAAAA', 'retail', 'agent', 'draft', 'clave-0001'), (p2, t, 'DL-ORD-BBBBBB', 'retail', 'agent', 'draft', 'clave-0002');

  -- 1) 'aceptado' ahora es un tipo válido.
  insert into public.dulabs_catalogo_pedido_notificaciones (id_tenant, pedido_id, pedido_publico, tipo, estado_hacia) values (t, p1, 'DL-ORD-AAAAAA', 'aceptado', 'confirmado');

  -- 2) La clave única (pedido, tipo) sigue: la segunda fila igual se rechaza (idempotencia).
  fallo := false;
  begin
    insert into public.dulabs_catalogo_pedido_notificaciones (id_tenant, pedido_id, pedido_publico, tipo, estado_hacia) values (t, p1, 'DL-ORD-AAAAAA', 'aceptado', 'confirmado');
  exception when unique_violation then fallo := true;
  end;
  if not fallo then raise exception 'la clave única (pedido, tipo) ya no protege contra la repetición'; end if;

  -- 3) Los tipos de siempre siguen valiendo, incluidos rechazado y cancelado (los del aviso tras una decisión).
  insert into public.dulabs_catalogo_pedido_notificaciones (id_tenant, pedido_id, pedido_publico, tipo, estado_hacia)
  select t, p2, 'DL-ORD-BBBBBB', x, 'x' from unnest(array['pago_recibido', 'en_preparacion', 'enviado', 'entregado', 'completado', 'cancelado', 'rechazado']) as x;

  -- 4) Un tipo desconocido sigue rechazado por el CHECK.
  fallo := false;
  begin
    insert into public.dulabs_catalogo_pedido_notificaciones (id_tenant, pedido_id, pedido_publico, tipo, estado_hacia) values (t, p1, 'DL-ORD-AAAAAA', 'inventado', 'x');
  exception when check_violation then fallo := true;
  end;
  if not fallo then raise exception 'el CHECK de tipo dejó pasar un tipo desconocido'; end if;

  -- 5) Exactamente UN CHECK de tipo (la migración no deja dos).
  if (select count(*) from pg_constraint where conrelid = 'public.dulabs_catalogo_pedido_notificaciones'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%pago_recibido%') <> 1 then
    raise exception 'debe haber exactamente un CHECK de tipo';
  end if;

  raise notice 'OK: tipo aceptado, clave única y CHECK de tipo';
end $$;

rollback;
