-- DuLabs Catálogo — Bloque 19: RESERVA DE STOCK al confirmar un pedido (transaccional y atómica).
--
-- Regla del negocio (decidida por el responsable): el stock se descuenta AL CONFIRMAR.
--   confirmed               => se apartan las unidades (todo o nada; nunca negativo)
--   completed               => la reserva se CONSUME (venta cerrada: el stock ya estaba descontado)
--   cancelled / expired     => la reserva se LIBERA (el stock vuelve)
--   confirmed sin cerrar    => vence a las 72 h: el pedido pasa a 'expired' y el stock vuelve
--                              (dulabs_catalogo_reservas_vencer, cron horario)
--   handoff                 => la reserva se mantiene; la asesora la cierra (completar/cancelar)
--
-- Cómo se garantiza:
--   * TRIGGER sobre dulabs_catalogo_pedidos: cualquier cambio de estado (agente, asesora, cron,
--     SQL) aplica la regla EN LA MISMA TRANSACCIÓN. Si no alcanza el stock, se lanza CT010 y la
--     transición completa se revierte: nunca queda un pedido confirmado sin su stock.
--   * Descuento atómico: UPDATE … SET stock = stock - n WHERE stock >= n (Postgres re-evalúa la
--     condición tras el bloqueo de fila); el CHECK (stock >= 0) existente es la última barrera.
--   * Sin deadlocks: los productos se bloquean siempre en orden de referencia.
--   * Idempotente: la reserva se AJUSTA a las líneas (lo ya reservado no se vuelve a descontar);
--     liberar/consumir solo toca reservas activas. UNIQUE (pedido, producto).
--   * Solo productos del MISMO negocio del pedido y con controla_stock = true.
--   * Cada cambio de stock queda en la auditoría existente del catálogo (dulabs_catalogo_eventos,
--     sin actor: lo hizo el sistema) y en dulabs_catalogo_reservas (qué pedido, cuánto, cuándo).
--
-- 100 % ADITIVO: tabla y funciones nuevas + un trigger nuevo sobre la tabla de pedidos del
-- catálogo. dulabs_catalogo_pedido_transicion_valida se reemplaza agregando UNA transición
-- (confirmed -> expired, system). Requiere 20261105000000 (catálogo) y 20261108000000 (pedidos).
-- Pedidos confirmados ANTES de esta migración no tienen reserva: no se les descuenta nada
-- retroactivamente (ver la verificación en PENDING_MIGRATIONS.md).
--
-- Rollback:
--   drop trigger if exists dulabs_catalogo_pedido_reservas on public.dulabs_catalogo_pedidos;
--   drop trigger if exists dulabs_catalogo_pedido_reservas_insert on public.dulabs_catalogo_pedidos;
--   drop function if exists public.dulabs_catalogo_pedido_reservas_trigger();
--   drop function if exists public.dulabs_catalogo_reservas_vencer(integer);
--   drop function if exists public.dulabs_catalogo_reservas_ajustar(uuid, uuid, jsonb);
--   drop function if exists public.dulabs_catalogo_reservas_cerrar(uuid, text, text);
--   drop function if exists public.dulabs_catalogo_reserva_ttl();
--   drop table if exists public.dulabs_catalogo_reservas;   -- (antes: devolver el stock de las activas si se quiere)
--   y volver a correr dulabs_catalogo_pedido_transicion_valida de 20261108000000.
--
-- Se aplica manualmente en el SQL Editor de Supabase (ver PENDING_MIGRATIONS.md).

begin;

create table if not exists public.dulabs_catalogo_reservas (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  pedido_id uuid not null,
  producto_id uuid not null,
  referencia text not null check (referencia ~ '^[A-Z]{1,6}-[0-9]{6,}$'),
  cantidad integer not null check (cantidad between 1 and 9999),
  estado text not null default 'activa' check (estado in ('activa', 'liberada', 'consumida')),
  vence_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cerrada_at timestamptz,
  motivo text check (motivo is null or motivo in ('cancelled', 'expired', 'completed', 'reopened', 'line_removed')),
  constraint dulabs_catalogo_reservas_pedido_producto unique (pedido_id, producto_id),
  constraint dulabs_catalogo_reservas_pedido_fk foreign key (pedido_id, id_tenant)
    references public.dulabs_catalogo_pedidos (id, id_tenant) on delete cascade,
  constraint dulabs_catalogo_reservas_cierre check ((estado = 'activa') = (cerrada_at is null))
);

create index if not exists dulabs_catalogo_reservas_activas_vence_idx
  on public.dulabs_catalogo_reservas (vence_at) where estado = 'activa';
create index if not exists dulabs_catalogo_reservas_producto_idx
  on public.dulabs_catalogo_reservas (id_tenant, producto_id) where estado = 'activa';

comment on table public.dulabs_catalogo_reservas is
  'Bloque 19 — stock apartado por pedidos del catálogo (confirmado => activa; completado => consumida; cancelado/vencido => liberada y el stock vuelve). Lo escribe SOLO el trigger de dulabs_catalogo_pedidos. Solo service_role.';

alter table public.dulabs_catalogo_reservas enable row level security;
revoke all on table public.dulabs_catalogo_reservas from anon, authenticated;

-- Tiempo que un pedido confirmado puede quedar sin cerrar antes de devolver su stock.
create or replace function public.dulabs_catalogo_reserva_ttl()
returns interval
language sql
immutable
as $$ select interval '72 hours' $$;

-- Libera (el stock vuelve) o consume (venta cerrada) TODAS las reservas activas de un pedido.
create or replace function public.dulabs_catalogo_reservas_cerrar(p_pedido uuid, p_estado text, p_motivo text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  n integer := 0;
begin
  if p_estado not in ('liberada', 'consumida') then
    raise exception 'estado de cierre inválido: %', p_estado using errcode = '22023';
  end if;
  -- Orden de referencia: el mismo orden de bloqueo que la reserva (sin deadlocks).
  for r in
    select * from public.dulabs_catalogo_reservas
     where pedido_id = p_pedido and estado = 'activa'
     order by referencia
     for update
  loop
    if p_estado = 'liberada' then
      update public.dulabs_inventario_productos
         set stock = stock + r.cantidad, updated_at = now()
       where id = r.producto_id and id_tenant = r.id_tenant;
    end if;
    update public.dulabs_catalogo_reservas
       set estado = p_estado, motivo = p_motivo, cerrada_at = now(), updated_at = now()
     where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Ajusta las reservas activas de un pedido a sus líneas (todo o nada).
--   falta stock         => CT010 (detail: [{referencia, pedido, disponible}])
--   producto no vendible => CT011 (detail: [referencias])
create or replace function public.dulabs_catalogo_reservas_ajustar(p_tenant uuid, p_pedido uuid, p_lineas jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_prod record;
  v_delta integer;
  v_faltantes jsonb := '[]'::jsonb;
  v_no_vendibles jsonb := '[]'::jsonb;
begin
  for r in
    with pedidas as (
      select upper(l ->> 'reference') as referencia, sum((l ->> 'quantity')::integer) as cantidad
        from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) l
       where (l ->> 'quantity') ~ '^[0-9]+$' and (l ->> 'quantity')::integer > 0
       group by 1
    ),
    reservadas as (
      select referencia, cantidad, producto_id from public.dulabs_catalogo_reservas
       where pedido_id = p_pedido and estado = 'activa'
    )
    select coalesce(p.referencia, x.referencia) as referencia,
           coalesce(p.cantidad, 0) as quiere,
           coalesce(x.cantidad, 0) as tiene,
           x.producto_id as producto_reservado
      from pedidas p
      full join reservadas x on x.referencia = p.referencia
     order by 1
  loop
    continue when r.quiere = r.tiene;

    if r.quiere < r.tiene then
      -- Menos unidades (o línea quitada): devuelve la diferencia.
      update public.dulabs_inventario_productos
         set stock = stock + (r.tiene - r.quiere), updated_at = now()
       where id = r.producto_reservado and id_tenant = p_tenant;
      if r.quiere = 0 then
        update public.dulabs_catalogo_reservas
           set estado = 'liberada', motivo = 'line_removed', cerrada_at = now(), updated_at = now()
         where pedido_id = p_pedido and producto_id = r.producto_reservado and estado = 'activa';
      else
        update public.dulabs_catalogo_reservas
           set cantidad = r.quiere, updated_at = now()
         where pedido_id = p_pedido and producto_id = r.producto_reservado and estado = 'activa';
      end if;
      continue;
    end if;

    -- Más unidades: bloquea el producto (del MISMO negocio) y descuenta si alcanza.
    select id, activo, controla_stock, stock into v_prod
      from public.dulabs_inventario_productos
     where id_tenant = p_tenant and referencia = r.referencia
     for update;
    if not found or not v_prod.activo then
      v_no_vendibles := v_no_vendibles || to_jsonb(r.referencia);
      continue;
    end if;
    continue when not v_prod.controla_stock;  -- sin control de inventario: no hay nada que apartar

    v_delta := r.quiere - r.tiene;
    update public.dulabs_inventario_productos
       set stock = stock - v_delta, updated_at = now()
     where id = v_prod.id and stock >= v_delta;
    if not found then
      v_faltantes := v_faltantes || jsonb_build_object('referencia', r.referencia, 'pedido', r.quiere, 'disponible', v_prod.stock + r.tiene);
      continue;
    end if;

    insert into public.dulabs_catalogo_reservas (id_tenant, pedido_id, producto_id, referencia, cantidad, vence_at)
    values (p_tenant, p_pedido, v_prod.id, r.referencia, r.quiere, now() + public.dulabs_catalogo_reserva_ttl())
    on conflict on constraint dulabs_catalogo_reservas_pedido_producto do update
      set cantidad = excluded.cantidad,
          estado = 'activa',
          motivo = null,
          cerrada_at = null,
          vence_at = case when public.dulabs_catalogo_reservas.estado = 'activa' then public.dulabs_catalogo_reservas.vence_at else excluded.vence_at end,
          updated_at = now();
  end loop;

  -- Todo o nada: cualquier faltante revierte TODO (la transición del pedido incluida).
  if jsonb_array_length(v_no_vendibles) > 0 then
    raise exception using errcode = 'CT011', message = 'producto_no_disponible', detail = v_no_vendibles::text;
  end if;
  if jsonb_array_length(v_faltantes) > 0 then
    raise exception using errcode = 'CT010', message = 'stock_insuficiente', detail = v_faltantes::text;
  end if;
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
    -- cancelled / expired (y, por defensa, cualquier vuelta a borrador): el stock vuelve.
    perform public.dulabs_catalogo_reservas_cerrar(new.id, 'liberada',
      case when new.estado in ('cancelled', 'expired') then new.estado else 'reopened' end);
  end if;
  return null;
end;
$$;

drop trigger if exists dulabs_catalogo_pedido_reservas on public.dulabs_catalogo_pedidos;
create trigger dulabs_catalogo_pedido_reservas
  after update of estado, lineas on public.dulabs_catalogo_pedidos
  for each row
  when (old.estado is distinct from new.estado or old.lineas is distinct from new.lineas)
  execute function public.dulabs_catalogo_pedido_reservas_trigger();

drop trigger if exists dulabs_catalogo_pedido_reservas_insert on public.dulabs_catalogo_pedidos;
create trigger dulabs_catalogo_pedido_reservas_insert
  after insert on public.dulabs_catalogo_pedidos
  for each row
  when (new.estado = 'confirmed')
  execute function public.dulabs_catalogo_pedido_reservas_trigger();

-- Máquina de estados: + confirmed -> expired (system) para el vencimiento de la reserva.
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
      ('pending_confirmation', 'cancelled', 'human'),
      ('pending_confirmation', 'expired', 'system'),
      ('confirmed', 'handoff', 'system'), ('confirmed', 'handoff', 'agent'), ('confirmed', 'handoff', 'human'),
      ('confirmed', 'completed', 'human'), ('confirmed', 'cancelled', 'human'),
      ('confirmed', 'expired', 'system'),
      ('handoff', 'confirmed', 'human'), ('handoff', 'completed', 'human'), ('handoff', 'cancelled', 'human')
    ) as t(desde, hacia, actor)
    where t.desde = p_desde and t.hacia = p_hacia and t.actor = p_actor
  );
$$;

-- Vence los pedidos CONFIRMADOS cuya reserva pasó su plazo: pasan a 'expired' y el trigger
-- devuelve el stock. Idempotente (evento con id determinista) y seguro en paralelo (skip locked).
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

revoke all on function public.dulabs_catalogo_reserva_ttl() from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_reservas_cerrar(uuid, text, text) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_reservas_ajustar(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedido_reservas_trigger() from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_reservas_vencer(integer) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedido_transicion_valida(text, text, text) from public, anon, authenticated;
grant execute on function public.dulabs_catalogo_reservas_vencer(integer) to service_role;
grant execute on function public.dulabs_catalogo_pedido_transicion_valida(text, text, text) to service_role;

commit;
