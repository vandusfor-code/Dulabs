-- Antes de esta migración, "id_tenant = auth.uid()" era literal: todo
-- usuario ERA su propio tenant. Ahora un usuario puede ser MIEMBRO de un
-- tenant ajeno (invitado), así que el tenant del usuario autenticado ya no
-- es necesariamente su propio auth.uid() — hay que resolverlo vía
-- dulabs_miembros_equipo. Esto reemplaza (create or replace / drop+create
-- policy) objetos de la migración 20260717090000_politicas_rls_lectura_tenant.sql
-- sin editar ese archivo, como exige la convención del repo.

create or replace function public.dulabs_tenant_del_usuario()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select tenant_id
  from public.dulabs_miembros_equipo
  where user_id = auth.uid() and estado = 'activo'
  limit 1
$$;

revoke all on function public.dulabs_tenant_del_usuario() from public;
grant execute on function public.dulabs_tenant_del_usuario() to authenticated;

comment on function public.dulabs_tenant_del_usuario() is
  'tenant_id del miembro de equipo ACTIVO autenticado, o null si no lo es. SECURITY DEFINER: lee dulabs_miembros_equipo sin exponer la tabla completa al rol authenticated.';

create or replace function public.dulabs_numeros_del_tenant()
returns setof text
language sql
security definer
set search_path = public
stable
as $$
  select phone_number_id
  from public.dulabs_clientes_config
  where id_tenant = public.dulabs_tenant_del_usuario()
$$;

-- Tablas con columna id_tenant directa: ahora resuelven el tenant vía
-- membresía de equipo en vez de "id_tenant = auth.uid()" literal.

drop policy if exists tenant_select on public.dulabs_suscripciones;
create policy tenant_select on public.dulabs_suscripciones
  for select to authenticated
  using (id_tenant = public.dulabs_tenant_del_usuario());

drop policy if exists tenant_select on public.dulabs_pagos;
create policy tenant_select on public.dulabs_pagos
  for select to authenticated
  using (id_tenant = public.dulabs_tenant_del_usuario());

drop policy if exists tenant_select on public.dulabs_plantillas;
create policy tenant_select on public.dulabs_plantillas
  for select to authenticated
  using (id_tenant = public.dulabs_tenant_del_usuario());

drop policy if exists tenant_select on public.dulabs_campanas;
create policy tenant_select on public.dulabs_campanas
  for select to authenticated
  using (id_tenant = public.dulabs_tenant_del_usuario());

-- Tablas de equipo/asignación nuevas: mismo patrón de solo lectura que el
-- resto del repo. Deliberadamente sin políticas de INSERT/UPDATE/DELETE.

drop policy if exists propio_o_equipo_select on public.dulabs_miembros_equipo;
create policy propio_o_equipo_select on public.dulabs_miembros_equipo
  for select to authenticated
  using (user_id = auth.uid() or tenant_id = public.dulabs_tenant_del_usuario());

drop policy if exists tenant_select on public.dulabs_conversacion_asignaciones;
create policy tenant_select on public.dulabs_conversacion_asignaciones
  for select to authenticated
  using (phone_number_id in (select public.dulabs_numeros_del_tenant()));

drop policy if exists tenant_select on public.dulabs_conversacion_eventos;
create policy tenant_select on public.dulabs_conversacion_eventos
  for select to authenticated
  using (phone_number_id in (select public.dulabs_numeros_del_tenant()));
