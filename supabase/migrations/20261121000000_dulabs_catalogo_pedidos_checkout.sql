-- DuLabs Catálogo — Bloque 27: PEDIDO REAL (checkout conversacional) + gestión operativa del pedido.
--
-- Construye ENCIMA del motor existente (20261108 pedidos + 20261116 reservas); no duplica pedidos,
-- líneas, reservas ni eventos:
--
--   dulabs_catalogo_pedidos           + datos del checkout (nombre, entrega, dirección, pago), etapa
--                                       operativa, estado del pago y fecha de confirmación. Reglas en
--                                       la BD: domicilio exige dirección y ciudad; "enviado" solo con
--                                       domicilio; etapa y pago coherentes; un pedido de checkout
--                                       confirmado tiene todos sus datos; nada retrocede; productos y
--                                       datos del checkout no cambian después de confirmar.
--   estado 'rejected'                 terminal (la empresa rechaza): libera la reserva como cancelar.
--   pending_confirmation -> cancelled el SISTEMA puede cancelar una propuesta (el cliente cancela o
--                                       modifica el checkout); nunca toca stock (no había reserva).
--   dulabs_catalogo_pedido_eventos    + miembro_id (quién del equipo hizo el cambio) y el tipo
--                                       'order.stage_changed' (cambio de etapa operativa). Sigue inmutable.
--   dulabs_catalogo_pedido_etapa      ÚNICA forma de cambiar la etapa (compare-and-set + evento en la
--                                       misma transacción; repetir la misma etapa = sin cambio).
--   dulabs_catalogo_reservas_vencer   el vencimiento de 72 h ya NO aplica a pedidos con pago recibido
--                                       (los pedidos antiguos, sin estado de pago, siguen igual).
--   dulabs_agente_runtime_config.checkout_conversacional   interruptor por número (false por defecto).
--
-- Los pedidos antiguos no cambian de comportamiento: checkout = false (ninguna regla nueva les
-- aplica) y solo se completa su fecha de confirmación desde su propio historial. No borra datos.
-- Idempotente. Tablas con RLS y sin políticas: solo el backend (service_role).
--
-- Rollback (conceptual, en este orden): volver a correr las funciones de 20261116000000
-- (transicion_valida, reservas_trigger, reservas_vencer) y de 20261108000000 (pedido_transicion);
-- drop function dulabs_catalogo_pedido_etapa y dulabs_catalogo_pedidos_checkout_reglas (+ su trigger);
-- restaurar los CHECK de estado/tipo/motivo sin 'rejected' / 'order.stage_changed' (solo si no hay
-- filas con esos valores); las columnas nuevas pueden quedar (todas admiten null o tienen default).

begin;

-- ============================================================
-- 1. PEDIDOS: datos del checkout y operación
-- ============================================================
alter table public.dulabs_catalogo_pedidos
  add column if not exists checkout boolean not null default false,
  add column if not exists cliente_nombre text check (cliente_nombre is null or char_length(cliente_nombre) between 1 and 120),
  add column if not exists metodo_pago text check (metodo_pago is null or metodo_pago in ('pago_en_tienda', 'transferencia')),
  add column if not exists estado_pago text check (estado_pago is null or estado_pago in ('pendiente', 'recibido')),
  add column if not exists tipo_entrega text check (tipo_entrega is null or tipo_entrega in ('tienda', 'domicilio')),
  add column if not exists direccion text check (direccion is null or char_length(direccion) between 1 and 300),
  add column if not exists ciudad text check (ciudad is null or char_length(ciudad) between 1 and 80),
  add column if not exists referencia_entrega text check (referencia_entrega is null or char_length(referencia_entrega) between 1 and 300),
  add column if not exists etapa text check (etapa is null or etapa in ('pendiente_pago', 'pago_recibido', 'en_preparacion', 'enviado')),
  add column if not exists confirmado_at timestamptz;

comment on column public.dulabs_catalogo_pedidos.checkout is 'Bloque 27 — true: pedido confirmado por el checkout conversacional (tiene nombre, entrega, pago y etapa).';
comment on column public.dulabs_catalogo_pedidos.etapa is 'Bloque 27 — etapa operativa mientras el pedido está activo: pendiente_pago -> pago_recibido -> en_preparacion -> enviado (solo domicilio).';
comment on column public.dulabs_catalogo_pedidos.estado_pago is 'Bloque 27 — el MÉTODO de pago no es el pago: pendiente hasta que una persona registra el pago recibido.';

alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_estado_check;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_estado_check
  check (estado in ('draft', 'validated', 'pending_confirmation', 'confirmed', 'handoff', 'completed', 'cancelled', 'expired', 'rejected'));

alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_domicilio_completo;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_domicilio_completo
  check (tipo_entrega is distinct from 'domicilio' or (direccion is not null and ciudad is not null));

alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_enviado_solo_domicilio;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_enviado_solo_domicilio
  check (etapa is distinct from 'enviado' or tipo_entrega = 'domicilio');

-- Pendiente de pago <=> pago pendiente (más allá de esa etapa el pago ya se recibió).
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_etapa_pago;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_etapa_pago
  check (etapa is null or (estado_pago is not null and (etapa = 'pendiente_pago') = (estado_pago = 'pendiente')));

alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_checkout_completo;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_checkout_completo
  check (
    not checkout
    or estado in ('draft', 'validated', 'pending_confirmation')
    or (cliente_nombre is not null and metodo_pago is not null and estado_pago is not null and tipo_entrega is not null
        and etapa is not null and confirmado_at is not null and contacto_wa_id is not null)
  );

-- Panel "Pedidos": los del negocio ya confirmados, por actualización (y búsqueda por referencia).
create index if not exists dulabs_catalogo_pedidos_panel_idx
  on public.dulabs_catalogo_pedidos (id_tenant, updated_at desc, pedido_publico desc) where confirmado_at is not null;
create index if not exists dulabs_catalogo_pedidos_lineas_gin
  on public.dulabs_catalogo_pedidos using gin (lineas jsonb_path_ops);

-- ============================================================
-- 2. EVENTOS: quién del equipo y cambios de etapa
-- ============================================================
alter table public.dulabs_catalogo_pedido_eventos add column if not exists miembro_id bigint;

alter table public.dulabs_catalogo_pedido_eventos drop constraint if exists dulabs_catalogo_pedido_eventos_tipo_check;
alter table public.dulabs_catalogo_pedido_eventos add constraint dulabs_catalogo_pedido_eventos_tipo_check
  check (tipo in ('catalog.order_request.created', 'order.created', 'order.status_changed', 'order.handoff_requested', 'order.stage_changed'));

alter table public.dulabs_catalogo_reservas drop constraint if exists dulabs_catalogo_reservas_motivo_check;
alter table public.dulabs_catalogo_reservas add constraint dulabs_catalogo_reservas_motivo_check
  check (motivo is null or motivo in ('cancelled', 'expired', 'completed', 'reopened', 'line_removed', 'rejected'));

-- ============================================================
-- 3. MÁQUINA DE ESTADOS (espejo EXACTO de contrato.ts::TRANSITIONS)
-- ============================================================
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

-- ============================================================
-- 4. TRANSICIÓN (misma firma; + columnas del checkout y miembro_id en el evento)
-- ============================================================
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

-- ============================================================
-- 5. RESERVAS: 'rejected' libera como cancelar (motivo propio)
-- ============================================================
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

-- ============================================================
-- 6. REGLAS DEL CHECKOUT (antes de cada actualización de un pedido de checkout)
-- ============================================================
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
  -- Etapa: solo hacia adelante, de a un paso, y solo mientras el pedido está activo.
  if new.etapa is distinct from old.etapa then
    if old.estado not in ('confirmed', 'handoff') or new.estado not in ('confirmed', 'handoff')
       or (old.etapa, new.etapa) not in (('pendiente_pago', 'pago_recibido'), ('pago_recibido', 'en_preparacion'), ('en_preparacion', 'enviado')) then
      raise exception 'etapa no permitida: % -> % (pedido %)', old.etapa, new.etapa, old.estado using errcode = '22023';
    end if;
  end if;
  -- El pago solo pasa de pendiente a recibido (y a la vez que la etapa).
  if new.estado_pago is distinct from old.estado_pago
     and not (old.estado_pago = 'pendiente' and new.estado_pago = 'recibido' and new.etapa = 'pago_recibido') then
    raise exception 'estado de pago no permitido: % -> %', old.estado_pago, new.estado_pago using errcode = '22023';
  end if;
  -- Completar exige haber terminado: enviado (domicilio) o en preparación (recoger en tienda).
  if new.estado = 'completed' and old.estado is distinct from 'completed'
     and not ((old.tipo_entrega = 'domicilio' and old.etapa = 'enviado') or (old.tipo_entrega = 'tienda' and old.etapa = 'en_preparacion')) then
    raise exception 'el pedido % aún no se puede completar (etapa %)', old.pedido_publico, old.etapa using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists dulabs_catalogo_pedidos_checkout_reglas on public.dulabs_catalogo_pedidos;
create trigger dulabs_catalogo_pedidos_checkout_reglas
  before update on public.dulabs_catalogo_pedidos
  for each row execute function public.dulabs_catalogo_pedidos_checkout_reglas();

-- ============================================================
-- 7. CAMBIO DE ETAPA (compare-and-set + evento, una transacción)
-- ============================================================
-- Devuelve {resultado: ok|sin_cambio|conflicto|no_encontrado, etapa, pedido}.
create or replace function public.dulabs_catalogo_pedido_etapa(
  p_tenant uuid, p_pedido text, p_desde text, p_hacia text, p_miembro bigint, p_motivo text, p_evento_id text
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v public.dulabs_catalogo_pedidos;
begin
  if (p_desde, p_hacia) not in (('pendiente_pago', 'pago_recibido'), ('pago_recibido', 'en_preparacion'), ('en_preparacion', 'enviado')) then
    raise exception 'etapa no permitida: % -> %', p_desde, p_hacia using errcode = '22023';
  end if;
  if p_miembro is null then
    raise exception 'solo una persona del equipo cambia la etapa' using errcode = '42501';
  end if;
  select * into v from public.dulabs_catalogo_pedidos where id_tenant = p_tenant and pedido_publico = p_pedido for update;
  if v.id is null then
    return jsonb_build_object('resultado', 'no_encontrado');
  end if;
  if not v.checkout then
    raise exception 'el pedido % no tiene etapas (no viene del checkout)', p_pedido using errcode = '22023';
  end if;
  if v.etapa = p_hacia then
    return jsonb_build_object('resultado', 'sin_cambio', 'etapa', v.etapa, 'pedido', to_jsonb(v));
  end if;
  if v.etapa is distinct from p_desde or v.estado not in ('confirmed', 'handoff') then
    return jsonb_build_object('resultado', 'conflicto', 'etapa', v.etapa, 'estado', v.estado);
  end if;
  update public.dulabs_catalogo_pedidos
     set etapa = p_hacia,
         estado_pago = case when p_hacia = 'pago_recibido' then 'recibido' else estado_pago end,
         updated_at = now()
   where id = v.id
  returning * into v;
  insert into public.dulabs_catalogo_pedido_eventos (event_id, id_tenant, pedido_id, tipo, estado_desde, estado_hacia, actor, motivo, payload, miembro_id)
  values (p_evento_id, v.id_tenant, v.id, 'order.stage_changed', p_desde, p_hacia, 'human', left(p_motivo, 500),
          jsonb_build_object('event_type', 'order.stage_changed', 'order_id', v.pedido_publico,
                             'transition', jsonb_build_object('from', p_desde, 'to', p_hacia, 'actor', 'human', 'reason', left(p_motivo, 500)),
                             'occurred_at', now()),
          p_miembro);
  return jsonb_build_object('resultado', 'ok', 'etapa', v.etapa, 'pedido', to_jsonb(v));
end;
$$;

-- ============================================================
-- 8. VENCIMIENTO: nunca un pedido con el pago ya recibido
-- ============================================================
create or replace function public.dulabs_catalogo_reservas_vencer(p_limite integer default 200)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
  n integer := 0;
begin
  for v in
    select p.* from public.dulabs_catalogo_pedidos p
     where p.estado = 'confirmed'
       and p.estado_pago is distinct from 'recibido'
       and exists (select 1 from public.dulabs_catalogo_reservas r
                    where r.pedido_id = p.id and r.estado = 'activa' and r.vence_at <= now())
     order by p.updated_at
     limit least(greatest(coalesce(p_limite, 200), 1), 1000)
     for update skip locked
  loop
    update public.dulabs_catalogo_pedidos
       set estado = 'expired', confirmacion = null, updated_at = now()
     where id = v.id and estado = 'confirmed';
    insert into public.dulabs_catalogo_pedido_eventos (event_id, id_tenant, pedido_id, tipo, estado_desde, estado_hacia, actor, motivo, payload)
    values ('evt_' || left(md5(v.id::text || ':reservation_expired'), 26), v.id_tenant, v.id, 'order.status_changed',
            'confirmed', 'expired', 'system', 'reservation_expired',
            jsonb_build_object('event_type', 'order.status_changed', 'order_id', v.pedido_publico,
                               'transition', jsonb_build_object('from', 'confirmed', 'to', 'expired', 'actor', 'system', 'reason', 'reservation_expired'),
                               'occurred_at', now()))
    on conflict on constraint dulabs_catalogo_pedido_eventos_event_id do nothing;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ============================================================
-- 9. FECHA DE CONFIRMACIÓN de los pedidos existentes (desde su propio historial; no toca updated_at)
-- ============================================================
update public.dulabs_catalogo_pedidos p
   set confirmado_at = e.primera
  from (select pedido_id, min(created_at) as primera
          from public.dulabs_catalogo_pedido_eventos
         where estado_hacia = 'confirmed'
         group by pedido_id) e
 where p.id = e.pedido_id and p.confirmado_at is null;

-- ============================================================
-- 10. INTERRUPTOR del checkout conversacional (por número; apagado por defecto)
-- ============================================================
alter table public.dulabs_agente_runtime_config
  add column if not exists checkout_conversacional boolean not null default false;

comment on column public.dulabs_agente_runtime_config.checkout_conversacional is
  'Bloque 27 — true: al pedir comprar, el backend conduce el checkout (nombre, entrega, pago, resumen, confirmación) y pasa a una asesora. false: como antes.';

-- ============================================================
-- 11. PERMISOS
-- ============================================================
revoke all on function public.dulabs_catalogo_pedido_transicion_valida(text, text, text) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedido_transicion(uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedido_reservas_trigger() from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedidos_checkout_reglas() from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedido_etapa(uuid, text, text, text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_reservas_vencer(integer) from public, anon, authenticated;
grant execute on function public.dulabs_catalogo_pedido_transicion_valida(text, text, text) to service_role;
grant execute on function public.dulabs_catalogo_pedido_transicion(uuid, uuid, text, text, text, jsonb, jsonb) to service_role;
grant execute on function public.dulabs_catalogo_pedido_etapa(uuid, text, text, text, bigint, text, text) to service_role;
grant execute on function public.dulabs_catalogo_reservas_vencer(integer) to service_role;

commit;
