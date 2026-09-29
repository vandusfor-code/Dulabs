-- Bloque 33 — módulo CLIENTES (joyería / catálogo): un cliente por contacto de WhatsApp.
--
-- No duplica datos: el listado se ARMA con lo que ya existe (sin tabla de clientes):
--   * contactos: los que eligieron detal / por mayor (dulabs_catalogo_clientes_canal) o hicieron
--     algún pedido (dulabs_catalogo_pedidos con contacto). Quien solo saludó no aparece.
--   * nombre: el del último pedido con nombre; si no, el conocido (dulabs_clientes_conocidos).
--   * pedidos (confirmados alguna vez), compras (confirmados o completados) y total comprado.
--   * último pedido, ciudad del último pedido a domicilio, primer y último contacto.
-- Lo único nuevo que se guarda es la NOTA interna del equipo (dulabs_catalogo_clientes_notas),
-- con compare-and-set por versión (dos personas editando no se pisan).
--
-- ADITIVA E IDEMPOTENTE. Solo service_role (RLS sin políticas; la API autoriza por negocio).
-- Rollback:
--   drop function if exists public.dulabs_catalogo_clientes_listar(uuid, text, text, integer, integer);
--   drop table if exists public.dulabs_catalogo_clientes_notas;

create table if not exists public.dulabs_catalogo_clientes_notas (
  id_tenant uuid not null,
  phone_number_id text not null check (char_length(phone_number_id) between 1 and 64),
  wa_id text not null check (wa_id ~ '^[0-9]{6,20}$'),
  nota text not null check (char_length(nota) <= 1000),
  version integer not null default 1 check (version >= 1),
  actualizado_por bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_catalogo_clientes_notas_pk primary key (id_tenant, phone_number_id, wa_id)
);

alter table public.dulabs_catalogo_clientes_notas enable row level security;
revoke all on public.dulabs_catalogo_clientes_notas from anon, authenticated;

comment on table public.dulabs_catalogo_clientes_notas is
  'Bloque 33: nota interna del equipo sobre un cliente (contacto de WhatsApp). Una por contacto; versión para compare-and-set. Solo service_role.';

-- Listado de clientes del negocio: búsqueda (nombre o teléfono), filtro y página. Devuelve
-- {"total": n, "filas": [...]} con la página pedida, del más reciente al más antiguo.
--   p_filtro: todos | detal | mayorista | compraron | sin_compras
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
  ),
  filas as (
    select
      c.pn,
      c.wa,
      coalesce(cc.canal, ult.canal) as canal,
      cc.origen,
      coalesce(nom.cliente_nombre, k.nombre) as nombre,
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
      (n.wa_id is not null and n.nota <> '') as tiene_nota
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
  ),
  filtradas as (
    select *
    from filas f
    where (
        coalesce(p_filtro, 'todos') = 'todos'
        or (p_filtro = 'detal' and f.canal = 'retail')
        or (p_filtro = 'mayorista' and f.canal = 'wholesale')
        or (p_filtro = 'compraron' and f.compras > 0)
        or (p_filtro = 'sin_compras' and f.compras = 0)
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
        'tiene_nota', tiene_nota
      ) order by ultimo_contacto desc nulls last, wa)
      from pagina
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.dulabs_catalogo_clientes_listar(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.dulabs_catalogo_clientes_listar(uuid, text, text, integer, integer) to service_role;

comment on function public.dulabs_catalogo_clientes_listar(uuid, text, text, integer, integer) is
  'Bloque 33: clientes del negocio (contactos clasificados o con pedidos), con búsqueda, filtro y página. Solo service_role.';
