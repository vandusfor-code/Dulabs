-- Bloque 34 — REGISTRAR CLIENTES desde el panel (uno a uno o desde Excel).
--
-- El equipo registra a un cliente ANTES de que escriba: nombre (dulabs_clientes_conocidos, el mismo
-- que usa el asistente), modalidad (dulabs_catalogo_clientes_canal por su RPC, origen "asesora") y
-- esta FICHA:
--   * ya_compro: ya es cliente del negocio (compró antes, fuera del bot) => su primera compra por
--     el bot NO exige la compra inicial mayorista (Bloque 32b).
--   * registrado: lo creó el equipo (formulario o Excel).
-- Además, la función del listado (Bloque 33) incluye a los registrados, devuelve ya_compro /
-- registrado, usa primero el nombre conocido (el que corrige el equipo) y suma el filtro
-- "registrados"; "compraron" cuenta también a los clientes antiguos.
--
-- ADITIVA E IDEMPOTENTE (reemplaza solo la función del listado, misma firma). Solo service_role.
-- Rollback: volver a aplicar 20261202000000_dulabs_catalogo_clientes.sql (función anterior) y
--   drop table if exists public.dulabs_catalogo_clientes_ficha;

create table if not exists public.dulabs_catalogo_clientes_ficha (
  id_tenant uuid not null,
  phone_number_id text not null check (char_length(phone_number_id) between 1 and 64),
  wa_id text not null check (wa_id ~ '^[0-9]{6,20}$'),
  ya_compro boolean not null default false,
  registrado boolean not null default false,
  actualizado_por bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_catalogo_clientes_ficha_pk primary key (id_tenant, phone_number_id, wa_id)
);

alter table public.dulabs_catalogo_clientes_ficha enable row level security;
revoke all on public.dulabs_catalogo_clientes_ficha from anon, authenticated;

comment on table public.dulabs_catalogo_clientes_ficha is
  'Bloque 34: ficha del cliente puesta por el equipo (ya_compro: cliente antiguo, sin compra inicial mayorista; registrado: creado desde el panel). Solo service_role.';

-- Listado (Bloque 33) con los datos de la ficha.
create or replace function public.dulabs_catalogo_clientes_listar(
  p_tenant uuid,
  p_q text default null,
  p_filtro text default 'todos',
  p_limite integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with contactos as (
    select cc.phone_number_id as pn, cc.wa_id as wa
    from dulabs_catalogo_clientes_canal cc
    where cc.id_tenant = p_tenant
    union
    select p.contacto_phone_number_id, p.contacto_wa_id
    from dulabs_catalogo_pedidos p
    where p.id_tenant = p_tenant and p.contacto_wa_id is not null
    union
    select fi.phone_number_id, fi.wa_id
    from dulabs_catalogo_clientes_ficha fi
    where fi.id_tenant = p_tenant
  ),
  filas as (
    select
      c.pn,
      c.wa,
      coalesce(cc.canal, ult.canal) as canal,
      cc.origen,
      -- El nombre conocido (lo corrige el equipo o lo guarda el pedido confirmado) va primero.
      coalesce(k.nombre, nom.cliente_nombre) as nombre,
      coalesce(agg.pedidos, 0) as pedidos,
      coalesce(agg.compras, 0) as compras,
      coalesce(agg.total_comprado, 0) as total_comprado,
      ult.pedido_publico as ultimo_pedido,
      ult.estado as ultimo_estado,
      ult.etapa as ultima_etapa,
      ult.created_at as ultimo_pedido_at,
      ciu.ciudad,
      least(cc.created_at, agg.primer_pedido) as primer_contacto,
      greatest(msg.ultimo_mensaje, agg.ultima_actividad, cc.updated_at) as ultimo_contacto,
      (n.wa_id is not null and n.nota <> '') as tiene_nota,
      coalesce(fi.ya_compro, false) as ya_compro,
      coalesce(fi.registrado, false) as registrado
    from contactos c
    left join dulabs_catalogo_clientes_canal cc
      on cc.id_tenant = p_tenant and cc.phone_number_id = c.pn and cc.wa_id = c.wa
    left join lateral (
      select
        count(*) filter (where p.confirmado_at is not null) as pedidos,
        count(*) filter (where p.estado in ('confirmed', 'completed')) as compras,
        sum(p.total) filter (where p.estado in ('confirmed', 'completed')) as total_comprado,
        min(p.created_at) as primer_pedido,
        max(p.updated_at) as ultima_actividad
      from dulabs_catalogo_pedidos p
      where p.id_tenant = p_tenant and p.contacto_phone_number_id = c.pn and p.contacto_wa_id = c.wa
    ) agg on true
    left join lateral (
      select p.pedido_publico, p.estado, p.etapa, p.canal, p.created_at
      from dulabs_catalogo_pedidos p
      where p.id_tenant = p_tenant and p.contacto_phone_number_id = c.pn and p.contacto_wa_id = c.wa
        and p.estado not in ('draft', 'validated')
      order by p.created_at desc
      limit 1
    ) ult on true
    left join lateral (
      select p.cliente_nombre
      from dulabs_catalogo_pedidos p
      where p.id_tenant = p_tenant and p.contacto_phone_number_id = c.pn and p.contacto_wa_id = c.wa
        and p.cliente_nombre is not null
      order by p.created_at desc
      limit 1
    ) nom on true
    left join lateral (
      select p.ciudad
      from dulabs_catalogo_pedidos p
      where p.id_tenant = p_tenant and p.contacto_phone_number_id = c.pn and p.contacto_wa_id = c.wa
        and p.ciudad is not null
      order by p.created_at desc
      limit 1
    ) ciu on true
    left join dulabs_clientes_conocidos k
      on k.id_tenant = p_tenant and k.phone_number_id = c.pn and k.telefono_cliente = c.wa
    left join lateral (
      select max(m.created_at) as ultimo_mensaje
      from dulabs_mensajes_log m
      where m.phone_number_id = c.pn and m.telefono_cliente = c.wa
    ) msg on true
    left join dulabs_catalogo_clientes_notas n
      on n.id_tenant = p_tenant and n.phone_number_id = c.pn and n.wa_id = c.wa
    left join dulabs_catalogo_clientes_ficha fi
      on fi.id_tenant = p_tenant and fi.phone_number_id = c.pn and fi.wa_id = c.wa
  ),
  filtradas as (
    select *
    from filas f
    where (
        coalesce(p_filtro, 'todos') = 'todos'
        or (p_filtro = 'detal' and f.canal = 'retail')
        or (p_filtro = 'mayorista' and f.canal = 'wholesale')
        or (p_filtro = 'compraron' and (f.compras > 0 or f.ya_compro))
        or (p_filtro = 'sin_compras' and f.compras = 0 and not f.ya_compro)
        or (p_filtro = 'registrados' and f.registrado)
      )
      and (
        nullif(btrim(coalesce(p_q, '')), '') is null
        or f.nombre ilike '%' || btrim(p_q) || '%'
        or (regexp_replace(p_q, '\D', '', 'g') <> '' and f.wa like '%' || regexp_replace(p_q, '\D', '', 'g') || '%')
      )
  ),
  pagina as (
    select *
    from filtradas
    order by ultimo_contacto desc nulls last, wa
    limit greatest(1, least(coalesce(p_limite, 25), 5000))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtradas),
    'filas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'phone_number_id', pn,
        'wa_id', wa,
        'canal', canal,
        'origen', origen,
        'nombre', nombre,
        'pedidos', pedidos,
        'compras', compras,
        'total_comprado', total_comprado,
        'ultimo_pedido', ultimo_pedido,
        'ultimo_estado', ultimo_estado,
        'ultima_etapa', ultima_etapa,
        'ultimo_pedido_at', ultimo_pedido_at,
        'ciudad', ciudad,
        'primer_contacto', primer_contacto,
        'ultimo_contacto', ultimo_contacto,
        'tiene_nota', tiene_nota,
        'ya_compro', ya_compro,
        'registrado', registrado
      ) order by ultimo_contacto desc nulls last, wa)
      from pagina
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.dulabs_catalogo_clientes_listar(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.dulabs_catalogo_clientes_listar(uuid, text, text, integer, integer) to service_role;

comment on function public.dulabs_catalogo_clientes_listar(uuid, text, text, integer, integer) is
  'Bloques 33-34: clientes del negocio (clasificados, con pedidos o registrados por el equipo), con búsqueda, filtro y página. Solo service_role.';
