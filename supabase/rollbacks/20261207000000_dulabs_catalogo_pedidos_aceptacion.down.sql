-- ROLLBACK de 20261207000000_dulabs_catalogo_pedidos_aceptacion.sql (Fase 3B.1: pedido pendiente de aceptación).
--
-- Deja la BD EXACTAMENTE como estaba: restaura las funciones y CHECKs anteriores (las funciones, copiadas
-- textualmente de 20261122000000_dulabs_catalogo_pedidos_checkout.sql y 20261204000000_dulabs_catalogo_eliminar.sql;
-- el CHECK de la configuración, de 20261205000000_dulabs_agente_perfil_negocio.sql), borra lo nuevo y las columnas nuevas.
--
-- Se NIEGA a correr si ya hay datos de la Fase 3B (pedidos pendientes de aceptación o de oficina, documentos,
-- columnas nuevas con valor, eventos nuevos o configuración con oficina): borrarlos perdería información.
-- No es una migración (vive fuera de supabase/migrations a propósito). Se ejecuta a mano, en una transacción.
\set ON_ERROR_STOP on
begin;

do $$
begin
  if exists (select 1 from public.dulabs_catalogo_pedidos
              where estado = 'pending_acceptance' or tipo_entrega = 'oficina_transportadora'
                 or telefono_contacto is not null or departamento is not null or barrio is not null or oficina_transportadora is not null
                 or aviso_enviado_at is not null or respuesta_cliente_at is not null
                 or aceptacion_reserva_min is not null or aceptacion_vence_at is not null or confirmado_reserva_min is not null) then
    raise exception 'hay pedidos con datos de la Fase 3B: el rollback los perdería (revisarlos antes)';
  end if;
  if exists (select 1 from public.dulabs_catalogo_pedido_documentos) then
    raise exception 'hay documentos guardados: el rollback los borraría (revisarlos antes)';
  end if;
  if exists (select 1 from public.dulabs_catalogo_pedido_eventos where tipo in ('order.acceptance_notice_sent', 'order.customer_replied')) then
    raise exception 'hay eventos de aceptación en el historial: el rollback no puede restaurar el CHECK anterior';
  end if;
  if exists (select 1 from public.dulabs_catalogo_reservas where motivo = 'acceptance_expired') then
    raise exception 'hay reservas liberadas por vencimiento de la aceptación: el rollback no puede restaurar el CHECK anterior';
  end if;
  if exists (select 1 from public.dulabs_agente_runtime_config
              where checkout_opciones is not null
                and (jsonb_path_exists(checkout_opciones, '$.entregas[*] ? (@ == "oficina_transportadora")') or pg_column_size(checkout_opciones) > 8192)) then
    raise exception 'hay configuración con oficina de transportadora o de más de 8 KB: el rollback no puede restaurar el CHECK anterior';
  end if;
end $$;

-- 1. Lo nuevo, fuera
drop function if exists public.dulabs_catalogo_aceptacion_vencer(integer);
drop function if exists public.dulabs_catalogo_pedido_aceptacion_marca(uuid, text, text, text);
drop function if exists public.dulabs_catalogo_pedido_documentos_purgar(integer);
drop trigger if exists dulabs_catalogo_pedido_documentos_reglas on public.dulabs_catalogo_pedido_documentos;
drop function if exists public.dulabs_catalogo_pedido_documentos_reglas();
drop table if exists public.dulabs_catalogo_pedido_documentos;

-- 2. Funciones existentes: versiones anteriores (textuales)
create or replace function public.dulabs_catalogo_pedido_transicion_valida(p_desde text, p_hacia text, p_actor text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select exists (
    select 1 from (values
      ('draft', 'validated', 'system'),
      ('draft', 'handoff', 'system'), ('draft', 'handoff', 'agent'), ('draft', 'handoff', 'human'),
      ('draft', 'cancelled', 'system'), ('draft', 'cancelled', 'human'),
      ('draft', 'expired', 'system'),
      ('validated', 'pending_confirmation', 'system'), ('validated', 'pending_confirmation', 'agent'),
      ('validated', 'draft', 'system'),
      ('validated', 'handoff', 'system'), ('validated', 'handoff', 'agent'), ('validated', 'handoff', 'human'),
      ('validated', 'cancelled', 'system'), ('validated', 'cancelled', 'human'),
      ('validated', 'expired', 'system'),
      ('pending_confirmation', 'confirmed', 'agent'), ('pending_confirmation', 'confirmed', 'human'),
      ('pending_confirmation', 'draft', 'system'),
      ('pending_confirmation', 'handoff', 'system'), ('pending_confirmation', 'handoff', 'agent'), ('pending_confirmation', 'handoff', 'human'),
      ('pending_confirmation', 'cancelled', 'human'), ('pending_confirmation', 'cancelled', 'system'),
      ('pending_confirmation', 'expired', 'system'),
      ('confirmed', 'handoff', 'system'), ('confirmed', 'handoff', 'agent'), ('confirmed', 'handoff', 'human'),
      ('confirmed', 'completed', 'human'), ('confirmed', 'cancelled', 'human'), ('confirmed', 'rejected', 'human'),
      ('confirmed', 'expired', 'system'),
      ('handoff', 'confirmed', 'human'), ('handoff', 'completed', 'human'), ('handoff', 'cancelled', 'human'), ('handoff', 'rejected', 'human')
    ) as t(desde, hacia, actor)
    where t.desde = p_desde and t.hacia = p_hacia and t.actor = p_actor
  );
$$;

create or replace function public.dulabs_catalogo_pedido_transicion(
  p_tenant uuid, p_pedido uuid, p_desde text, p_hacia text, p_actor text, p_cambios jsonb, p_evento jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_fila public.dulabs_catalogo_pedidos;
begin
  if p_desde = p_hacia then
    if p_desde not in ('draft', 'validated', 'pending_confirmation') then
      raise exception 'actualización no permitida en estado %', p_desde using errcode = '22023';
    end if;
  elsif not public.dulabs_catalogo_pedido_transicion_valida(p_desde, p_hacia, p_actor) then
    raise exception 'transición no permitida: % -> % (%)', p_desde, p_hacia, p_actor using errcode = '22023';
  end if;

  update public.dulabs_catalogo_pedidos p set
    estado = p_hacia,
    lineas = case when p_cambios ? 'lineas' then p_cambios->'lineas' else p.lineas end,
    total_unidades = case when p_cambios ? 'total_unidades' then (p_cambios->>'total_unidades')::integer else p.total_unidades end,
    total = case when p_cambios ? 'total' then (p_cambios->>'total')::bigint else p.total end,
    unidades_sin_precio = case when p_cambios ? 'unidades_sin_precio' then (p_cambios->>'unidades_sin_precio')::integer else p.unidades_sin_precio end,
    problemas = case when p_cambios ? 'problemas' then p_cambios->'problemas' else p.problemas end,
    confirmacion = case when p_cambios ? 'confirmacion' then (case when jsonb_typeof(p_cambios->'confirmacion') = 'object' then p_cambios->'confirmacion' else null end) else p.confirmacion end,
    handoff = case when p_cambios ? 'handoff' then (case when jsonb_typeof(p_cambios->'handoff') = 'object' then p_cambios->'handoff' else null end) else p.handoff end,
    contacto_phone_number_id = case when p_cambios ? 'contacto_phone_number_id' then p_cambios->>'contacto_phone_number_id' else p.contacto_phone_number_id end,
    contacto_wa_id = case when p_cambios ? 'contacto_wa_id' then p_cambios->>'contacto_wa_id' else p.contacto_wa_id end,
    -- Bloque 27: datos del checkout (solo al confirmar; el trigger de reglas los protege después).
    checkout = case when p_cambios ? 'checkout' then (p_cambios->>'checkout')::boolean else p.checkout end,
    cliente_nombre = case when p_cambios ? 'cliente_nombre' then p_cambios->>'cliente_nombre' else p.cliente_nombre end,
    metodo_pago = case when p_cambios ? 'metodo_pago' then p_cambios->>'metodo_pago' else p.metodo_pago end,
    estado_pago = case when p_cambios ? 'estado_pago' then p_cambios->>'estado_pago' else p.estado_pago end,
    tipo_entrega = case when p_cambios ? 'tipo_entrega' then p_cambios->>'tipo_entrega' else p.tipo_entrega end,
    direccion = case when p_cambios ? 'direccion' then p_cambios->>'direccion' else p.direccion end,
    ciudad = case when p_cambios ? 'ciudad' then p_cambios->>'ciudad' else p.ciudad end,
    referencia_entrega = case when p_cambios ? 'referencia_entrega' then p_cambios->>'referencia_entrega' else p.referencia_entrega end,
    etapa = case when p_cambios ? 'etapa' then p_cambios->>'etapa' else p.etapa end,
    confirmado_at = case when p_cambios ? 'confirmado_at' then (p_cambios->>'confirmado_at')::timestamptz else p.confirmado_at end,
    updated_at = now()
  where p.id = p_pedido
    and p.id_tenant = p_tenant
    and p.estado = p_desde
    and (
      not (p_cambios ? 'contacto_wa_id')
      or p.contacto_wa_id is null
      or (p.contacto_wa_id = p_cambios->>'contacto_wa_id' and p.contacto_phone_number_id = p_cambios->>'contacto_phone_number_id')
    )
  returning * into v_fila;

  if v_fila.id is null then
    return null;
  end if;

  if p_evento is not null and jsonb_typeof(p_evento) = 'object' then
    insert into public.dulabs_catalogo_pedido_eventos (event_id, id_tenant, pedido_id, tipo, estado_desde, estado_hacia, actor, motivo, payload, miembro_id)
    values (p_evento->>'event_id', v_fila.id_tenant, v_fila.id, p_evento->>'tipo', p_desde, p_hacia, p_actor,
            left(p_evento->>'motivo', 500), coalesce(p_evento->'payload', '{}'::jsonb), nullif(p_evento->>'miembro_id', '')::bigint)
    on conflict on constraint dulabs_catalogo_pedido_eventos_event_id do nothing;
  end if;

  return to_jsonb(v_fila);
end;
$$;

create or replace function public.dulabs_catalogo_pedido_reservas_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.estado = 'confirmed' then
    perform public.dulabs_catalogo_reservas_ajustar(new.id_tenant, new.id, new.lineas);
  elsif new.estado = 'handoff' then
    -- La asesora tiene el pedido: la reserva sigue; si cambian las líneas, se ajusta.
    if tg_op = 'UPDATE' and old.lineas is distinct from new.lineas
       and exists (select 1 from public.dulabs_catalogo_reservas where pedido_id = new.id and estado = 'activa') then
      perform public.dulabs_catalogo_reservas_ajustar(new.id_tenant, new.id, new.lineas);
    end if;
  elsif new.estado = 'completed' then
    perform public.dulabs_catalogo_reservas_cerrar(new.id, 'consumida', 'completed');
  elsif tg_op = 'UPDATE' then
    -- cancelled / rejected / expired (y, por defensa, cualquier vuelta a borrador): el stock vuelve.
    perform public.dulabs_catalogo_reservas_cerrar(new.id, 'liberada',
      case when new.estado in ('cancelled', 'expired', 'rejected') then new.estado else 'reopened' end);
  end if;
  return null;
end;
$$;

create or replace function public.dulabs_catalogo_pedidos_checkout_reglas()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not old.checkout then
    return new;
  end if;
  -- Confirmado = inmutable en productos, precio, modalidad y datos del checkout.
  if (new.checkout, new.lineas, new.total, new.canal, new.cliente_nombre, new.metodo_pago, new.tipo_entrega, new.direccion, new.ciudad, new.referencia_entrega, new.confirmado_at, new.contacto_wa_id)
     is distinct from
     (old.checkout, old.lineas, old.total, old.canal, old.cliente_nombre, old.metodo_pago, old.tipo_entrega, old.direccion, old.ciudad, old.referencia_entrega, old.confirmado_at, old.contacto_wa_id) then
    raise exception 'el pedido % ya está confirmado: sus productos y datos no se editan', old.pedido_publico using errcode = '42501';
  end if;
  -- La atención (asesora) es de la conversación: un pedido del checkout nunca pasa a 'handoff'.
  if new.estado = 'handoff' and old.estado is distinct from 'handoff' then
    raise exception 'el pedido % sigue su propio ciclo: la asesora atiende la conversación', old.pedido_publico using errcode = '22023';
  end if;
  -- Etapa: solo hacia adelante, de a un paso, y solo mientras el pedido está confirmado.
  if new.etapa is distinct from old.etapa then
    if old.estado <> 'confirmed' or new.estado <> 'confirmed'
       or not ((old.etapa = 'confirmado' and new.etapa = 'en_preparacion')
            or (old.etapa = 'en_preparacion' and new.etapa = 'enviado' and old.tipo_entrega = 'domicilio')
            or (old.etapa = 'en_preparacion' and new.etapa = 'entregado' and old.tipo_entrega = 'tienda')
            or (old.etapa = 'enviado' and new.etapa = 'entregado')) then
      raise exception 'etapa no permitida: % -> % (pedido %)', old.etapa, new.etapa, old.estado using errcode = '22023';
    end if;
  end if;
  -- El pago solo pasa de pendiente a recibido, mientras el pedido está confirmado (en cualquier etapa).
  if new.estado_pago is distinct from old.estado_pago
     and not (old.estado_pago = 'pendiente' and new.estado_pago = 'recibido' and old.estado = 'confirmed' and new.estado = 'confirmed') then
    raise exception 'estado de pago no permitido: % -> %', old.estado_pago, new.estado_pago using errcode = '22023';
  end if;
  if new.estado is distinct from old.estado then
    -- Completar = entregado y pagado.
    if new.estado = 'completed' and not (old.etapa = 'entregado' and old.estado_pago = 'recibido') then
      raise exception 'el pedido % aún no se puede completar (etapa %, pago %)', old.pedido_publico, old.etapa, old.estado_pago using errcode = '22023';
    end if;
    -- Cancelar / rechazar: solo antes de salir (confirmado o en preparación).
    if new.estado in ('cancelled', 'rejected') and old.estado = 'confirmed' and old.etapa not in ('confirmado', 'en_preparacion') then
      raise exception 'el pedido % ya salió (etapa %): no se cancela ni se rechaza', old.pedido_publico, old.etapa using errcode = '22023';
    end if;
    -- Vencer: solo lo que nadie tocó.
    if new.estado = 'expired' and old.estado = 'confirmed' and not (old.etapa = 'confirmado' and old.estado_pago = 'pendiente') then
      raise exception 'el pedido % ya está en gestión: no vence', old.pedido_publico using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.dulabs_catalogo_cliente_eliminar(p_tenant uuid, p_pn text, p_wa text, p_miembro bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  activos integer;
  pedidos integer;
  datos jsonb;
begin
  -- Solo números de ESTE negocio.
  if not exists (select 1 from public.dulabs_clientes_config where id_tenant = p_tenant and phone_number_id = p_pn) then
    return jsonb_build_object('resultado', 'no_encontrado');
  end if;

  -- Bloquea sus pedidos: nadie los confirma mientras se decide.
  perform 1 from public.dulabs_catalogo_pedidos
  where id_tenant = p_tenant and contacto_phone_number_id = p_pn and contacto_wa_id = p_wa
  for update;

  select count(*) into activos from public.dulabs_catalogo_pedidos
  where id_tenant = p_tenant and contacto_phone_number_id = p_pn and contacto_wa_id = p_wa
    and estado in ('confirmed', 'handoff');
  if activos > 0 then
    return jsonb_build_object('resultado', 'pedidos_activos', 'activos', activos);
  end if;

  datos := jsonb_build_object(
    'pedidos', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.dulabs_catalogo_pedidos p
      where p.id_tenant = p_tenant and p.contacto_phone_number_id = p_pn and p.contacto_wa_id = p_wa), '[]'::jsonb),
    'modalidad', (select to_jsonb(c) from public.dulabs_catalogo_clientes_canal c where c.id_tenant = p_tenant and c.phone_number_id = p_pn and c.wa_id = p_wa),
    'modalidad_historial', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.dulabs_catalogo_clientes_canal_eventos e
      where e.id_tenant = p_tenant and e.phone_number_id = p_pn and e.wa_id = p_wa), '[]'::jsonb),
    'nombre', (select to_jsonb(k) from public.dulabs_clientes_conocidos k where k.id_tenant = p_tenant and k.phone_number_id = p_pn and k.telefono_cliente = p_wa),
    'ficha', (select to_jsonb(f) from public.dulabs_catalogo_clientes_ficha f where f.id_tenant = p_tenant and f.phone_number_id = p_pn and f.wa_id = p_wa),
    'nota', (select to_jsonb(n) from public.dulabs_catalogo_clientes_notas n where n.id_tenant = p_tenant and n.phone_number_id = p_pn and n.wa_id = p_wa)
  );

  -- Nada de este contacto en el negocio (los valores ausentes son null de JSON: se quitan).
  if jsonb_strip_nulls(datos) - 'modalidad_historial' = '{"pedidos": []}'::jsonb then
    return jsonb_build_object('resultado', 'no_encontrado');
  end if;

  insert into public.dulabs_catalogo_eliminados (id_tenant, tipo, referencia, datos, miembro_id)
  values (p_tenant, 'cliente', p_pn || '_' || p_wa, datos, p_miembro);

  perform set_config('dulabs.eliminacion_autorizada', 'on', true);
  delete from public.dulabs_catalogo_pedidos where id_tenant = p_tenant and contacto_phone_number_id = p_pn and contacto_wa_id = p_wa;
  get diagnostics pedidos = row_count;
  delete from public.dulabs_catalogo_clientes_canal_eventos where id_tenant = p_tenant and phone_number_id = p_pn and wa_id = p_wa;
  delete from public.dulabs_catalogo_clientes_canal where id_tenant = p_tenant and phone_number_id = p_pn and wa_id = p_wa;
  delete from public.dulabs_clientes_conocidos where id_tenant = p_tenant and phone_number_id = p_pn and telefono_cliente = p_wa;
  delete from public.dulabs_catalogo_clientes_ficha where id_tenant = p_tenant and phone_number_id = p_pn and wa_id = p_wa;
  delete from public.dulabs_catalogo_clientes_notas where id_tenant = p_tenant and phone_number_id = p_pn and wa_id = p_wa;
  delete from public.dulabs_agente_conversaciones where id_tenant = p_tenant and phone_number_id = p_pn and wa_id = p_wa;
  perform set_config('dulabs.eliminacion_autorizada', 'off', true);

  return jsonb_build_object('resultado', 'eliminado', 'pedidos', pedidos);
end;
$$;

-- 3. CHECKs anteriores
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_aceptacion_no_es_venta;
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_aviso_respuesta;
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_oficina_completa;
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_telefono_contacto_check;
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_departamento_check;
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_barrio_check;
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_oficina_transportadora_check;
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_reserva_min_check;

alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_estado_check;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_estado_check
  check (estado in ('draft', 'validated', 'pending_confirmation', 'confirmed', 'handoff', 'completed', 'cancelled', 'expired', 'rejected'));

alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_tipo_entrega_check;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_tipo_entrega_check
  check (tipo_entrega is null or tipo_entrega in ('tienda', 'domicilio'));

alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_checkout_completo;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_checkout_completo
  check (
    not checkout
    or estado in ('draft', 'validated', 'pending_confirmation')
    or (cliente_nombre is not null and metodo_pago is not null and estado_pago is not null and tipo_entrega is not null
        and etapa is not null and confirmado_at is not null and contacto_wa_id is not null)
  );

alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_enviado_solo_domicilio;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_enviado_solo_domicilio
  check (etapa is distinct from 'enviado' or tipo_entrega = 'domicilio');

alter table public.dulabs_catalogo_reservas drop constraint if exists dulabs_catalogo_reservas_motivo_check;
alter table public.dulabs_catalogo_reservas add constraint dulabs_catalogo_reservas_motivo_check
  check (motivo is null or motivo in ('cancelled', 'expired', 'completed', 'reopened', 'line_removed', 'rejected'));

alter table public.dulabs_catalogo_pedido_eventos drop constraint if exists dulabs_catalogo_pedido_eventos_tipo_check;
alter table public.dulabs_catalogo_pedido_eventos add constraint dulabs_catalogo_pedido_eventos_tipo_check
  check (tipo in ('catalog.order_request.created', 'order.created', 'order.status_changed', 'order.handoff_requested', 'order.stage_changed', 'order.payment_changed'));

alter table public.dulabs_agente_runtime_config drop constraint if exists dulabs_agente_runtime_config_checkout_opciones_check;
alter table public.dulabs_agente_runtime_config add constraint dulabs_agente_runtime_config_checkout_opciones_check
  check (
    checkout_opciones is null
    or (
      jsonb_typeof(checkout_opciones) = 'object'
      and pg_column_size(checkout_opciones) <= 8192
      and jsonb_typeof(checkout_opciones -> 'entregas') = 'array'
      and jsonb_typeof(checkout_opciones -> 'pagos') = 'array'
      and not jsonb_path_exists(checkout_opciones, '$.entregas[*] ? (@ != "tienda" && @ != "domicilio")')
      and not jsonb_path_exists(checkout_opciones, '$.pagos[*].metodo ? (@ != "pago_en_tienda" && @ != "transferencia" && @ != "contra_entrega" && @ != "link_pago")')
    )
  );

-- 4. Columnas nuevas, fuera (vacías: verificado arriba)
alter table public.dulabs_catalogo_pedidos
  drop column if exists telefono_contacto,
  drop column if exists departamento,
  drop column if exists barrio,
  drop column if exists oficina_transportadora,
  drop column if exists aviso_enviado_at,
  drop column if exists respuesta_cliente_at,
  drop column if exists aceptacion_reserva_min,
  drop column if exists aceptacion_vence_at,
  drop column if exists confirmado_reserva_min;

-- 5. Permisos (como antes)
revoke all on function public.dulabs_catalogo_pedido_transicion_valida(text, text, text) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedido_transicion(uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedido_reservas_trigger() from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedidos_checkout_reglas() from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_cliente_eliminar(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.dulabs_catalogo_pedido_transicion_valida(text, text, text) to service_role;
grant execute on function public.dulabs_catalogo_pedido_transicion(uuid, uuid, text, text, text, jsonb, jsonb) to service_role;
grant execute on function public.dulabs_catalogo_cliente_eliminar(uuid, text, text, bigint) to service_role;

commit;
