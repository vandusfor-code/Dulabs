-- DuLabs Catálogo — Fase 7: pedidos estructurados (motor para WhatsApp y el agente).
--
-- Qué agrega (100 % ADITIVO; requiere 20261105000000_dulabs_catalogo_fase1.sql):
--
--   1. dulabs_catalogo_pedidos: el pedido canónico (lib/catalogo/pedidos/contrato.ts).
--      - Líneas resueltas por el BACKEND (referencia, nombre, cantidad, precio
--        del canal, subtotal) en jsonb: el pedido guarda lo que se propuso;
--        el catálogo sigue siendo la fuente de verdad actual.
--      - UNIQUE (id_tenant, clave_idempotencia): la misma solicitud (doble
--        toque, reintento de Meta, reintento de la IA) nunca crea dos pedidos.
--      - UNIQUE (id_tenant, pedido_publico): el DL-ORD-XXXXXX es único por negocio.
--      - Un pedido pertenece a UN negocio; su contacto es la conversación de
--        WhatsApp (número del negocio + wa_id del cliente).
--
--   2. dulabs_catalogo_pedido_eventos: bitácora INMUTABLE + outbox de eventos
--      canónicos (lib/catalogo/pedidos/eventos.ts). event_id UNIQUE = llave de
--      deduplicación. FK compuesta (pedido, tenant): un evento jamás puede
--      apuntar a un pedido de otro negocio.
--
--   3. Funciones TRANSACCIONALES (solo service_role):
--      - dulabs_catalogo_pedido_crear: inserta pedido + evento en una sola
--        transacción; idempotente por clave (devuelve el existente).
--      - dulabs_catalogo_pedido_transicion: compare-and-set del estado
--        (WHERE estado = esperado) + evento en la misma transacción. Valida la
--        transición y el actor con la MISMA tabla del dominio (defensa en
--        profundidad: aunque el código tuviera un error, la BD no acepta un
--        salto de estado no autorizado).
--
-- Lo que NO hace: no toca tablas existentes, no descuenta stock, no reserva,
-- no cobra. Sin esta migración, el código de la Fase 7 queda inactivo (la
-- tienda y el webhook se comportan exactamente como antes).
--
-- Rollback (si hiciera falta):
--   drop function if exists public.dulabs_catalogo_pedido_transicion(uuid, uuid, text, text, text, jsonb, jsonb);
--   drop function if exists public.dulabs_catalogo_pedido_crear(jsonb, jsonb);
--   drop function if exists public.dulabs_catalogo_pedido_transicion_valida(text, text, text);
--   drop table if exists public.dulabs_catalogo_pedido_eventos;
--   drop table if exists public.dulabs_catalogo_pedidos;
--
-- Se aplica manualmente en el SQL Editor de Supabase (ver PENDING_MIGRATIONS.md).

begin;

-- ============================================================
-- 1. PEDIDOS
-- ============================================================
create table if not exists public.dulabs_catalogo_pedidos (
  id uuid primary key default gen_random_uuid(),
  id_tenant uuid not null,
  pedido_publico text not null check (pedido_publico ~ '^DL-ORD-[0-9A-HJKMNP-TV-Z]{6}$'),
  canal text not null check (canal in ('retail', 'wholesale')),
  origen text not null check (origen in ('catalog', 'whatsapp', 'agent', 'manual')),
  estado text not null default 'draft'
    check (estado in ('draft', 'validated', 'pending_confirmation', 'confirmed', 'handoff', 'completed', 'cancelled', 'expired')),
  clave_idempotencia text not null check (char_length(clave_idempotencia) between 8 and 200),
  -- sha256 de lo PEDIDO (referencias:cantidades): misma clave con otro contenido => conflicto, no "el pedido viejo".
  huella_solicitud text check (huella_solicitud is null or huella_solicitud ~ '^[0-9a-f]{64}$'),
  contacto_phone_number_id text check (contacto_phone_number_id is null or char_length(contacto_phone_number_id) between 1 and 64),
  contacto_wa_id text check (contacto_wa_id is null or contacto_wa_id ~ '^[0-9]{6,20}$'),
  lineas jsonb not null default '[]'::jsonb
    check (jsonb_typeof(lineas) = 'array' and jsonb_array_length(lineas) <= 60),
  total_unidades integer not null default 0 check (total_unidades >= 0),
  total bigint not null default 0 check (total >= 0),
  unidades_sin_precio integer not null default 0 check (unidades_sin_precio >= 0),
  moneda text not null default 'COP' check (moneda = 'COP'),
  problemas jsonb not null default '[]'::jsonb check (jsonb_typeof(problemas) = 'array'),
  confirmacion jsonb check (confirmacion is null or jsonb_typeof(confirmacion) = 'object'),
  handoff jsonb check (handoff is null or jsonb_typeof(handoff) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_catalogo_pedidos_contacto_par check ((contacto_phone_number_id is null) = (contacto_wa_id is null)),
  -- Un pedido confirmado/propuesto siempre tiene contacto (alguien a quien confirmarle).
  constraint dulabs_catalogo_pedidos_contacto_requerido check (estado in ('draft', 'validated', 'cancelled', 'expired') or contacto_wa_id is not null),
  constraint dulabs_catalogo_pedidos_idempotencia unique (id_tenant, clave_idempotencia),
  constraint dulabs_catalogo_pedidos_publico unique (id_tenant, pedido_publico),
  constraint dulabs_catalogo_pedidos_id_tenant unique (id, id_tenant)
);

create index if not exists dulabs_catalogo_pedidos_contacto_idx
  on public.dulabs_catalogo_pedidos (id_tenant, contacto_phone_number_id, contacto_wa_id, created_at desc);
create index if not exists dulabs_catalogo_pedidos_estado_idx
  on public.dulabs_catalogo_pedidos (id_tenant, estado, created_at desc);

comment on table public.dulabs_catalogo_pedidos is
  'Fase 7 — pedido canónico del catálogo (catálogo, WhatsApp, agente, manual). Líneas y totales resueltos por el backend. Idempotente por (id_tenant, clave_idempotencia). Solo service_role.';

alter table public.dulabs_catalogo_pedidos enable row level security;

-- ============================================================
-- 2. EVENTOS (bitácora inmutable + outbox)
-- ============================================================
create table if not exists public.dulabs_catalogo_pedido_eventos (
  id bigint generated always as identity primary key,
  event_id text not null check (event_id ~ '^evt_[0-9a-z]{26}$'),
  id_tenant uuid not null,
  pedido_id uuid not null,
  tipo text not null check (tipo in ('catalog.order_request.created', 'order.created', 'order.status_changed', 'order.handoff_requested')),
  estado_desde text,
  estado_hacia text,
  actor text check (actor is null or actor in ('system', 'agent', 'human')),
  motivo text check (motivo is null or char_length(motivo) <= 500),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  constraint dulabs_catalogo_pedido_eventos_event_id unique (event_id),
  constraint dulabs_catalogo_pedido_eventos_pedido_fk foreign key (pedido_id, id_tenant)
    references public.dulabs_catalogo_pedidos (id, id_tenant) on delete cascade
);

create index if not exists dulabs_catalogo_pedido_eventos_pedido_idx
  on public.dulabs_catalogo_pedido_eventos (id_tenant, pedido_id, id);

comment on table public.dulabs_catalogo_pedido_eventos is
  'Fase 7 — eventos canónicos de pedidos (versión 2). event_id único = deduplicación. Inmutable. Solo service_role.';

alter table public.dulabs_catalogo_pedido_eventos enable row level security;

create or replace function public.dulabs_catalogo_pedido_eventos_inmutables()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'dulabs_catalogo_pedido_eventos es inmutable' using errcode = '42501';
end;
$$;

drop trigger if exists dulabs_catalogo_pedido_eventos_inmutables on public.dulabs_catalogo_pedido_eventos;
create trigger dulabs_catalogo_pedido_eventos_inmutables
  before update or delete on public.dulabs_catalogo_pedido_eventos
  for each row execute function public.dulabs_catalogo_pedido_eventos_inmutables();

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
      ('pending_confirmation', 'cancelled', 'human'),
      ('pending_confirmation', 'expired', 'system'),
      ('confirmed', 'handoff', 'system'), ('confirmed', 'handoff', 'agent'), ('confirmed', 'handoff', 'human'),
      ('confirmed', 'completed', 'human'), ('confirmed', 'cancelled', 'human'),
      ('handoff', 'confirmed', 'human'), ('handoff', 'completed', 'human'), ('handoff', 'cancelled', 'human')
    ) as t(desde, hacia, actor)
    where t.desde = p_desde and t.hacia = p_hacia and t.actor = p_actor
  );
$$;

-- ============================================================
-- 4. CREAR (pedido + evento, una transacción, idempotente)
-- ============================================================
-- p_pedido: {id_tenant, pedido_publico, canal, origen, estado, clave_idempotencia, huella_solicitud,
--            contacto_phone_number_id, contacto_wa_id, lineas, total_unidades,
--            total, unidades_sin_precio, problemas, confirmacion, created_at}
-- p_evento: {event_id, tipo, payload}  (payload = evento canónico v2 ya armado por el backend;
--            created_at viaja en el pedido para que el evento y la fila digan la misma hora)
-- Devuelve {creado: bool, pedido: <fila>}. Si ya existía (misma clave), devuelve
-- ese pedido y NO escribe otro evento.
create or replace function public.dulabs_catalogo_pedido_crear(p_pedido jsonb, p_evento jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_fila public.dulabs_catalogo_pedidos;
begin
  insert into public.dulabs_catalogo_pedidos (
    id_tenant, pedido_publico, canal, origen, estado, clave_idempotencia, huella_solicitud,
    contacto_phone_number_id, contacto_wa_id, lineas, total_unidades, total,
    unidades_sin_precio, problemas, confirmacion, created_at, updated_at
  ) values (
    (p_pedido->>'id_tenant')::uuid,
    p_pedido->>'pedido_publico',
    p_pedido->>'canal',
    p_pedido->>'origen',
    p_pedido->>'estado',
    p_pedido->>'clave_idempotencia',
    nullif(p_pedido->>'huella_solicitud', ''),
    nullif(p_pedido->>'contacto_phone_number_id', ''),
    nullif(p_pedido->>'contacto_wa_id', ''),
    coalesce(p_pedido->'lineas', '[]'::jsonb),
    coalesce((p_pedido->>'total_unidades')::integer, 0),
    coalesce((p_pedido->>'total')::bigint, 0),
    coalesce((p_pedido->>'unidades_sin_precio')::integer, 0),
    coalesce(p_pedido->'problemas', '[]'::jsonb),
    case when jsonb_typeof(p_pedido->'confirmacion') = 'object' then p_pedido->'confirmacion' else null end,
    coalesce((p_pedido->>'created_at')::timestamptz, now()),
    coalesce((p_pedido->>'created_at')::timestamptz, now())
  )
  on conflict on constraint dulabs_catalogo_pedidos_idempotencia do nothing
  returning * into v_fila;

  if v_fila.id is null then
    select * into v_fila from public.dulabs_catalogo_pedidos
     where id_tenant = (p_pedido->>'id_tenant')::uuid
       and clave_idempotencia = p_pedido->>'clave_idempotencia';
    return jsonb_build_object('creado', false, 'pedido', to_jsonb(v_fila));
  end if;

  insert into public.dulabs_catalogo_pedido_eventos (event_id, id_tenant, pedido_id, tipo, estado_hacia, actor, payload)
  values (p_evento->>'event_id', v_fila.id_tenant, v_fila.id, p_evento->>'tipo', v_fila.estado, 'system',
          coalesce(p_evento->'payload', '{}'::jsonb))
  on conflict on constraint dulabs_catalogo_pedido_eventos_event_id do nothing;

  return jsonb_build_object('creado', true, 'pedido', to_jsonb(v_fila));
end;
$$;

-- ============================================================
-- 5. TRANSICIÓN (compare-and-set + evento, una transacción)
-- ============================================================
-- Cambia el estado SOLO si sigue siendo p_desde (compare-and-set) y la
-- transición está permitida para p_actor. p_cambios puede traer (y solo
-- esas claves se aplican): lineas, total_unidades, total, unidades_sin_precio,
-- problemas, confirmacion, handoff, contacto_phone_number_id, contacto_wa_id.
-- El contacto solo se puede FIJAR si el pedido no tenía (o es el mismo): una
-- solicitud del catálogo no puede ser reclamada por dos conversaciones.
-- p_desde = p_hacia: actualización sin cambio de estado (revalidar, reemitir
-- propuesta), permitida solo en draft/validated/pending_confirmation.
-- Devuelve la fila actualizada, o null si el estado ya no era p_desde o el
-- contacto no coincidía (nada se escribe).
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
    insert into public.dulabs_catalogo_pedido_eventos (event_id, id_tenant, pedido_id, tipo, estado_desde, estado_hacia, actor, motivo, payload)
    values (p_evento->>'event_id', v_fila.id_tenant, v_fila.id, p_evento->>'tipo', p_desde, p_hacia, p_actor,
            left(p_evento->>'motivo', 500), coalesce(p_evento->'payload', '{}'::jsonb))
    on conflict on constraint dulabs_catalogo_pedido_eventos_event_id do nothing;
  end if;

  return to_jsonb(v_fila);
end;
$$;

revoke all on table public.dulabs_catalogo_pedidos from anon, authenticated;
revoke all on table public.dulabs_catalogo_pedido_eventos from anon, authenticated;
-- Supabase concede EXECUTE a anon/authenticated por defecto en `public`: se revoca explícito.
revoke all on function public.dulabs_catalogo_pedido_eventos_inmutables() from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedido_transicion_valida(text, text, text) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedido_crear(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedido_transicion(uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.dulabs_catalogo_pedido_transicion_valida(text, text, text) to service_role;
grant execute on function public.dulabs_catalogo_pedido_crear(jsonb, jsonb) to service_role;
grant execute on function public.dulabs_catalogo_pedido_transicion(uuid, uuid, text, text, text, jsonb, jsonb) to service_role;

commit;
