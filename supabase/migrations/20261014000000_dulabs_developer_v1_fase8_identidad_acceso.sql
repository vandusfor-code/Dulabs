-- DuLabs Developer V1 -- Fase 8 (Workspaces + Users + API Keys, autorizado).
-- Migración puramente ADITIVA, aislada de Business y AMORE. NO modifica
-- ninguna tabla, función ni política de Business (en particular NUNCA toca
-- dulabs_miembros_equipo ni dulabs_tenant_del_usuario()).
--
-- Decisiones congeladas (D1-D6):
--   D1: capa de identidad propia de Developer (dulabs_dev_memberships),
--       multi-workspace (SIN unique(user_id)), roles OWNER/ADMIN/MEMBER.
--   D2: compat hacia atrás sin backfill -- una membresía de Business ACTIVA
--       sin fila Developer para ese workspace = OWNER implícito. Si existe
--       fila Developer, esa MANDA (aunque esté suspendida -> sin acceso).
--   D5: nueva función de resolución Developer + RLS de tablas Developer
--       actualizada para honrarla, con fallback a Business. Solo tablas
--       Developer.
--
-- workspace_id sigue siendo == tenant_id (uuid). No se crea tabla de
-- workspaces: un workspace ES un tenant, igual que en Fases 1-7.

-- ============================================================
-- 1. MEMBERSHIPS (identidad/roles propios de Developer)
-- ============================================================
create table if not exists public.dulabs_dev_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  rol text not null default 'MEMBER' check (rol in ('OWNER', 'ADMIN', 'MEMBER')),
  estado text not null default 'activo' check (estado in ('activo', 'suspendido')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un usuario tiene A LO SUMO una membresía por workspace (idempotencia de
  -- alta + protección real contra creación concurrente duplicada). NO hay
  -- unique(user_id) -> un usuario puede pertenecer a varios workspaces
  -- (multi-workspace, a diferencia de dulabs_miembros_equipo de Business).
  constraint dulabs_dev_memberships_ws_user_key unique (workspace_id, user_id)
);

create index if not exists dulabs_dev_memberships_user_idx
  on public.dulabs_dev_memberships (user_id) where estado = 'activo';
create index if not exists dulabs_dev_memberships_workspace_idx
  on public.dulabs_dev_memberships (workspace_id) where estado = 'activo';

alter table public.dulabs_dev_memberships enable row level security;

comment on table public.dulabs_dev_memberships is
  'DuLabs Developer V1 (Fase 8). Identidad/roles propios de Developer -- multi-workspace, roles OWNER/ADMIN/MEMBER. NUNCA reemplaza dulabs_miembros_equipo (Business): una membresía Business activa sin fila acá = OWNER implícito (D2). Mutaciones solo por backend service_role.';

-- ============================================================
-- 2. RESOLUCIÓN Developer (D2/D5) -- set de workspaces del usuario
-- ============================================================
-- Devuelve TODOS los workspaces donde el usuario autenticado tiene acceso
-- efectivo: membresías Developer ACTIVAS, MÁS (fallback D2) los tenants
-- donde tiene una membresía Business activa Y todavía no existe NINGUNA
-- fila Developer (de cualquier estado) -- así una fila Developer suspendida
-- tiene prioridad y corta el acceso, nunca la "resucita" el fallback.
create or replace function public.dulabs_dev_workspaces_del_usuario()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select d.workspace_id
    from public.dulabs_dev_memberships d
   where d.user_id = auth.uid() and d.estado = 'activo'
  union
  select m.tenant_id
    from public.dulabs_miembros_equipo m
   where m.user_id = auth.uid() and m.estado = 'activo'
     and not exists (
       select 1 from public.dulabs_dev_memberships d2
        where d2.user_id = auth.uid() and d2.workspace_id = m.tenant_id
     )
$$;

revoke all on function public.dulabs_dev_workspaces_del_usuario() from public;
grant execute on function public.dulabs_dev_workspaces_del_usuario() to authenticated;

comment on function public.dulabs_dev_workspaces_del_usuario() is
  'DuLabs Developer V1 (Fase 8). Workspaces con acceso efectivo del usuario autenticado: membresías Developer activas + fallback a membresías Business activas sin fila Developer (D2). SECURITY DEFINER. Solo lectura, para RLS de tablas Developer.';

-- RLS de dulabs_dev_memberships: un usuario ve las membresías de los
-- workspaces a los que pertenece (o su propia fila). Sin políticas de
-- mutación (todo por service_role).
drop policy if exists tenant_select on public.dulabs_dev_memberships;
create policy tenant_select on public.dulabs_dev_memberships
  for select to authenticated
  using (user_id = auth.uid() or workspace_id in (select public.dulabs_dev_workspaces_del_usuario()));

-- ============================================================
-- 3. RLS de tablas Developer -- honrar la resolución Developer (D5)
-- ============================================================
-- Se reemplaza `workspace_id = dulabs_tenant_del_usuario()` por
-- `workspace_id in (select dulabs_dev_workspaces_del_usuario())` SOLO en las
-- tablas Developer. Como la nueva función incluye el fallback Business, los
-- flujos y tests existentes (que resuelven vía dulabs_miembros_equipo)
-- siguen viendo exactamente sus mismas filas. NUNCA se tocan políticas de
-- tablas de Business.
drop policy if exists tenant_select on public.dulabs_dev_api_keys;
create policy tenant_select on public.dulabs_dev_api_keys
  for select to authenticated
  using (workspace_id in (select public.dulabs_dev_workspaces_del_usuario()));

drop policy if exists tenant_select on public.dulabs_dev_whatsapp_numbers;
create policy tenant_select on public.dulabs_dev_whatsapp_numbers
  for select to authenticated
  using (workspace_id in (select public.dulabs_dev_workspaces_del_usuario()));

drop policy if exists tenant_select on public.dulabs_dev_webhook_configs;
create policy tenant_select on public.dulabs_dev_webhook_configs
  for select to authenticated
  using (workspace_id in (select public.dulabs_dev_workspaces_del_usuario()));

drop policy if exists tenant_select on public.dulabs_dev_jobs;
create policy tenant_select on public.dulabs_dev_jobs
  for select to authenticated
  using (workspace_id in (select public.dulabs_dev_workspaces_del_usuario()));

drop policy if exists tenant_select on public.dulabs_dev_usage_ledger;
create policy tenant_select on public.dulabs_dev_usage_ledger
  for select to authenticated
  using (workspace_id in (select public.dulabs_dev_workspaces_del_usuario()));

drop policy if exists tenant_select on public.dulabs_dev_events;
create policy tenant_select on public.dulabs_dev_events
  for select to authenticated
  using (workspace_id in (select public.dulabs_dev_workspaces_del_usuario()));

drop policy if exists tenant_select on public.dulabs_dev_workspace_plans;
create policy tenant_select on public.dulabs_dev_workspace_plans
  for select to authenticated
  using (workspace_id in (select public.dulabs_dev_workspaces_del_usuario()));

-- ============================================================
-- 4. ROTACIÓN ATÓMICA de API key (D6, prioridad 6: atomicidad)
-- ============================================================
-- Revoca la key vieja y crea la nueva en UNA transacción -- nunca deja al
-- workspace sin key por una falla a mitad de camino, ni deja dos activas.
-- El hash/prefijo de la nueva key se generan en TS (crypto) y se pasan acá;
-- la clave en claro NUNCA viaja a la DB. Scoped por workspace_id: jamás rota
-- una key de otro workspace. Si la vieja no existe en el workspace o ya está
-- revocada, no crea nada.
create or replace function public.dulabs_dev_rotar_api_key(
  p_workspace_id uuid,
  p_old_id uuid,
  p_key_hash text,
  p_prefix text
)
returns table (resultado text, new_id uuid, new_name text, new_created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_name text;
  v_new_id uuid;
  v_created timestamptz;
begin
  update public.dulabs_dev_api_keys
     set revoked_at = now()
   where id = p_old_id and workspace_id = p_workspace_id and revoked_at is null
   returning name into v_old_name;

  if not found then
    return query select 'old_no_encontrada_o_ya_revocada'::text, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  insert into public.dulabs_dev_api_keys (workspace_id, name, key_hash, prefix)
  values (p_workspace_id, v_old_name, p_key_hash, p_prefix)
  returning id, created_at into v_new_id, v_created;

  return query select 'rotada'::text, v_new_id, v_old_name, v_created;
end;
$$;

revoke all on function public.dulabs_dev_rotar_api_key(uuid, uuid, text, text) from public;
grant execute on function public.dulabs_dev_rotar_api_key(uuid, uuid, text, text) to service_role;

-- ============================================================
-- 5. MUTACIÓN DE MIEMBROS con invariante de último OWNER (D4, atomicidad)
-- ============================================================
-- Degradar o eliminar al ÚLTIMO OWNER activo de un workspace debe fallar
-- SIEMPRE (nunca dejar un workspace sin dueño). El advisory lock por
-- workspace serializa el conteo+mutación -> dos degradaciones concurrentes
-- de dos owners distintos no pueden dejar el workspace en 0 owners (race
-- real cerrada, no solo "el código revisa antes").

create or replace function public.dulabs_dev_cambiar_rol_miembro(
  p_workspace_id uuid,
  p_membership_id uuid,
  p_nuevo_rol text
)
returns table (resultado text, rol text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol_actual text;
  v_estado text;
  v_owners int;
begin
  if p_nuevo_rol not in ('OWNER', 'ADMIN', 'MEMBER') then
    return query select 'rol_invalido'::text, null::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('dev_members:' || p_workspace_id::text, 0));

  select m.rol, m.estado into v_rol_actual, v_estado
    from public.dulabs_dev_memberships m
   where m.id = p_membership_id and m.workspace_id = p_workspace_id;
  if not found then
    return query select 'no_encontrado'::text, null::text;
    return;
  end if;

  -- Degradar a un OWNER activo solo si queda al menos otro OWNER activo.
  if v_rol_actual = 'OWNER' and v_estado = 'activo' and p_nuevo_rol <> 'OWNER' then
    select count(*) into v_owners
      from public.dulabs_dev_memberships o
     where o.workspace_id = p_workspace_id and o.rol = 'OWNER' and o.estado = 'activo';
    if v_owners <= 1 then
      return query select 'ultimo_owner'::text, null::text;
      return;
    end if;
  end if;

  update public.dulabs_dev_memberships
     set rol = p_nuevo_rol, updated_at = now()
   where id = p_membership_id and workspace_id = p_workspace_id;

  return query select 'ok'::text, p_nuevo_rol;
end;
$$;

revoke all on function public.dulabs_dev_cambiar_rol_miembro(uuid, uuid, text) from public;
grant execute on function public.dulabs_dev_cambiar_rol_miembro(uuid, uuid, text) to service_role;

create or replace function public.dulabs_dev_eliminar_miembro(
  p_workspace_id uuid,
  p_membership_id uuid
)
returns table (resultado text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
  v_estado text;
  v_owners int;
begin
  perform pg_advisory_xact_lock(hashtextextended('dev_members:' || p_workspace_id::text, 0));

  select m.rol, m.estado into v_rol, v_estado
    from public.dulabs_dev_memberships m
   where m.id = p_membership_id and m.workspace_id = p_workspace_id;
  if not found then
    return query select 'no_encontrado'::text;
    return;
  end if;

  if v_rol = 'OWNER' and v_estado = 'activo' then
    select count(*) into v_owners
      from public.dulabs_dev_memberships o
     where o.workspace_id = p_workspace_id and o.rol = 'OWNER' and o.estado = 'activo';
    if v_owners <= 1 then
      return query select 'ultimo_owner'::text;
      return;
    end if;
  end if;

  delete from public.dulabs_dev_memberships where id = p_membership_id and workspace_id = p_workspace_id;
  return query select 'ok'::text;
end;
$$;

revoke all on function public.dulabs_dev_eliminar_miembro(uuid, uuid) from public;
grant execute on function public.dulabs_dev_eliminar_miembro(uuid, uuid) to service_role;
