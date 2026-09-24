-- DuLabs Catálogo — Bloque 25: CLASIFICACIÓN DETAL / MAYORISTA POR CONTACTO (Delacour).
--
-- Para qué sirve: hasta ahora el canal de precios de una conversación salía de la configuración
-- del NÚMERO (todo el número al detal o todo al por mayor) o de una solicitud firmada del enlace
-- mayorista. No había forma de que cada contacto quede clasificado como detal o mayorista, ni de
-- registrar quién cambió esa clasificación. Esta migración agrega lo MÍNIMO para eso:
--
--   dulabs_catalogo_clientes_canal          un canal por contacto (número del negocio + cliente):
--                                           retail | wholesale, de dónde salió y quién lo cambió.
--   dulabs_catalogo_clientes_canal_eventos  bitácora INMUTABLE de cada clasificación y cambio.
--   dulabs_catalogo_cliente_canal_fijar     ÚNICA forma de escribir (atómica: estado + evento):
--                                           - primera clasificación (el cliente elige, o su solicitud
--                                             del catálogo lo indica): solo si aún no tiene; nunca
--                                             pisa una existente;
--                                           - cambio: SOLO una asesora (origen 'asesora' + miembro),
--                                             con compare-and-set contra el canal que ella vio.
--   dulabs_agente_runtime_config.clasificacion_cliente  interruptor por número (false por defecto).
--
-- No toca datos existentes, pedidos, reservas, precios ni el catálogo. Con clasificacion_cliente =
-- false (valor por defecto) el agente se comporta EXACTAMENTE como antes: el piloto no cambia
-- hasta que se active explícitamente para el número de Delacour. No afecta a AMORE ni a otros
-- módulos. Tablas con RLS y sin políticas: solo el backend (service_role).
--
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE).
--
-- Rollback:
--   drop function if exists public.dulabs_catalogo_cliente_canal_fijar(uuid, text, text, text, text, bigint, text, text);
--   drop table if exists public.dulabs_catalogo_clientes_canal_eventos;
--   drop table if exists public.dulabs_catalogo_clientes_canal;
--   drop function if exists public.dulabs_catalogo_clientes_canal_eventos_inmutables();
--   alter table public.dulabs_agente_runtime_config drop column if exists clasificacion_cliente;

begin;

alter table public.dulabs_agente_runtime_config
  add column if not exists clasificacion_cliente boolean not null default false;

comment on column public.dulabs_agente_runtime_config.clasificacion_cliente is
  'Bloque 25 — true: el agente pregunta a cada contacto nuevo si compra al detal o al por mayor y usa ESE canal (dulabs_catalogo_clientes_canal). false: canal de la columna canal (como antes).';

create table if not exists public.dulabs_catalogo_clientes_canal (
  id_tenant uuid not null,
  phone_number_id text not null check (char_length(phone_number_id) between 1 and 64),
  wa_id text not null check (wa_id ~ '^[0-9]{6,20}$'),
  canal text not null check (canal in ('retail', 'wholesale')),
  -- cliente: lo eligió en la conversación; catalogo_*: su solicitud del catálogo lo indicó
  -- (el enlace mayorista lo entrega el negocio); asesora: lo fijó o cambió una persona.
  origen text not null check (origen in ('cliente', 'catalogo_detal', 'catalogo_mayorista', 'asesora')),
  actualizado_por bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_catalogo_clientes_canal_pk primary key (phone_number_id, wa_id)
);

create index if not exists dulabs_catalogo_clientes_canal_tenant_idx
  on public.dulabs_catalogo_clientes_canal (id_tenant, canal);

comment on table public.dulabs_catalogo_clientes_canal is
  'Bloque 25 — canal de precios (detal/mayorista) de cada contacto de un número con agente. Se escribe SOLO con dulabs_catalogo_cliente_canal_fijar. Solo service_role.';

create table if not exists public.dulabs_catalogo_clientes_canal_eventos (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null,
  wa_id text not null,
  canal_anterior text check (canal_anterior is null or canal_anterior in ('retail', 'wholesale')),
  canal_nuevo text not null check (canal_nuevo in ('retail', 'wholesale')),
  origen text not null check (origen in ('cliente', 'catalogo_detal', 'catalogo_mayorista', 'asesora')),
  miembro_id bigint,
  motivo text check (motivo is null or char_length(motivo) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists dulabs_catalogo_clientes_canal_eventos_contacto_idx
  on public.dulabs_catalogo_clientes_canal_eventos (phone_number_id, wa_id, created_at desc);

comment on table public.dulabs_catalogo_clientes_canal_eventos is
  'Bloque 25 — bitácora inmutable de clasificaciones y cambios de canal (quién, cuándo, de qué a qué, por qué).';

create or replace function public.dulabs_catalogo_clientes_canal_eventos_inmutables()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'dulabs_catalogo_clientes_canal_eventos es inmutable' using errcode = '42501';
end;
$$;

drop trigger if exists dulabs_catalogo_clientes_canal_eventos_inmutables on public.dulabs_catalogo_clientes_canal_eventos;
create trigger dulabs_catalogo_clientes_canal_eventos_inmutables
  before update or delete on public.dulabs_catalogo_clientes_canal_eventos
  for each row execute function public.dulabs_catalogo_clientes_canal_eventos_inmutables();

alter table public.dulabs_catalogo_clientes_canal enable row level security;
alter table public.dulabs_catalogo_clientes_canal_eventos enable row level security;
revoke all on table public.dulabs_catalogo_clientes_canal from anon, authenticated;
revoke all on table public.dulabs_catalogo_clientes_canal_eventos from anon, authenticated;

-- Fija o cambia el canal de un contacto (atómico: estado + evento).
--   p_esperado null            => PRIMERA clasificación (cliente o catálogo): solo si no tiene;
--                                 si ya tenía, no cambia nada y devuelve la existente (conflicto).
--   p_esperado 'retail'|'wholesale'|'ninguno' => CAMBIO por una asesora (origen 'asesora' y miembro
--                                 obligatorios): solo si el canal actual es el que ella vio.
-- Devuelve {resultado: fijado|cambiado|sin_cambio|conflicto, canal, origen, actual_desde}.
create or replace function public.dulabs_catalogo_cliente_canal_fijar(
  p_tenant uuid, p_pn text, p_wa text, p_canal text, p_origen text, p_miembro bigint, p_motivo text, p_esperado text
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_fila public.dulabs_catalogo_clientes_canal;
  v_anterior text;
begin
  if p_canal not in ('retail', 'wholesale') then raise exception 'canal inválido' using errcode = '22023'; end if;
  if p_wa !~ '^[0-9]{6,20}$' then raise exception 'contacto inválido' using errcode = '22023'; end if;
  -- El número debe ser de ESTE negocio (nunca se clasifica un contacto de otro negocio).
  if not exists (select 1 from public.dulabs_clientes_config c where c.phone_number_id = p_pn and c.id_tenant = p_tenant) then
    raise exception 'el número no pertenece al negocio' using errcode = '42501';
  end if;

  if p_esperado is null then
    if p_origen not in ('cliente', 'catalogo_detal', 'catalogo_mayorista') then
      raise exception 'origen inválido para una primera clasificación' using errcode = '22023';
    end if;
    insert into public.dulabs_catalogo_clientes_canal (id_tenant, phone_number_id, wa_id, canal, origen)
    values (p_tenant, p_pn, p_wa, p_canal, p_origen)
    on conflict (phone_number_id, wa_id) do nothing
    returning * into v_fila;
    if v_fila.wa_id is null then
      select * into v_fila from public.dulabs_catalogo_clientes_canal where phone_number_id = p_pn and wa_id = p_wa;
      return jsonb_build_object('resultado', 'conflicto', 'canal', v_fila.canal, 'origen', v_fila.origen, 'actual_desde', v_fila.updated_at);
    end if;
    insert into public.dulabs_catalogo_clientes_canal_eventos (id_tenant, phone_number_id, wa_id, canal_anterior, canal_nuevo, origen, miembro_id, motivo)
    values (p_tenant, p_pn, p_wa, null, p_canal, p_origen, null, left(p_motivo, 300));
    return jsonb_build_object('resultado', 'fijado', 'canal', v_fila.canal, 'origen', v_fila.origen, 'actual_desde', v_fila.updated_at);
  end if;

  -- Cambio: solo una asesora identificada.
  if p_origen <> 'asesora' or p_miembro is null then
    raise exception 'solo una asesora puede cambiar el canal de un contacto' using errcode = '42501';
  end if;
  if p_esperado not in ('retail', 'wholesale', 'ninguno') then raise exception 'canal esperado inválido' using errcode = '22023'; end if;

  select * into v_fila from public.dulabs_catalogo_clientes_canal where phone_number_id = p_pn and wa_id = p_wa for update;
  if v_fila.wa_id is not null and v_fila.id_tenant <> p_tenant then
    raise exception 'el contacto no pertenece al negocio' using errcode = '42501';
  end if;
  v_anterior := v_fila.canal;
  if coalesce(v_anterior, 'ninguno') <> p_esperado then
    return jsonb_build_object('resultado', 'conflicto', 'canal', v_anterior, 'origen', v_fila.origen, 'actual_desde', v_fila.updated_at);
  end if;
  if v_anterior = p_canal then
    return jsonb_build_object('resultado', 'sin_cambio', 'canal', v_anterior, 'origen', v_fila.origen, 'actual_desde', v_fila.updated_at);
  end if;
  if v_anterior is null then
    -- Sin fila que bloquear: si otra escritura la creó entre tanto, gana ella (conflicto, sin error).
    insert into public.dulabs_catalogo_clientes_canal (id_tenant, phone_number_id, wa_id, canal, origen, actualizado_por)
    values (p_tenant, p_pn, p_wa, p_canal, 'asesora', p_miembro)
    on conflict (phone_number_id, wa_id) do nothing
    returning * into v_fila;
    if v_fila.wa_id is null then
      select * into v_fila from public.dulabs_catalogo_clientes_canal where phone_number_id = p_pn and wa_id = p_wa;
      return jsonb_build_object('resultado', 'conflicto', 'canal', v_fila.canal, 'origen', v_fila.origen, 'actual_desde', v_fila.updated_at);
    end if;
  else
    update public.dulabs_catalogo_clientes_canal
       set canal = p_canal, origen = 'asesora', actualizado_por = p_miembro, updated_at = now()
     where phone_number_id = p_pn and wa_id = p_wa
    returning * into v_fila;
  end if;
  insert into public.dulabs_catalogo_clientes_canal_eventos (id_tenant, phone_number_id, wa_id, canal_anterior, canal_nuevo, origen, miembro_id, motivo)
  values (p_tenant, p_pn, p_wa, v_anterior, p_canal, 'asesora', p_miembro, left(p_motivo, 300));
  return jsonb_build_object('resultado', 'cambiado', 'canal', v_fila.canal, 'origen', v_fila.origen, 'actual_desde', v_fila.updated_at);
end;
$$;

revoke all on function public.dulabs_catalogo_cliente_canal_fijar(uuid, text, text, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.dulabs_catalogo_cliente_canal_fijar(uuid, text, text, text, text, bigint, text, text) to service_role;
revoke all on function public.dulabs_catalogo_clientes_canal_eventos_inmutables() from public, anon, authenticated;

commit;
