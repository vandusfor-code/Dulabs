-- FASE 3B.1 (catalog_sales multi-negocio) — PEDIDO "PENDIENTE DE ACEPTACIÓN".
--
-- Un pedido pending_acceptance tiene los datos del checkout completos y el aviso obligatorio enviado al
-- cliente, pero NO es una venta: una persona del negocio lo acepta (-> confirmed) o lo cancela / rechaza.
--
--   pending_confirmation --agent--> pending_acceptance --human--> confirmed
--                                          |--human--> cancelled / rejected
--                                          '--system--> expired   (solo si el pedido trae un vencimiento)
--
-- Garantías de la BD (además del código):
--   - pending_acceptance <> confirmed: sin confirmado_at, sin etapa operativa y sin estado de pago.
--   - Nunca cuenta como compra: las estadísticas cuentan solo confirmed / completed (sin cambios aquí).
--   - Stock: SIN reserva salvo que el pedido traiga una política explícita (aceptacion_reserva_min). Nunca
--     hereda las 72 h de los pedidos confirmados. Vencimiento: solo con aceptacion_vence_at (null = no vence).
--   - Documento de identidad: tabla aparte, SOLO cifrado (formato v1 de lib/crypto.ts), solo con entrega en
--     oficina de transportadora, inmutable, sin acceso de anon/authenticated. La política de retención es
--     del negocio (borrar_despues; null = sin borrado automático) y no se decide aquí.
--
-- 100 % ADITIVA: columnas nulas, valores nuevos en CHECKs, tabla y funciones nuevas, y funciones existentes
-- reemplazadas con la MISMA conducta para los estados de siempre (Delacour no usa ningún valor nuevo).
-- No modifica filas existentes. El código tolera que esta migración aún no esté aplicada.
--
-- Riesgo conocido (no se resuelve aquí): el mensaje de WhatsApp en que el cliente escribe su documento queda
-- en el historial del Inbox (dulabs_mensajes_log), como cualquier mensaje. Cifrarlo exige cambiar el Inbox.
--
-- ROLLBACK: supabase/rollbacks/20261207000000_dulabs_catalogo_pedidos_aceptacion.down.sql (se niega a correr
-- si ya existe algún pedido pending_acceptance, de oficina o un documento).

-- ============================================================
-- 0. Guardas: si existe otro CHECK con otro nombre sobre estos valores, se aborta (nada queda a medias)
-- ============================================================
do $$
begin
  if exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.dulabs_catalogo_pedidos'::regclass and c.contype = 'c'
       -- Los que esta migración reemplaza (por nombre):
       and c.conname not in ('dulabs_catalogo_pedidos_estado_check', 'dulabs_catalogo_pedidos_tipo_entrega_check', 'dulabs_catalogo_pedidos_checkout_completo')
       -- Cualquier otro que enumere estados o entregas dejaría fuera los valores nuevos:
       and (pg_get_constraintdef(c.oid) like '%pending_confirmation%' or pg_get_constraintdef(c.oid) like '%''tienda''%''domicilio''%')
  ) then
    raise exception 'dulabs_catalogo_pedidos tiene otro CHECK sobre estado o tipo_entrega: revisarlo antes de aplicar esta migración';
  end if;
end $$;

-- ============================================================
-- 1. Columnas nuevas (todas nulas: ninguna fila existente cambia)
-- ============================================================
alter table public.dulabs_catalogo_pedidos
  add column if not exists telefono_contacto text,
  add column if not exists departamento text,
  add column if not exists barrio text,
  add column if not exists oficina_transportadora text,
  add column if not exists aviso_enviado_at timestamptz,
  add column if not exists respuesta_cliente_at timestamptz,
  add column if not exists aceptacion_reserva_min integer,
  add column if not exists aceptacion_vence_at timestamptz,
  add column if not exists confirmado_reserva_min integer;

comment on column public.dulabs_catalogo_pedidos.telefono_contacto is 'Fase 3B — teléfono de contacto para la entrega (solo dígitos). null = no se pidió.';
comment on column public.dulabs_catalogo_pedidos.departamento is 'Fase 3B — departamento de la entrega. null = no se pidió.';
comment on column public.dulabs_catalogo_pedidos.barrio is 'Fase 3B — barrio de la entrega. null = no se pidió.';
comment on column public.dulabs_catalogo_pedidos.oficina_transportadora is 'Fase 3B — oficina de la transportadora donde el cliente reclama (solo tipo_entrega = oficina_transportadora).';
comment on column public.dulabs_catalogo_pedidos.aviso_enviado_at is 'Fase 3B — cuándo salió el aviso obligatorio antes de la aceptación (null = no salió). Se registra una sola vez.';
comment on column public.dulabs_catalogo_pedidos.respuesta_cliente_at is 'Fase 3B — cuándo el cliente respondió afirmativamente después del aviso. Informativo: NO acepta ni confirma el pedido.';
comment on column public.dulabs_catalogo_pedidos.aceptacion_reserva_min is 'Fase 3B — política de reserva mientras está pendiente de aceptación, fijada al enviarlo. null = SIN reserva (nunca hereda las 72 h).';
comment on column public.dulabs_catalogo_pedidos.aceptacion_vence_at is 'Fase 3B — vencimiento del pedido pendiente de aceptación. null = no vence solo (lo cierra una persona).';
comment on column public.dulabs_catalogo_pedidos.confirmado_reserva_min is 'Fase 3B — plazo de la reserva al ACEPTAR (pending_acceptance -> confirmed). null = el plazo de la plataforma (dulabs_catalogo_reserva_ttl).';

alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_telefono_contacto_check;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_telefono_contacto_check
  check (telefono_contacto is null or telefono_contacto ~ '^[0-9]{7,15}$');
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_departamento_check;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_departamento_check
  check (departamento is null or char_length(departamento) between 2 and 60);
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_barrio_check;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_barrio_check
  check (barrio is null or char_length(barrio) between 1 and 120);
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_oficina_transportadora_check;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_oficina_transportadora_check
  check (oficina_transportadora is null or char_length(oficina_transportadora) between 2 and 160);
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_reserva_min_check;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_reserva_min_check
  check ((aceptacion_reserva_min is null or aceptacion_reserva_min between 1 and 43200)
     and (confirmado_reserva_min is null or confirmado_reserva_min between 1 and 43200));

-- ============================================================
-- 2. Estado y tipo de entrega: valores nuevos (superconjunto de los anteriores)
-- ============================================================
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_estado_check;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_estado_check
  check (estado in ('draft', 'validated', 'pending_confirmation', 'pending_acceptance', 'confirmed', 'handoff', 'completed', 'cancelled', 'expired', 'rejected'));

alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_tipo_entrega_check;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_tipo_entrega_check
  check (tipo_entrega is null or tipo_entrega in ('tienda', 'domicilio', 'oficina_transportadora'));

-- ============================================================
-- 3. Reglas de consistencia
-- ============================================================
-- Pedido del checkout fuera de propuesta: o es VENTA (etapa, pago y confirmado_at) o es "sin venta"
-- (pendiente de aceptación, o cerrado sin haberse aceptado). Para los pedidos de siempre es la misma regla.
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_checkout_completo;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_checkout_completo
  check (
    not checkout
    or estado in ('draft', 'validated', 'pending_confirmation')
    or (cliente_nombre is not null and metodo_pago is not null and tipo_entrega is not null and contacto_wa_id is not null
        and (
          (etapa is not null and estado_pago is not null and confirmado_at is not null)
          or (etapa is null and estado_pago is null and confirmado_at is null and estado in ('pending_acceptance', 'cancelled', 'rejected', 'expired'))
        ))
  );

-- pending_acceptance NO es confirmed: nunca confirmado_at, etapa de venta ni estado de pago.
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_aceptacion_no_es_venta;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_aceptacion_no_es_venta
  check (estado <> 'pending_acceptance' or (checkout and confirmado_at is null and etapa is null and estado_pago is null));

-- Aviso y respuesta: solo en pedidos del checkout; la respuesta siempre después de un aviso.
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_aviso_respuesta;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_aviso_respuesta
  check ((aviso_enviado_at is null or checkout) and (respuesta_cliente_at is null or aviso_enviado_at is not null));

-- Oficina de transportadora: con oficina y ciudad; la oficina solo existe con esa entrega.
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_oficina_completa;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_oficina_completa
  check ((tipo_entrega is distinct from 'oficina_transportadora' or (oficina_transportadora is not null and ciudad is not null))
     and (oficina_transportadora is null or tipo_entrega = 'oficina_transportadora'));

-- "enviado" aplica a lo que viaja: domicilio y oficina de transportadora (no a recoger en tienda).
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_enviado_solo_domicilio;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_enviado_solo_domicilio
  check (etapa is distinct from 'enviado' or tipo_entrega in ('domicilio', 'oficina_transportadora'));

-- Reservas: motivo propio cuando vence la reserva de un pedido pendiente de aceptación (superconjunto).
alter table public.dulabs_catalogo_reservas drop constraint if exists dulabs_catalogo_reservas_motivo_check;
alter table public.dulabs_catalogo_reservas add constraint dulabs_catalogo_reservas_motivo_check
  check (motivo is null or motivo in ('cancelled', 'expired', 'completed', 'reopened', 'line_removed', 'rejected', 'acceptance_expired'));

-- ============================================================
-- 4. Historial: tipos de evento nuevos (superconjunto)
-- ============================================================
alter table public.dulabs_catalogo_pedido_eventos drop constraint if exists dulabs_catalogo_pedido_eventos_tipo_check;
alter table public.dulabs_catalogo_pedido_eventos add constraint dulabs_catalogo_pedido_eventos_tipo_check
  check (tipo in ('catalog.order_request.created', 'order.created', 'order.status_changed', 'order.handoff_requested', 'order.stage_changed', 'order.payment_changed',
                  'order.acceptance_notice_sent', 'order.customer_replied'));

-- ============================================================
-- 5. Documento de identidad (tabla aparte, solo cifrado)
-- ============================================================
create table if not exists public.dulabs_catalogo_pedido_documentos (
  pedido_id uuid primary key,
  id_tenant uuid not null,
  -- Código del tipo; los tipos aceptados los define la configuración del negocio (no la BD).
  tipo text not null check (tipo ~ '^[a-z][a-z_]{1,29}$'),
  -- Siempre cifrado (lib/crypto.ts, "v1:<iv>:<tag>:<texto cifrado>"): un número en claro no cabe aquí.
  numero_cifrado text not null check (numero_cifrado ~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'),
  -- Lo único que se muestra (enmascarado).
  ultimos4 text not null check (ultimos4 ~ '^[0-9A-Z]{1,4}$'),
  -- Retención (política del negocio): null = sin borrado automático.
  borrar_despues timestamptz,
  created_at timestamptz not null default now(),
  constraint dulabs_catalogo_pedido_documentos_pedido_fk foreign key (pedido_id, id_tenant)
    references public.dulabs_catalogo_pedidos (id, id_tenant) on delete cascade
);

create index if not exists dulabs_catalogo_pedido_documentos_borrar_idx
  on public.dulabs_catalogo_pedido_documentos (borrar_despues) where borrar_despues is not null;

alter table public.dulabs_catalogo_pedido_documentos enable row level security;
revoke all on table public.dulabs_catalogo_pedido_documentos from anon, authenticated;

comment on table public.dulabs_catalogo_pedido_documentos is
  'Fase 3B — documento de identidad para reclamar en oficina de transportadora. SOLO cifrado (numero_cifrado) y enmascarado (ultimos4). Inmutable. Solo service_role. Nunca en trazas, prompts ni registros.';

-- Solo con entrega en oficina de transportadora y mientras el pedido se envía a aceptación; después, inmutable.
create or replace function public.dulabs_catalogo_pedido_documentos_reglas()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'el documento de un pedido no se edita' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.dulabs_catalogo_pedidos p
     where p.id = new.pedido_id and p.id_tenant = new.id_tenant
       and p.tipo_entrega = 'oficina_transportadora' and p.estado = 'pending_acceptance'
  ) then
    raise exception 'el documento solo existe para un pedido de oficina de transportadora pendiente de aceptación' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists dulabs_catalogo_pedido_documentos_reglas on public.dulabs_catalogo_pedido_documentos;
create trigger dulabs_catalogo_pedido_documentos_reglas
  before insert or update on public.dulabs_catalogo_pedido_documentos
  for each row execute function public.dulabs_catalogo_pedido_documentos_reglas();

-- Retención: borra los documentos cuyo plazo pasó. PREPARADA: nada la programa todavía (decisión del negocio).
create or replace function public.dulabs_catalogo_pedido_documentos_purgar(p_limite integer default 500)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  delete from public.dulabs_catalogo_pedido_documentos
   where pedido_id in (select pedido_id from public.dulabs_catalogo_pedido_documentos
                        where borrar_despues is not null and borrar_despues <= now()
                        order by borrar_despues limit greatest(p_limite, 1));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ============================================================
-- 6. Máquina de estados de la BD (superconjunto: las transiciones de siempre + las de la aceptación)
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
      -- Fase 3B: el checkout lo envía a aceptación; solo una persona lo acepta, cancela o rechaza.
      ('pending_confirmation', 'pending_acceptance', 'agent'),
      ('pending_acceptance', 'confirmed', 'human'),
      ('pending_acceptance', 'cancelled', 'human'), ('pending_acceptance', 'rejected', 'human'),
      ('pending_acceptance', 'expired', 'system'),
      ('confirmed', 'handoff', 'system'), ('confirmed', 'handoff', 'agent'), ('confirmed', 'handoff', 'human'),
      ('confirmed', 'completed', 'human'), ('confirmed', 'cancelled', 'human'), ('confirmed', 'rejected', 'human'),
      ('confirmed', 'expired', 'system'),
      ('handoff', 'confirmed', 'human'), ('handoff', 'completed', 'human'), ('handoff', 'cancelled', 'human'), ('handoff', 'rejected', 'human')
    ) as t(desde, hacia, actor)
    where t.desde = p_desde and t.hacia = p_hacia and t.actor = p_actor
  );
$$;

-- ============================================================
-- 7. TRANSICIÓN (misma firma; + columnas de la Fase 3B y el documento, en la MISMA transacción)
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
  -- Fase 3B: el documento solo viaja con el envío a aceptación.
  if p_cambios ? 'documento' and p_hacia <> 'pending_acceptance' then
    raise exception 'el documento solo se registra al enviar el pedido a aceptación' using errcode = '22023';
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
    -- Fase 3B: datos del pedido pendiente de aceptación y sus políticas (fijadas al enviarlo).
    telefono_contacto = case when p_cambios ? 'telefono_contacto' then p_cambios->>'telefono_contacto' else p.telefono_contacto end,
    departamento = case when p_cambios ? 'departamento' then p_cambios->>'departamento' else p.departamento end,
    barrio = case when p_cambios ? 'barrio' then p_cambios->>'barrio' else p.barrio end,
    oficina_transportadora = case when p_cambios ? 'oficina_transportadora' then p_cambios->>'oficina_transportadora' else p.oficina_transportadora end,
    aceptacion_reserva_min = case when p_cambios ? 'aceptacion_reserva_min' then (p_cambios->>'aceptacion_reserva_min')::integer else p.aceptacion_reserva_min end,
    aceptacion_vence_at = case when p_cambios ? 'aceptacion_vence_at' then (p_cambios->>'aceptacion_vence_at')::timestamptz else p.aceptacion_vence_at end,
    confirmado_reserva_min = case when p_cambios ? 'confirmado_reserva_min' then (p_cambios->>'confirmado_reserva_min')::integer else p.confirmado_reserva_min end,
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

  -- Fase 3B: documento (ya cifrado por el backend) en la MISMA transacción; el trigger de la tabla valida.
  if p_cambios ? 'documento' and jsonb_typeof(p_cambios->'documento') = 'object' then
    insert into public.dulabs_catalogo_pedido_documentos (pedido_id, id_tenant, tipo, numero_cifrado, ultimos4, borrar_despues)
    values (v_fila.id, v_fila.id_tenant, p_cambios->'documento'->>'tipo', p_cambios->'documento'->>'numero_cifrado',
            p_cambios->'documento'->>'ultimos4', nullif(p_cambios->'documento'->>'borrar_despues', '')::timestamptz);
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
-- 8. RESERVAS (trigger): pendiente de aceptación SOLO con política explícita; aceptar = plazo desde la aceptación
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
    -- Fase 3B: al ACEPTAR, la reserva corre desde la aceptación (el plazo del pedido o el de la plataforma);
    -- nunca queda el plazo de la etapa anterior.
    if tg_op = 'UPDATE' and old.estado = 'pending_acceptance' then
      update public.dulabs_catalogo_reservas
         set vence_at = now() + coalesce(make_interval(mins => new.confirmado_reserva_min), public.dulabs_catalogo_reserva_ttl()), updated_at = now()
       where pedido_id = new.id and estado = 'activa';
    end if;
  elsif new.estado = 'pending_acceptance' then
    -- Fase 3B: SIN reserva salvo política explícita del pedido (nunca las 72 h de los confirmados).
    if new.aceptacion_reserva_min is not null then
      perform public.dulabs_catalogo_reservas_ajustar(new.id_tenant, new.id, new.lineas);
      update public.dulabs_catalogo_reservas
         set vence_at = now() + make_interval(mins => new.aceptacion_reserva_min), updated_at = now()
       where pedido_id = new.id and estado = 'activa';
    end if;
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
-- 9. REGLAS DEL CHECKOUT (antes de cada actualización): + pendiente de aceptación y columnas de la Fase 3B
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

  -- Fase 3B — pendiente de aceptación: datos, productos y políticas inmutables; el aviso y la respuesta se
  -- registran una sola vez; solo se sale aceptando (etapa "confirmado", pago pendiente) o sin venta.
  if old.estado = 'pending_acceptance' then
    if (new.checkout, new.lineas, new.total, new.canal, new.cliente_nombre, new.metodo_pago, new.tipo_entrega, new.direccion, new.ciudad,
        new.referencia_entrega, new.contacto_wa_id, new.telefono_contacto, new.departamento, new.barrio, new.oficina_transportadora,
        new.aceptacion_reserva_min, new.aceptacion_vence_at)
       is distinct from
       (old.checkout, old.lineas, old.total, old.canal, old.cliente_nombre, old.metodo_pago, old.tipo_entrega, old.direccion, old.ciudad,
        old.referencia_entrega, old.contacto_wa_id, old.telefono_contacto, old.departamento, old.barrio, old.oficina_transportadora,
        old.aceptacion_reserva_min, old.aceptacion_vence_at) then
      raise exception 'el pedido % está pendiente de aceptación: sus productos y datos no se editan', old.pedido_publico using errcode = '42501';
    end if;
    if (old.aviso_enviado_at is not null and new.aviso_enviado_at is distinct from old.aviso_enviado_at)
       or (old.respuesta_cliente_at is not null and new.respuesta_cliente_at is distinct from old.respuesta_cliente_at) then
      raise exception 'el aviso y la respuesta del pedido % se registran una sola vez', old.pedido_publico using errcode = '42501';
    end if;
    if new.estado = 'confirmed' then
      if not (new.etapa = 'confirmado' and new.estado_pago = 'pendiente' and new.confirmado_at is not null) then
        raise exception 'aceptar el pedido % lo deja confirmado, con el pago pendiente', old.pedido_publico using errcode = '22023';
      end if;
    elsif new.etapa is not null or new.estado_pago is not null or new.confirmado_at is not null then
      raise exception 'el pedido % no es una venta: no tiene etapa, pago ni confirmación', old.pedido_publico using errcode = '22023';
    end if;
    return new;
  end if;

  -- Confirmado = inmutable en productos, precio, modalidad y datos del checkout (+ los de la Fase 3B).
  if (new.checkout, new.lineas, new.total, new.canal, new.cliente_nombre, new.metodo_pago, new.tipo_entrega, new.direccion, new.ciudad, new.referencia_entrega, new.confirmado_at, new.contacto_wa_id,
      new.telefono_contacto, new.departamento, new.barrio, new.oficina_transportadora, new.aviso_enviado_at, new.respuesta_cliente_at,
      new.aceptacion_reserva_min, new.aceptacion_vence_at, new.confirmado_reserva_min)
     is distinct from
     (old.checkout, old.lineas, old.total, old.canal, old.cliente_nombre, old.metodo_pago, old.tipo_entrega, old.direccion, old.ciudad, old.referencia_entrega, old.confirmado_at, old.contacto_wa_id,
      old.telefono_contacto, old.departamento, old.barrio, old.oficina_transportadora, old.aviso_enviado_at, old.respuesta_cliente_at,
      old.aceptacion_reserva_min, old.aceptacion_vence_at, old.confirmado_reserva_min) then
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
            or (old.etapa = 'en_preparacion' and new.etapa = 'enviado' and old.tipo_entrega in ('domicilio', 'oficina_transportadora'))
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

-- ============================================================
-- 10. AVISO / RESPUESTA DEL CLIENTE (compare-and-set + evento; una sola vez)
-- ============================================================
-- p_marca: 'aviso' (salió el aviso obligatorio) | 'respuesta' (el cliente respondió que sí; informativo).
-- Devuelve {resultado: ok|sin_cambio|conflicto|no_encontrado, estado, pedido}.
create or replace function public.dulabs_catalogo_pedido_aceptacion_marca(p_tenant uuid, p_pedido text, p_marca text, p_evento_id text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v public.dulabs_catalogo_pedidos;
begin
  if p_marca not in ('aviso', 'respuesta') then
    raise exception 'marca no válida: %', p_marca using errcode = '22023';
  end if;
  select * into v from public.dulabs_catalogo_pedidos where id_tenant = p_tenant and pedido_publico = p_pedido for update;
  if v.id is null then
    return jsonb_build_object('resultado', 'no_encontrado');
  end if;
  if (p_marca = 'aviso' and v.aviso_enviado_at is not null) or (p_marca = 'respuesta' and v.respuesta_cliente_at is not null) then
    return jsonb_build_object('resultado', 'sin_cambio', 'estado', v.estado, 'pedido', to_jsonb(v));
  end if;
  if v.estado <> 'pending_acceptance' or (p_marca = 'respuesta' and v.aviso_enviado_at is null) then
    return jsonb_build_object('resultado', 'conflicto', 'estado', v.estado);
  end if;
  if p_marca = 'aviso' then
    update public.dulabs_catalogo_pedidos set aviso_enviado_at = now(), updated_at = now() where id = v.id returning * into v;
  else
    update public.dulabs_catalogo_pedidos set respuesta_cliente_at = now(), updated_at = now() where id = v.id returning * into v;
  end if;
  insert into public.dulabs_catalogo_pedido_eventos (event_id, id_tenant, pedido_id, tipo, estado_desde, estado_hacia, actor, motivo, payload)
  values (p_evento_id, v.id_tenant, v.id,
          case when p_marca = 'aviso' then 'order.acceptance_notice_sent' else 'order.customer_replied' end,
          v.estado, v.estado, 'system', null,
          jsonb_build_object('event_type', case when p_marca = 'aviso' then 'order.acceptance_notice_sent' else 'order.customer_replied' end,
                             'order_id', v.pedido_publico, 'occurred_at', now()))
  on conflict on constraint dulabs_catalogo_pedido_eventos_event_id do nothing;
  return jsonb_build_object('resultado', 'ok', 'estado', v.estado, 'pedido', to_jsonb(v));
end;
$$;

-- ============================================================
-- 11. VENCIMIENTOS DE LA ACEPTACIÓN. PREPARADA: nada la programa todavía (decisión del negocio).
-- ============================================================
--   a) reserva de un pedido pendiente cuyo plazo pasó: se libera el stock; el pedido SIGUE pendiente;
--   b) pedido pendiente con aceptacion_vence_at vencido: pasa a 'expired' (el trigger libera lo apartado).
-- Sin políticas configuradas (columnas null) no hace nada.
create or replace function public.dulabs_catalogo_aceptacion_vencer(p_limite integer default 200)
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
    select p.id from public.dulabs_catalogo_pedidos p
     where p.estado = 'pending_acceptance'
       and exists (select 1 from public.dulabs_catalogo_reservas r
                    where r.pedido_id = p.id and r.estado = 'activa' and r.vence_at <= now())
     order by p.updated_at
     limit greatest(p_limite, 1)
     for update skip locked
  loop
    perform public.dulabs_catalogo_reservas_cerrar(v.id, 'liberada', 'acceptance_expired');
    n := n + 1;
  end loop;

  for v in
    select p.* from public.dulabs_catalogo_pedidos p
     where p.estado = 'pending_acceptance' and p.aceptacion_vence_at is not null and p.aceptacion_vence_at <= now()
     order by p.aceptacion_vence_at
     limit greatest(p_limite, 1)
     for update skip locked
  loop
    update public.dulabs_catalogo_pedidos set estado = 'expired', confirmacion = null, updated_at = now()
     where id = v.id and estado = 'pending_acceptance';
    insert into public.dulabs_catalogo_pedido_eventos (event_id, id_tenant, pedido_id, tipo, estado_desde, estado_hacia, actor, motivo, payload)
    values ('evt_' || substr(md5(v.id::text || 'acceptance_expired'), 1, 26), v.id_tenant, v.id, 'order.status_changed',
            'pending_acceptance', 'expired', 'system', 'acceptance_expired',
            jsonb_build_object('event_type', 'order.status_changed', 'order_id', v.pedido_publico,
                               'transition', jsonb_build_object('from', 'pending_acceptance', 'to', 'expired', 'actor', 'system', 'reason', 'acceptance_expired'),
                               'occurred_at', now()))
    on conflict on constraint dulabs_catalogo_pedido_eventos_event_id do nothing;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ============================================================
-- 12. Eliminar un cliente: un pedido pendiente de aceptación también es ACTIVO (no se borra)
-- ============================================================
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
    and estado in ('confirmed', 'handoff', 'pending_acceptance');
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

-- ============================================================
-- 13. Configuración del agente: la entrega nueva entra al catálogo cerrado (y más espacio para textos/envíos)
-- ============================================================
alter table public.dulabs_agente_runtime_config drop constraint if exists dulabs_agente_runtime_config_checkout_opciones_check;
alter table public.dulabs_agente_runtime_config add constraint dulabs_agente_runtime_config_checkout_opciones_check
  check (
    checkout_opciones is null
    or (
      jsonb_typeof(checkout_opciones) = 'object'
      and pg_column_size(checkout_opciones) <= 32768
      and jsonb_typeof(checkout_opciones -> 'entregas') = 'array'
      and jsonb_typeof(checkout_opciones -> 'pagos') = 'array'
      and not jsonb_path_exists(checkout_opciones, '$.entregas[*] ? (@ != "tienda" && @ != "domicilio" && @ != "oficina_transportadora")')
      and not jsonb_path_exists(checkout_opciones, '$.pagos[*].metodo ? (@ != "pago_en_tienda" && @ != "transferencia" && @ != "contra_entrega" && @ != "link_pago")')
    )
  );

-- ============================================================
-- 14. Permisos: solo service_role (como el resto de funciones de pedidos)
-- ============================================================
revoke all on function public.dulabs_catalogo_pedido_transicion_valida(text, text, text) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedido_transicion(uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedido_reservas_trigger() from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedidos_checkout_reglas() from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedido_documentos_reglas() from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedido_documentos_purgar(integer) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_pedido_aceptacion_marca(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_aceptacion_vencer(integer) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_cliente_eliminar(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.dulabs_catalogo_pedido_transicion_valida(text, text, text) to service_role;
grant execute on function public.dulabs_catalogo_pedido_transicion(uuid, uuid, text, text, text, jsonb, jsonb) to service_role;
grant execute on function public.dulabs_catalogo_pedido_documentos_purgar(integer) to service_role;
grant execute on function public.dulabs_catalogo_pedido_aceptacion_marca(uuid, text, text, text) to service_role;
grant execute on function public.dulabs_catalogo_aceptacion_vencer(integer) to service_role;
grant execute on function public.dulabs_catalogo_cliente_eliminar(uuid, text, text, bigint) to service_role;
