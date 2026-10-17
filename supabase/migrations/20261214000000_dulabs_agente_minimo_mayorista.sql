-- DuLabs — MÍNIMO DE LA COMPRA INICIAL MAYORISTA, editable desde el panel de la tienda.
--
-- Qué resuelve: el mínimo (hoy $750.000 en Delacour) vive en la configuración del asistente (dulabs_agente_runtime_config.negocio.pedido.minimo_mayorista) y lo usan DOS cosas: la regla que el asistente
-- aplica a la primera compra mayorista y los textos del CMS que escriben {{minimo_mayorista}}. Cambiarlo exigía SQL a mano de DuLabs. Con esto la clienta lo cambia en el panel
-- (Tienda → Preguntas frecuentes) y, en UNA sola transacción, cambian TRES cosas:
--   1. el número (negocio.pedido.minimo_mayorista) de cada línea de WhatsApp habilitada del negocio;
--   2. el monto ESCRITO A MANO dentro de los textos del asistente (p. ej. «La compra inicial mayorista parte de $750.000» en su mensaje inicial y en su información), que si no quedarían diciendo
--      un número distinto del que el pedido exige;
--   3. una fila de auditoría por línea (dulabs_agente_config_cambios): quién, cuándo, el mínimo de antes y de después y, de cada texto que cambió, cómo era y cómo quedó (así se puede deshacer).
--
-- QUIÉN HACE QUÉ. La APLICACIÓN calcula el cambio (reemplaza el monto en los textos y comprueba que la configuración nueva sigue cumpliendo el MISMO esquema con el que el asistente la carga: un texto
-- que con el monto nuevo superara su largo máximo dejaría la configuración inválida y el asistente dejaría de responder, así que ese cambio ni se intenta). La BASE solo lo APLICA, con estas
-- garantías que valen sin importar quién la llame:
--   - el mínimo nuevo es un entero entre $10.000 y $100.000.000 (un «75» por «750.000» o un cero de más no pasa);
--   - control de concurrencia: se cambia solo si cada línea sigue EXACTAMENTE como la vio la aplicación (mismo mínimo y misma configuración); si no, se rechaza y no se pisa el cambio de nadie;
--   - solo se tocan las líneas HABILITADAS del negocio indicado que ya tienen un mínimo, y TODAS a la vez (las mismas que vio la aplicación: ni una más, ni una menos); ninguna otra fila;
--   - todo o nada: si algo falla (la fila ya no cumple el tamaño, otra persona la cambió…) no se toca nada.
--
-- ADITIVA: una tabla nueva y funciones nuevas; no cambia ni borra nada que ya exista. Sin esta migración la aplicación sigue igual: el panel muestra el mínimo pero avisa que cambiarlo todavía no está activo.
-- SEGURIDAD: la tabla y las funciones son solo del backend (service_role); el negocio y quién cambia los decide el servidor desde la sesión, nunca el navegador.
-- RECUPERACIÓN: supabase/rollbacks/20261214000000_dulabs_agente_minimo_mayorista.down.sql (se niega a correr si ya hay cambios auditados: son de solo añadir).
-- Idempotente: se puede ejecutar más de una vez. Se aplica a mano en el SQL Editor de Supabase.

begin;

do $$
begin
  if to_regclass('public.dulabs_agente_runtime_config') is null then
    raise exception 'falta la tabla dulabs_agente_runtime_config (migración 20261109000000_dulabs_agente_runtime.sql)';
  end if;
end;
$$;

-- ============================================================
-- 1. AUDITORÍA (solo de añadir)
-- ============================================================
create table if not exists public.dulabs_agente_config_cambios (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null,
  actor_user_id uuid,
  campo text not null check (campo in ('pedido.minimo_mayorista')),
  antes jsonb not null,
  despues jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists dulabs_agente_config_cambios_tenant_idx on public.dulabs_agente_config_cambios (id_tenant, created_at desc);

alter table public.dulabs_agente_config_cambios enable row level security;
revoke all on table public.dulabs_agente_config_cambios from anon, authenticated;

comment on table public.dulabs_agente_config_cambios is
  'Auditoría APPEND-ONLY de los cambios que el PANEL hace a la configuración del asistente (hoy solo el mínimo mayorista). antes/despues = {minimo, textos:{ruta: texto}}: de cada texto que cambió, cómo era y cómo quedó. Solo service_role.';

create or replace function public.dulabs_agente_config_cambios_inmutables()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = 'CT002', message = 'auditoria_append_only';
end;
$$;

drop trigger if exists dulabs_agente_config_cambios_inmutables on public.dulabs_agente_config_cambios;
create trigger dulabs_agente_config_cambios_inmutables
  before update or delete on public.dulabs_agente_config_cambios
  for each row execute function public.dulabs_agente_config_cambios_inmutables();

-- ============================================================
-- 2. VER: las líneas que están en juego
-- ============================================================
-- {filas: [{phone_number_id, negocio}]}: las líneas HABILITADAS del negocio cuyo `negocio` ya trae un mínimo (número), con su configuración completa, en un orden fijo. Solo para el servidor: la
-- aplicación calcula de ahí el mínimo vigente, si todas coinciden y en qué textos está escrito a mano.
create or replace function public.dulabs_agente_minimo_mayorista_ver(p_tenant uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'filas',
    coalesce(jsonb_agg(jsonb_build_object('phone_number_id', c.phone_number_id, 'negocio', c.negocio) order by c.created_at, c.phone_number_id), '[]'::jsonb)
  )
  from public.dulabs_agente_runtime_config c
  where c.id_tenant = p_tenant
    and c.habilitado is true
    and jsonb_typeof(c.negocio #> '{pedido,minimo_mayorista}') = 'number'
$$;

-- ============================================================
-- 3. APLICAR el cambio que calculó la aplicación
-- ============================================================
-- p_filas = [{phone_number_id, antes, despues, textos_antes, textos_despues}]:
--   antes / despues: la configuración COMPLETA de la línea como la vio la aplicación y como debe quedar;
--   textos_antes / textos_despues: de cada texto que cambió, ruta → texto (solo para la auditoría).
create or replace function public.dulabs_agente_minimo_mayorista_aplicar(p_tenant uuid, p_actor uuid, p_esperado bigint, p_nuevo bigint, p_filas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_telefonos text[];
  v_vistos text[];
  v_item jsonb;
  v_actual jsonb;
  v_n integer := 0;
begin
  if p_nuevo is null or p_esperado is null or p_nuevo < 10000 or p_nuevo > 100000000 then
    raise exception 'minimo_fuera_de_rango' using errcode = 'P0001';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'cambio_invalido' using errcode = 'P0001';
  end if;

  -- Las líneas en juego, bloqueadas hasta el final de la transacción (dos cambios a la vez se turnan).
  perform 1
     from public.dulabs_agente_runtime_config c
    where c.id_tenant = p_tenant and c.habilitado is true and jsonb_typeof(c.negocio #> '{pedido,minimo_mayorista}') = 'number'
    order by c.phone_number_id
      for update;

  select array_agg(c.phone_number_id order by c.phone_number_id)
    into v_telefonos
    from public.dulabs_agente_runtime_config c
   where c.id_tenant = p_tenant and c.habilitado is true and jsonb_typeof(c.negocio #> '{pedido,minimo_mayorista}') = 'number';
  if v_telefonos is null then
    raise exception 'minimo_sin_configurar' using errcode = 'P0001';
  end if;

  -- Las mismas líneas que vio la aplicación (si se habilitó, apagó o agregó una, el cambio ya no es el que se calculó).
  select array_agg(f ->> 'phone_number_id' order by f ->> 'phone_number_id') into v_vistos from jsonb_array_elements(p_filas) f;
  if v_vistos is distinct from v_telefonos then
    raise exception 'config_cambio_mientras_tanto' using errcode = 'P0001';
  end if;

  for v_item in select f from jsonb_array_elements(p_filas) f loop
    select c.negocio into v_actual
      from public.dulabs_agente_runtime_config c
     where c.id_tenant = p_tenant and c.phone_number_id = v_item ->> 'phone_number_id';

    if (v_actual #>> '{pedido,minimo_mayorista}') is distinct from p_esperado::text then
      raise exception 'minimo_cambio_mientras_tanto' using errcode = 'P0001';
    end if;
    if v_actual is distinct from (v_item -> 'antes') then
      raise exception 'config_cambio_mientras_tanto' using errcode = 'P0001';
    end if;
    -- Lo que se escribe es una configuración (objeto) con EL mínimo nuevo, y nada más.
    if jsonb_typeof(v_item -> 'despues') is distinct from 'object'
       or jsonb_typeof(v_item #> '{despues,pedido,minimo_mayorista}') is distinct from 'number'
       or (v_item #>> '{despues,pedido,minimo_mayorista}') is distinct from p_nuevo::text then
      raise exception 'cambio_invalido' using errcode = 'P0001';
    end if;

    update public.dulabs_agente_runtime_config
       set negocio = v_item -> 'despues', updated_at = now()
     where id_tenant = p_tenant and phone_number_id = v_item ->> 'phone_number_id';

    insert into public.dulabs_agente_config_cambios (id_tenant, phone_number_id, actor_user_id, campo, antes, despues)
    values (
      p_tenant,
      v_item ->> 'phone_number_id',
      p_actor,
      'pedido.minimo_mayorista',
      jsonb_build_object('minimo', p_esperado, 'textos', coalesce(v_item -> 'textos_antes', '{}'::jsonb)),
      jsonb_build_object('minimo', p_nuevo, 'textos', coalesce(v_item -> 'textos_despues', '{}'::jsonb))
    );
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('cambio', true, 'filas', v_n);
end;
$$;

-- Todo esto es solo del backend: ni el navegador ni un cliente con la llave pública pueden llamarlo.
revoke all on function public.dulabs_agente_minimo_mayorista_ver(uuid) from public, anon, authenticated;
revoke all on function public.dulabs_agente_minimo_mayorista_aplicar(uuid, uuid, bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.dulabs_agente_minimo_mayorista_ver(uuid) to service_role;
grant execute on function public.dulabs_agente_minimo_mayorista_aplicar(uuid, uuid, bigint, bigint, jsonb) to service_role;

commit;
