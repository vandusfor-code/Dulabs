-- Bloque 23 — pedidos de conversación ABANDONADOS (sin confirmar, 72 h sin cambios) vencen con las
-- funciones REALES de la BD (sin migración nueva: la máquina de estados ya lo permitía):
--   pending_confirmation / draft / validated -> expired  SOLO por el sistema, con evento y motivo;
--   el agente no puede vencer (ni "sacar de en medio") un pedido; un pedido con asesora (handoff)
--   no vence por esta vía; vencer una propuesta no toca stock ni deja reservas.
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta filas de prueba; negocio FICTICIO nuevo en
-- cada corrida). Misma preparación que supabase/tests/20261116000000_dulabs_catalogo_reservas_stock.test.sql.

\set ON_ERROR_STOP 1

create or replace function pg_temp.pedido(p_tenant uuid, p_publico text, p_estado text, p_lineas jsonb) returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := public.dulabs_catalogo_pedido_crear(
    jsonb_build_object('id_tenant', p_tenant, 'pedido_publico', p_publico, 'canal', 'retail', 'origen', 'agent',
      'estado', p_estado, 'clave_idempotencia', 'clave-' || p_publico,
      'contacto_phone_number_id', 'PN-1', 'contacto_wa_id', '573001112233', 'lineas', p_lineas),
    jsonb_build_object('event_id', 'evt_' || left(md5(p_publico), 26), 'tipo', 'order.created', 'payload', '{}'::jsonb));
  return (r -> 'pedido' ->> 'id')::uuid;
end $$;

create or replace function pg_temp.mover(p_tenant uuid, p_id uuid, p_desde text, p_hacia text, p_actor text, p_motivo text) returns jsonb language sql as $$
  select public.dulabs_catalogo_pedido_transicion(p_tenant, p_id, p_desde, p_hacia, p_actor, '{}'::jsonb,
    jsonb_build_object('event_id', 'evt_' || left(md5(p_id::text || p_hacia || p_actor), 26), 'tipo', 'order.status_changed', 'motivo', p_motivo, 'payload', '{}'::jsonb))
$$;

do $$
declare
  a constant uuid := gen_random_uuid();
  ref text;
  o_prop uuid; o_draft uuid; o_hand uuid;
  n integer;
begin
  insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, controla_stock, activo) values (a, 'Anillo abandonado', 1000, 5, true, true);
  select referencia into ref from public.dulabs_inventario_productos where id_tenant = a;

  o_prop := pg_temp.pedido(a, 'DL-ORD-ABND01', 'pending_confirmation', jsonb_build_array(jsonb_build_object('reference', ref, 'product_name', 'x', 'quantity', 2, 'unit_price', 1000, 'subtotal', 2000)));
  o_draft := pg_temp.pedido(a, 'DL-ORD-ABND02', 'draft', '[]'::jsonb);
  o_hand := pg_temp.pedido(a, 'DL-ORD-ABND03', 'pending_confirmation', jsonb_build_array(jsonb_build_object('reference', ref, 'product_name', 'x', 'quantity', 1, 'unit_price', 1000, 'subtotal', 1000)));
  perform pg_temp.mover(a, o_hand, 'pending_confirmation', 'handoff', 'agent', 'pago');

  -- 1. El agente NO puede vencer una propuesta (solo el sistema).
  begin
    perform pg_temp.mover(a, o_prop, 'pending_confirmation', 'expired', 'agent', 'abandoned');
    raise exception 'FAIL 1 el agente venció un pedido';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  if (select estado from public.dulabs_catalogo_pedidos where id = o_prop) <> 'pending_confirmation' then raise exception 'FAIL 1b estado'; end if;
  raise notice 'PASS 1 el agente no puede vencer una propuesta';

  -- 2. El sistema vence la propuesta abandonada: evento con motivo, sin reservas ni stock tocado.
  perform pg_temp.mover(a, o_prop, 'pending_confirmation', 'expired', 'system', 'abandoned');
  if (select estado from public.dulabs_catalogo_pedidos where id = o_prop) <> 'expired' then raise exception 'FAIL 2a no venció'; end if;
  select count(*) into n from public.dulabs_catalogo_pedido_eventos where pedido_id = o_prop and estado_hacia = 'expired' and actor = 'system' and motivo = 'abandoned';
  if n <> 1 then raise exception 'FAIL 2b evento (%)', n; end if;
  if exists (select 1 from public.dulabs_catalogo_reservas where pedido_id = o_prop) then raise exception 'FAIL 2c reserva'; end if;
  if (select stock from public.dulabs_inventario_productos where id_tenant = a) <> 5 then raise exception 'FAIL 2d stock'; end if;
  raise notice 'PASS 2 propuesta abandonada -> expired (sistema, con evento), sin tocar stock';

  -- 3. Borrador abandonado también; repetir la transición (dos crons a la vez) no hace nada.
  perform pg_temp.mover(a, o_draft, 'draft', 'expired', 'system', 'abandoned');
  if (select estado from public.dulabs_catalogo_pedidos where id = o_draft) <> 'expired' then raise exception 'FAIL 3a'; end if;
  -- Compare-and-set: el pedido ya no está en 'draft' => la función devuelve null y no escribe nada.
  if pg_temp.mover(a, o_draft, 'draft', 'expired', 'system', 'abandoned') is not null then
    raise exception 'FAIL 3b la segunda transición escribió algo';
  end if;
  select count(*) into n from public.dulabs_catalogo_pedido_eventos where pedido_id = o_draft and estado_hacia = 'expired';
  if n <> 1 then raise exception 'FAIL 3c eventos (%)', n; end if;
  raise notice 'PASS 3 borrador abandonado -> expired; una segunda vez no escribe (compare-and-set)';

  -- 4. Un pedido con asesora (handoff) no vence por esta vía.
  begin
    perform pg_temp.mover(a, o_hand, 'handoff', 'expired', 'system', 'abandoned');
    raise exception 'FAIL 4 venció un pedido con asesora';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  if (select estado from public.dulabs_catalogo_pedidos where id = o_hand) <> 'handoff' then raise exception 'FAIL 4b'; end if;
  raise notice 'PASS 4 un pedido con asesora no vence solo';
end;
$$;
