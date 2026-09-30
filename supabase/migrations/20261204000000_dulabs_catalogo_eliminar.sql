-- Bloque 35 — ELIMINAR pedidos y clientes desde el panel (solo administradores; lo valida la API).
--
-- * Pedido: solo si ya está CERRADO (completado, cancelado, rechazado o vencido). Un pedido activo
--   (confirmado o con asesora) tiene stock apartado: primero se cancela (el stock vuelve) y luego se
--   elimina. Se borran el pedido, sus reservas (ya liberadas o vendidas: el stock no cambia), su
--   historial y sus notificaciones.
-- * Cliente: todo lo del contacto en ESTE negocio y número: sus pedidos (ninguno activo), su
--   modalidad y su historial, su nombre conocido, su ficha, su nota y la conversación del asistente
--   (si vuelve a escribir, empieza de cero). El chat del Inbox (dulabs_mensajes_log) NO se toca.
--
-- Antes de borrar, una COPIA de todo lo borrado queda en dulabs_catalogo_eliminados (auditoría; se
-- puede recuperar a mano). Los historiales son inmutables: SOLO estas funciones pueden borrarlos, con
-- una marca de la transacción (dulabs.eliminacion_autorizada) que ningún otro borrado tiene.
--
-- ADITIVA E IDEMPOTENTE. Solo service_role.
-- Rollback: drop function dulabs_catalogo_pedido_eliminar(uuid, text, bigint);
--           drop function dulabs_catalogo_cliente_eliminar(uuid, text, text, bigint);
--           volver a aplicar las funciones *_inmutables de 20261108000000 y 20261120000000.

create table if not exists public.dulabs_catalogo_eliminados (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  tipo text not null check (tipo in ('pedido', 'cliente')),
  -- Pedido: su número público. Cliente: "<phone_number_id>_<wa_id>".
  referencia text not null check (char_length(referencia) between 1 and 120),
  datos jsonb not null,
  miembro_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists dulabs_catalogo_eliminados_tenant_idx on public.dulabs_catalogo_eliminados (id_tenant, created_at desc);

alter table public.dulabs_catalogo_eliminados enable row level security;
revoke all on public.dulabs_catalogo_eliminados from anon, authenticated;

comment on table public.dulabs_catalogo_eliminados is
  'Bloque 35: copia de cada pedido o cliente eliminado desde el panel (quién y cuándo). Inmutable. Solo service_role.';

create or replace function public.dulabs_catalogo_eliminados_inmutables()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'dulabs_catalogo_eliminados es inmutable' using errcode = '42501';
end;
$$;

drop trigger if exists dulabs_catalogo_eliminados_inmutables on public.dulabs_catalogo_eliminados;
create trigger dulabs_catalogo_eliminados_inmutables
  before update or delete on public.dulabs_catalogo_eliminados
  for each row execute function public.dulabs_catalogo_eliminados_inmutables();

-- Historiales: siguen inmutables; solo un borrado AUTORIZADO por las funciones de abajo pasa.
create or replace function public.dulabs_catalogo_pedido_eventos_inmutables()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and current_setting('dulabs.eliminacion_autorizada', true) = 'on' then
    return old;
  end if;
  raise exception 'dulabs_catalogo_pedido_eventos es inmutable' using errcode = '42501';
end;
$$;

create or replace function public.dulabs_catalogo_clientes_canal_eventos_inmutables()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and current_setting('dulabs.eliminacion_autorizada', true) = 'on' then
    return old;
  end if;
  raise exception 'dulabs_catalogo_clientes_canal_eventos es inmutable' using errcode = '42501';
end;
$$;

-- Eliminar UN pedido cerrado del negocio.
--   resultado: eliminado | activo (con su estado) | no_encontrado
create or replace function public.dulabs_catalogo_pedido_eliminar(p_tenant uuid, p_pedido text, p_miembro bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v public.dulabs_catalogo_pedidos%rowtype;
begin
  select * into v from public.dulabs_catalogo_pedidos
  where id_tenant = p_tenant and pedido_publico = p_pedido
  for update;
  if not found then
    return jsonb_build_object('resultado', 'no_encontrado');
  end if;
  if v.estado not in ('completed', 'cancelled', 'rejected', 'expired') then
    return jsonb_build_object('resultado', 'activo', 'estado', v.estado);
  end if;

  insert into public.dulabs_catalogo_eliminados (id_tenant, tipo, referencia, datos, miembro_id)
  values (p_tenant, 'pedido', v.pedido_publico, jsonb_build_object(
    'pedido', to_jsonb(v),
    'eventos', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.dulabs_catalogo_pedido_eventos e where e.id_tenant = p_tenant and e.pedido_id = v.id), '[]'::jsonb),
    'reservas', coalesce((select jsonb_agg(to_jsonb(r)) from public.dulabs_catalogo_reservas r where r.id_tenant = p_tenant and r.pedido_id = v.id), '[]'::jsonb)
  ), p_miembro);

  perform set_config('dulabs.eliminacion_autorizada', 'on', true);
  delete from public.dulabs_catalogo_pedidos where id = v.id and id_tenant = p_tenant;
  perform set_config('dulabs.eliminacion_autorizada', 'off', true);

  return jsonb_build_object('resultado', 'eliminado', 'pedido', v.pedido_publico);
end;
$$;

revoke all on function public.dulabs_catalogo_pedido_eliminar(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.dulabs_catalogo_pedido_eliminar(uuid, text, bigint) to service_role;

-- Eliminar UN cliente (contacto de un número del negocio).
--   resultado: eliminado (pedidos borrados) | pedidos_activos (cuántos) | no_encontrado
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

revoke all on function public.dulabs_catalogo_cliente_eliminar(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.dulabs_catalogo_cliente_eliminar(uuid, text, text, bigint) to service_role;
