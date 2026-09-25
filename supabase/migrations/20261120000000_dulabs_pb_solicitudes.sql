-- Publi Bordados — SOLICITUDES (Cliente → N Solicitudes).
--
-- Qué es: cada vez que un cliente completa el Flow de Publi Bordados (tipo, nombre, empresa,
-- producto y cantidad válidos) y llega al traspaso a la asesora, se crea UNA solicitud. El
-- cliente NO se duplica: es el contacto real que ya existe (dulabs_clientes_conocidos, único por
-- número del negocio + teléfono). Cada solicitud tiene su propio estado, asesor y fechas; cambiar
-- una nunca modifica otra.
--
-- Qué hace esta migración (ADITIVA): crea dulabs_pb_solicitudes, su trigger de integridad y las
-- funciones que usan el Flow (registrar) y el dashboard (listar / obtener / actualizar). No
-- modifica ninguna tabla, dato, índice, trigger ni permiso existente. Solo service_role.
--
-- Garantías en la BASE DE DATOS (no solo en la app):
--   1. Aislamiento por tenant: la solicitud, su contacto y su número deben ser del MISMO tenant y
--      el número debe pertenecer al tenant en dulabs_clientes_config; el asesor debe ser un
--      miembro ACTIVO del mismo equipo. Toda función filtra por p_tenant (que el backend toma
--      SIEMPRE de la sesión, nunca del request).
--   2. Idempotencia: UNIQUE (id_tenant, flow_execution_id). Una ejecución real del Flow crea como
--      máximo una solicitud, aunque Meta reintente o el efecto se despache dos veces.
--   3. Trazabilidad: flow_execution_id / flow_version_id / evento_id salen de la ejecución REAL
--      (dulabs_flow_executions); si la ejecución no existe, no se registra nada.
--   4. Datos comerciales inmutables: producto, cantidad, tipo, nombre, empresa, contacto, número
--      y ejecución no pueden cambiar después de crearse (trigger).
--   5. Concurrencia: `version` para escritura optimista del dashboard (dos asesoras no se pisan);
--      el Flow solo INSERTA solicitudes nuevas, nunca actualiza una existente.
--
-- Retención: una solicitud nunca se borra en cascada. El contacto no puede borrarse mientras
-- tenga solicitudes (ON DELETE RESTRICT); si se borra un miembro del equipo, sus solicitudes
-- quedan sin asesor (ON DELETE SET NULL). flow_execution_id se conserva aunque la ejecución se
-- purgue (sin FK a propósito: es un identificador de trazabilidad, no una dependencia).
--
-- Datos anteriores: NO se reconstruyen solicitudes. dulabs_clientes_conocidos.custom_fields.pb_*
-- guarda solo la ÚLTIMA solicitud de cada cliente (las anteriores se sobrescribieron) y no se
-- puede probar a qué ejecución corresponde; esos clientes se siguen mostrando como "clientes sin
-- solicitudes" con sus datos intactos. Nada se borra ni se modifica.
--
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE). Rollback (solo si aún no hay datos reales):
--   drop function if exists public.dulabs_pb_registrar_solicitud(uuid, text, text, uuid, jsonb),
--     public.dulabs_pb_listar_solicitudes(uuid, jsonb), public.dulabs_pb_listar_clientes(uuid, jsonb),
--     public.dulabs_pb_obtener_cliente(uuid, bigint), public.dulabs_pb_obtener_solicitud(uuid, bigint),
--     public.dulabs_pb_actualizar_solicitud(uuid, bigint, integer, jsonb);
--   drop table if exists public.dulabs_pb_solicitudes;
--   drop function if exists public.dulabs_pb_solicitudes_integridad();

begin;

-- ============================================================
-- 1. TABLA
-- ============================================================
create table if not exists public.dulabs_pb_solicitudes (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null,
  contacto_id bigint not null references public.dulabs_clientes_conocidos (id) on delete restrict,
  -- Trazabilidad: ejecución real del Flow que creó la solicitud (y su versión / último mensaje).
  flow_execution_id uuid not null,
  flow_version_id uuid,
  evento_id text,
  -- Lo que el cliente declaró en ESTA solicitud (puede cambiar entre solicitudes).
  tipo_cliente text not null,
  nombre text not null,
  nombre_empresa text,
  producto text not null,
  cantidad integer not null,
  -- Ciclo de atención (propio de cada solicitud).
  estado text not null default 'nuevo',
  asesor_id bigint references public.dulabs_miembros_equipo (id) on delete set null,
  asignado_at timestamptz,
  atendido_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_pb_solicitudes_ejecucion_key unique (id_tenant, flow_execution_id),
  constraint dulabs_pb_solicitudes_tipo_check check (tipo_cliente in ('persona_natural', 'empresa')),
  constraint dulabs_pb_solicitudes_nombre_check check (char_length(btrim(nombre)) between 1 and 120),
  constraint dulabs_pb_solicitudes_empresa_check check (
    (tipo_cliente = 'empresa' and nombre_empresa is not null and char_length(btrim(nombre_empresa)) between 1 and 120)
    or (tipo_cliente = 'persona_natural' and nombre_empresa is null)
  ),
  constraint dulabs_pb_solicitudes_producto_check check (producto in ('gorras', 'prendas_de_vestir', 'uniformes', 'otros')),
  constraint dulabs_pb_solicitudes_cantidad_check check (cantidad between 1 and 999999),
  constraint dulabs_pb_solicitudes_estado_check check (estado in ('nuevo', 'en_atencion', 'atendido')),
  constraint dulabs_pb_solicitudes_version_check check (version >= 1),
  constraint dulabs_pb_solicitudes_evento_check check (evento_id is null or char_length(evento_id) <= 200)
);

comment on table public.dulabs_pb_solicitudes is
  'Publi Bordados: una fila por cada flow completado (cliente calificado que pasa a una asesora). El cliente es el contacto (contacto_id). Estado y asesor son de cada solicitud. Solo service_role.';
comment on column public.dulabs_pb_solicitudes.flow_execution_id is
  'dulabs_flow_executions.id de la ejecución REAL que creó la solicitud (idempotencia + trazabilidad). Sin FK: se conserva aunque la ejecución se purgue.';
comment on column public.dulabs_pb_solicitudes.evento_id is
  'wamid del mensaje de WhatsApp que completó el flow (metadata.lastEventId de la ejecución), si estaba disponible.';
comment on column public.dulabs_pb_solicitudes.version is
  'Escritura optimista del dashboard: cada cambio de estado/asesor exige la versión leída y la incrementa.';

-- Listado / bandeja por fecha, por estado y por asesor; historial por cliente.
create index if not exists dulabs_pb_solicitudes_tenant_fecha_idx
  on public.dulabs_pb_solicitudes (id_tenant, created_at desc, id desc);
create index if not exists dulabs_pb_solicitudes_tenant_estado_idx
  on public.dulabs_pb_solicitudes (id_tenant, estado, created_at desc, id desc);
create index if not exists dulabs_pb_solicitudes_tenant_asesor_idx
  on public.dulabs_pb_solicitudes (id_tenant, asesor_id, created_at desc)
  where asesor_id is not null;
create index if not exists dulabs_pb_solicitudes_contacto_idx
  on public.dulabs_pb_solicitudes (contacto_id, created_at desc, id desc);

alter table public.dulabs_pb_solicitudes enable row level security;
revoke all on table public.dulabs_pb_solicitudes from anon, authenticated;

-- ============================================================
-- 2. INTEGRIDAD (tenant, asesor, inmutabilidad, fechas)
-- ============================================================
create or replace function public.dulabs_pb_solicitudes_integridad()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_contacto record;
begin
  if tg_op = 'INSERT' then
    select id_tenant, phone_number_id into v_contacto
      from public.dulabs_clientes_conocidos where id = new.contacto_id;
    if not found or v_contacto.id_tenant is distinct from new.id_tenant or v_contacto.phone_number_id is distinct from new.phone_number_id then
      raise exception 'pb_contacto_ajeno' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.dulabs_clientes_config c
       where c.phone_number_id = new.phone_number_id and c.id_tenant = new.id_tenant
    ) then
      raise exception 'pb_numero_ajeno' using errcode = 'P0001';
    end if;
    new.version := 1;
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := new.created_at;
  else
    if new.id_tenant is distinct from old.id_tenant
       or new.phone_number_id is distinct from old.phone_number_id
       or new.contacto_id is distinct from old.contacto_id
       or new.flow_execution_id is distinct from old.flow_execution_id
       or new.flow_version_id is distinct from old.flow_version_id
       or new.evento_id is distinct from old.evento_id
       or new.tipo_cliente is distinct from old.tipo_cliente
       or new.nombre is distinct from old.nombre
       or new.nombre_empresa is distinct from old.nombre_empresa
       or new.producto is distinct from old.producto
       or new.cantidad is distinct from old.cantidad
       or new.created_at is distinct from old.created_at then
      raise exception 'pb_solicitud_inmutable' using errcode = 'P0001';
    end if;
    new.version := old.version + 1;
    new.updated_at := now();
  end if;

  -- Asesor: miembro ACTIVO del MISMO equipo (al asignarlo o cambiarlo).
  if new.asesor_id is not null and (tg_op = 'INSERT' or new.asesor_id is distinct from old.asesor_id) then
    if not exists (
      select 1 from public.dulabs_miembros_equipo m
       where m.id = new.asesor_id and m.tenant_id = new.id_tenant and m.estado = 'activo'
    ) then
      raise exception 'pb_asesor_invalido' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.asignado_at := case when new.asesor_id is null then null else now() end;
    new.atendido_at := case when new.estado = 'atendido' then now() else null end;
  else
    if new.asesor_id is distinct from old.asesor_id then
      new.asignado_at := case when new.asesor_id is null then null else now() end;
    else
      new.asignado_at := old.asignado_at;
    end if;
    if new.estado = 'atendido' and old.estado <> 'atendido' then
      new.atendido_at := now();
    elsif new.estado <> 'atendido' then
      new.atendido_at := null;
    else
      new.atendido_at := old.atendido_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists dulabs_pb_solicitudes_integridad on public.dulabs_pb_solicitudes;
create trigger dulabs_pb_solicitudes_integridad
  before insert or update on public.dulabs_pb_solicitudes
  for each row execute function public.dulabs_pb_solicitudes_integridad();

-- ============================================================
-- 3. REGISTRO DESDE EL FLOW (idempotente, trazable)
-- ============================================================
-- p_datos: { tipo_cliente, nombre, nombre_empresa, producto, cantidad }.
-- Devuelve la solicitud (creada ahora o ya existente para esa ejecución) y su contacto.
create or replace function public.dulabs_pb_registrar_solicitud(
  p_tenant uuid,
  p_phone_number_id text,
  p_telefono text,
  p_flow_execution_id uuid,
  p_datos jsonb
)
returns table (solicitud_id bigint, contacto_id bigint, creada boolean)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_ejecucion record;
  v_contacto record;
  v_id bigint;
  v_tipo text := nullif(btrim(p_datos->>'tipo_cliente'), '');
  v_empresa text := nullif(btrim(p_datos->>'nombre_empresa'), '');
begin
  if not exists (
    select 1 from public.dulabs_clientes_config c where c.phone_number_id = p_phone_number_id and c.id_tenant = p_tenant
  ) then
    raise exception 'pb_numero_ajeno' using errcode = 'P0001';
  end if;

  -- La ejecución debe ser REAL y de esta misma conversación (trazabilidad sin inventar ids).
  select e.flow_version_id, nullif(e.metadata->>'lastEventId', '') as evento
    into v_ejecucion
    from public.dulabs_flow_executions e
   where e.tenant_id = p_tenant and e.id = p_flow_execution_id
     and e.phone_number_id = p_phone_number_id and e.telefono_cliente = p_telefono;
  if not found then
    raise exception 'pb_ejecucion_inexistente' using errcode = 'P0001';
  end if;

  -- Idempotencia: la misma ejecución nunca crea dos solicitudes.
  select s.id, s.contacto_id into v_id, contacto_id
    from public.dulabs_pb_solicitudes s
   where s.id_tenant = p_tenant and s.flow_execution_id = p_flow_execution_id;
  if found then
    solicitud_id := v_id;
    creada := false;
    return next;
    return;
  end if;

  -- Cliente = contacto existente (único por número + teléfono). Se crea solo si no existe
  -- (mismo criterio que resolverOCrearContacto: nombre placeholder = teléfono).
  insert into public.dulabs_clientes_conocidos (id_tenant, phone_number_id, telefono_cliente, nombre)
  values (p_tenant, p_phone_number_id, p_telefono, p_telefono)
  on conflict (phone_number_id, telefono_cliente) do nothing;
  select c.id, c.id_tenant into v_contacto
    from public.dulabs_clientes_conocidos c
   where c.phone_number_id = p_phone_number_id and c.telefono_cliente = p_telefono;
  if v_contacto.id_tenant is distinct from p_tenant then
    raise exception 'pb_contacto_ajeno' using errcode = 'P0001';
  end if;

  insert into public.dulabs_pb_solicitudes (
    id_tenant, phone_number_id, contacto_id, flow_execution_id, flow_version_id, evento_id,
    tipo_cliente, nombre, nombre_empresa, producto, cantidad
  ) values (
    p_tenant, p_phone_number_id, v_contacto.id, p_flow_execution_id, v_ejecucion.flow_version_id, v_ejecucion.evento,
    v_tipo, btrim(coalesce(p_datos->>'nombre', '')),
    case when v_tipo = 'empresa' then v_empresa else null end,
    nullif(btrim(p_datos->>'producto'), ''),
    case when (p_datos->>'cantidad') ~ '^\s*0*[1-9][0-9]{0,5}\s*$' then (btrim(p_datos->>'cantidad'))::integer else null end
  )
  on conflict (id_tenant, flow_execution_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- Carrera con otra invocación de la MISMA ejecución: se devuelve la que ganó.
    select s.id into v_id from public.dulabs_pb_solicitudes s
     where s.id_tenant = p_tenant and s.flow_execution_id = p_flow_execution_id;
    solicitud_id := v_id; contacto_id := v_contacto.id; creada := false;
  else
    solicitud_id := v_id; contacto_id := v_contacto.id; creada := true;
  end if;
  return next;
end;
$$;

-- ============================================================
-- 4. LECTURA PARA EL DASHBOARD (todo filtrado por tenant + números del tenant)
-- ============================================================
-- Fila de solicitud en formato del dashboard (camelCase).
create or replace function public.dulabs_pb_solicitud_json(s public.dulabs_pb_solicitudes, p_telefono text)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', s.id,
    'clienteId', s.contacto_id,
    'telefono', p_telefono,
    'tipoCliente', s.tipo_cliente,
    'nombre', s.nombre,
    'nombreEmpresa', s.nombre_empresa,
    'producto', s.producto,
    'cantidad', s.cantidad,
    'estado', s.estado,
    'asesorId', s.asesor_id,
    'asignadoAt', s.asignado_at,
    'atendidoAt', s.atendido_at,
    'version', s.version,
    'flowExecutionId', s.flow_execution_id,
    'eventoId', s.evento_id,
    'createdAt', s.created_at,
    'updatedAt', s.updated_at
  );
$$;

-- p_filtro: { q, estado, tipo, asesorId, sinAsesor, producto, contactoId, desde, hasta, limite, offset }
create or replace function public.dulabs_pb_listar_solicitudes(p_tenant uuid, p_filtro jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(btrim(coalesce(p_filtro->>'q', '')), '');
  v_q_like text;
  v_q_digitos text;
  v_limite integer := least(greatest(coalesce((p_filtro->>'limite')::integer, 25), 1), 100);
  v_offset integer := greatest(coalesce((p_filtro->>'offset')::integer, 0), 0);
  v_resultado jsonb;
begin
  if v_q is not null then
    v_q_like := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_q_digitos := nullif(regexp_replace(v_q, '\D', '', 'g'), '');
  end if;

  with filtrado as (
    select s, c.telefono_cliente as telefono
      from public.dulabs_pb_solicitudes s
      join public.dulabs_clientes_config cfg on cfg.phone_number_id = s.phone_number_id and cfg.id_tenant = s.id_tenant
      join public.dulabs_clientes_conocidos c on c.id = s.contacto_id
     where s.id_tenant = p_tenant
       and (p_filtro->>'estado' is null or s.estado = p_filtro->>'estado')
       and (p_filtro->>'tipo' is null or s.tipo_cliente = p_filtro->>'tipo')
       and (p_filtro->>'producto' is null or s.producto = p_filtro->>'producto')
       and (p_filtro->>'asesorId' is null or s.asesor_id = (p_filtro->>'asesorId')::bigint)
       and (coalesce((p_filtro->>'sinAsesor')::boolean, false) = false or s.asesor_id is null)
       and (p_filtro->>'contactoId' is null or s.contacto_id = (p_filtro->>'contactoId')::bigint)
       and (p_filtro->>'desde' is null or s.created_at >= (p_filtro->>'desde')::timestamptz)
       and (p_filtro->>'hasta' is null or s.created_at < (p_filtro->>'hasta')::timestamptz)
       and (
         v_q is null
         or lower(s.nombre) like v_q_like
         or lower(coalesce(s.nombre_empresa, '')) like v_q_like
         or (v_q_digitos is not null and char_length(v_q_digitos) >= 3 and c.telefono_cliente like '%' || v_q_digitos || '%')
       )
  ),
  pagina as (
    select * from filtrado f order by (f.s).created_at desc, (f.s).id desc limit v_limite offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtrado),
    'filas', coalesce((select jsonb_agg(public.dulabs_pb_solicitud_json(p.s, p.telefono) order by (p.s).created_at desc, (p.s).id desc) from pagina p), '[]'::jsonb)
  )
  into v_resultado;
  return v_resultado;
end;
$$;

-- Clientes: contactos del tenant con al menos una solicitud, o con datos del flujo anterior
-- (custom_fields.pb_tipo_cliente) aunque todavía no tengan solicitudes. Perfil = el de su
-- última solicitud; sin solicitudes, el guardado en el contacto.
-- p_filtro: { q, tipo, limite, offset }
create or replace function public.dulabs_pb_listar_clientes(p_tenant uuid, p_filtro jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(btrim(coalesce(p_filtro->>'q', '')), '');
  v_q_like text;
  v_q_digitos text;
  v_limite integer := least(greatest(coalesce((p_filtro->>'limite')::integer, 25), 1), 100);
  v_offset integer := greatest(coalesce((p_filtro->>'offset')::integer, 0), 0);
  v_resultado jsonb;
begin
  if v_q is not null then
    v_q_like := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_q_digitos := nullif(regexp_replace(v_q, '\D', '', 'g'), '');
  end if;

  with numeros as (
    select phone_number_id from public.dulabs_clientes_config where id_tenant = p_tenant
  ),
  resumen as (
    select s.contacto_id, count(*) as total_solicitudes, max(s.created_at) as ultima_at
      from public.dulabs_pb_solicitudes s
     where s.id_tenant = p_tenant and s.phone_number_id in (select phone_number_id from numeros)
     group by s.contacto_id
  ),
  ultima as (
    select distinct on (s.contacto_id) s.*
      from public.dulabs_pb_solicitudes s
     where s.id_tenant = p_tenant and s.contacto_id in (select contacto_id from resumen)
     order by s.contacto_id, s.created_at desc, s.id desc
  ),
  clientes as (
    select c.id, c.telefono_cliente, c.phone_number_id, c.created_at,
           coalesce(r.total_solicitudes, 0) as total_solicitudes,
           r.ultima_at,
           coalesce(u.tipo_cliente, c.custom_fields->>'pb_tipo_cliente') as tipo_cliente,
           coalesce(u.nombre, nullif(btrim(c.custom_fields->>'pb_nombre'), ''), c.telefono_cliente) as nombre,
           case when u.id is not null then u.nombre_empresa
                when c.custom_fields->>'pb_tipo_cliente' = 'empresa' then nullif(btrim(c.custom_fields->>'pb_nombre_empresa'), '')
                else null end as nombre_empresa,
           u.id as ultima_id, u.producto as ultima_producto, u.cantidad as ultima_cantidad,
           u.estado as ultima_estado, u.asesor_id as ultima_asesor_id,
           coalesce(r.ultima_at, c.updated_at) as orden_at
      from public.dulabs_clientes_conocidos c
      left join resumen r on r.contacto_id = c.id
      left join ultima u on u.contacto_id = c.id
     where c.id_tenant = p_tenant
       and c.phone_number_id in (select phone_number_id from numeros)
       and (r.contacto_id is not null or c.custom_fields->>'pb_tipo_cliente' in ('persona_natural', 'empresa'))
  ),
  filtrados as (
    select k.*
      from clientes k
     where (p_filtro->>'tipo' is null or k.tipo_cliente = p_filtro->>'tipo')
       and (
         v_q is null
         or lower(k.nombre) like v_q_like
         or lower(coalesce(k.nombre_empresa, '')) like v_q_like
         or (v_q_digitos is not null and char_length(v_q_digitos) >= 3 and k.telefono_cliente like '%' || v_q_digitos || '%')
       )
  ),
  pagina as (
    select * from filtrados f order by f.orden_at desc, f.id desc limit v_limite offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtrados),
    'filas', coalesce((select jsonb_agg(jsonb_build_object(
      'id', f.id,
      'telefono', f.telefono_cliente,
      'tipoCliente', f.tipo_cliente,
      'nombre', f.nombre,
      'nombreEmpresa', f.nombre_empresa,
      'registradoAt', f.created_at,
      'totalSolicitudes', f.total_solicitudes,
      'ultimaSolicitudAt', f.ultima_at,
      'ultimaSolicitud', case when f.ultima_id is null then null else jsonb_build_object(
        'id', f.ultima_id, 'producto', f.ultima_producto, 'cantidad', f.ultima_cantidad,
        'estado', f.ultima_estado, 'asesorId', f.ultima_asesor_id) end,
      'ultimoContactoAt', (
        select m.created_at from public.dulabs_mensajes_log m
         where m.phone_number_id = f.phone_number_id and m.telefono_cliente = f.telefono_cliente
         order by m.created_at desc limit 1)
    ) order by f.orden_at desc, f.id desc) from pagina f), '[]'::jsonb)
  )
  into v_resultado;
  return v_resultado;
end;
$$;

-- Ficha del cliente + historial completo de solicitudes (más reciente primero).
create or replace function public.dulabs_pb_obtener_cliente(p_tenant uuid, p_contacto bigint)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with c as (
    select c.* from public.dulabs_clientes_conocidos c
      join public.dulabs_clientes_config cfg on cfg.phone_number_id = c.phone_number_id and cfg.id_tenant = c.id_tenant
     where c.id = p_contacto and c.id_tenant = p_tenant
       and (
         exists (select 1 from public.dulabs_pb_solicitudes s where s.contacto_id = c.id and s.id_tenant = p_tenant)
         or c.custom_fields->>'pb_tipo_cliente' in ('persona_natural', 'empresa')
       )
  ),
  hist as (
    select s.* from public.dulabs_pb_solicitudes s
      join c on c.id = s.contacto_id
     where s.id_tenant = p_tenant
  )
  select case when not exists (select 1 from c) then null else (
    select jsonb_build_object(
      'cliente', jsonb_build_object(
        'id', c.id,
        'telefono', c.telefono_cliente,
        'registradoAt', c.created_at,
        'tipoCliente', coalesce((select h.tipo_cliente from hist h order by h.created_at desc, h.id desc limit 1), c.custom_fields->>'pb_tipo_cliente'),
        'nombre', coalesce((select h.nombre from hist h order by h.created_at desc, h.id desc limit 1), nullif(btrim(c.custom_fields->>'pb_nombre'), ''), c.telefono_cliente),
        'nombreEmpresa', case
          when exists (select 1 from hist) then (select h.nombre_empresa from hist h order by h.created_at desc, h.id desc limit 1)
          when c.custom_fields->>'pb_tipo_cliente' = 'empresa' then nullif(btrim(c.custom_fields->>'pb_nombre_empresa'), '')
          else null end,
        'totalSolicitudes', (select count(*) from hist),
        'ultimoContactoAt', (
          select m.created_at from public.dulabs_mensajes_log m
           where m.phone_number_id = c.phone_number_id and m.telefono_cliente = c.telefono_cliente
           order by m.created_at desc limit 1),
        -- Datos del flujo anterior (antes de existir solicitudes): solo informativos.
        'datosAnteriores', case when c.custom_fields ? 'pb_producto' then jsonb_build_object(
          'producto', c.custom_fields->>'pb_producto', 'cantidad', c.custom_fields->>'pb_cantidad') else null end
      ),
      'solicitudes', coalesce((
        select jsonb_agg(public.dulabs_pb_solicitud_json(h, c.telefono_cliente) order by h.created_at desc, h.id desc) from hist h
      ), '[]'::jsonb)
    ) from c
  ) end;
$$;

create or replace function public.dulabs_pb_obtener_solicitud(p_tenant uuid, p_id bigint)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select public.dulabs_pb_solicitud_json(s, c.telefono_cliente)
    from public.dulabs_pb_solicitudes s
    join public.dulabs_clientes_config cfg on cfg.phone_number_id = s.phone_number_id and cfg.id_tenant = s.id_tenant
    join public.dulabs_clientes_conocidos c on c.id = s.contacto_id
   where s.id = p_id and s.id_tenant = p_tenant;
$$;

-- ============================================================
-- 5. CAMBIO DE ESTADO / ASESOR (escritura optimista)
-- ============================================================
-- p_cambio: { estado?, asesorId? (número o null) }. Solo cambia lo que viene en p_cambio.
-- Resultado: { resultado: 'ok' | 'no_encontrada' | 'conflicto' | 'asesor_invalido', solicitud? }
create or replace function public.dulabs_pb_actualizar_solicitud(p_tenant uuid, p_id bigint, p_version integer, p_cambio jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_fila public.dulabs_pb_solicitudes;
  v_telefono text;
begin
  if not exists (
    select 1 from public.dulabs_pb_solicitudes s
      join public.dulabs_clientes_config cfg on cfg.phone_number_id = s.phone_number_id and cfg.id_tenant = s.id_tenant
     where s.id = p_id and s.id_tenant = p_tenant
  ) then
    return jsonb_build_object('resultado', 'no_encontrada');
  end if;

  begin
    update public.dulabs_pb_solicitudes s
       set estado = case when p_cambio ? 'estado' then p_cambio->>'estado' else s.estado end,
           asesor_id = case when p_cambio ? 'asesorId' then nullif(p_cambio->>'asesorId', '')::bigint else s.asesor_id end
     where s.id = p_id and s.id_tenant = p_tenant and s.version = p_version
    returning * into v_fila;
  exception when others then
    if sqlerrm = 'pb_asesor_invalido' then
      return jsonb_build_object('resultado', 'asesor_invalido');
    end if;
    raise;
  end;

  if v_fila.id is null then
    return jsonb_build_object('resultado', 'conflicto');
  end if;
  select c.telefono_cliente into v_telefono from public.dulabs_clientes_conocidos c where c.id = v_fila.contacto_id;
  return jsonb_build_object('resultado', 'ok', 'solicitud', public.dulabs_pb_solicitud_json(v_fila, v_telefono));
end;
$$;

-- ============================================================
-- 6. PERMISOS: solo el backend (service_role)
-- ============================================================
revoke all on function public.dulabs_pb_solicitudes_integridad() from public, anon, authenticated;
revoke all on function public.dulabs_pb_registrar_solicitud(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.dulabs_pb_solicitud_json(public.dulabs_pb_solicitudes, text) from public, anon, authenticated;
revoke all on function public.dulabs_pb_listar_solicitudes(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.dulabs_pb_listar_clientes(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.dulabs_pb_obtener_cliente(uuid, bigint) from public, anon, authenticated;
revoke all on function public.dulabs_pb_obtener_solicitud(uuid, bigint) from public, anon, authenticated;
revoke all on function public.dulabs_pb_actualizar_solicitud(uuid, bigint, integer, jsonb) from public, anon, authenticated;
grant execute on function public.dulabs_pb_registrar_solicitud(uuid, text, text, uuid, jsonb) to service_role;
grant execute on function public.dulabs_pb_solicitud_json(public.dulabs_pb_solicitudes, text) to service_role;
grant execute on function public.dulabs_pb_listar_solicitudes(uuid, jsonb) to service_role;
grant execute on function public.dulabs_pb_listar_clientes(uuid, jsonb) to service_role;
grant execute on function public.dulabs_pb_obtener_cliente(uuid, bigint) to service_role;
grant execute on function public.dulabs_pb_obtener_solicitud(uuid, bigint) to service_role;
grant execute on function public.dulabs_pb_actualizar_solicitud(uuid, bigint, integer, jsonb) to service_role;

commit;
