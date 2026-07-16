-- Políticas RLS de SOLO LECTURA por tenant, como red de seguridad a nivel de
-- base de datos. Hoy todo el acceso a datos pasa por el backend (service_role,
-- que ignora RLS), así que estas políticas no cambian ningún comportamiento
-- existente — pero garantizan que si el frontend (anon/authenticated key)
-- llegara a consultar estas tablas directo, cada tenant solo vería sus filas.
--
-- Deliberadamente NO se crean políticas de INSERT/UPDATE/DELETE: toda
-- escritura debe seguir pasando por las rutas del backend.
--
-- dulabs_clientes_config queda deliberadamente SIN política de SELECT:
-- contiene secretos por fila (meta_permanent_token, api_key_ia) y RLS filtra
-- filas, no columnas — exponerla al rol authenticated filtraría los secretos
-- del propio tenant hacia el navegador. Sigue accesible solo vía service_role.

-- Función security definer: expone únicamente los phone_number_id del tenant
-- autenticado, sin abrir dulabs_clientes_config al rol authenticated. Se usa
-- en las políticas de las tablas que no tienen columna id_tenant propia.
create or replace function public.dulabs_numeros_del_tenant()
returns setof text
language sql
security definer
set search_path = public
stable
as $$
  select phone_number_id
  from public.dulabs_clientes_config
  where id_tenant = auth.uid()
$$;

revoke all on function public.dulabs_numeros_del_tenant() from public;
grant execute on function public.dulabs_numeros_del_tenant() to authenticated;

comment on function public.dulabs_numeros_del_tenant() is
  'Números (phone_number_id) del tenant autenticado, para políticas RLS de tablas sin columna id_tenant. SECURITY DEFINER: lee dulabs_clientes_config sin exponer la tabla.';

-- Tablas con columna id_tenant directa -----------------------------------

drop policy if exists tenant_select on public.dulabs_suscripciones;
create policy tenant_select on public.dulabs_suscripciones
  for select to authenticated
  using (id_tenant = auth.uid());

drop policy if exists tenant_select on public.dulabs_pagos;
create policy tenant_select on public.dulabs_pagos
  for select to authenticated
  using (id_tenant = auth.uid());

drop policy if exists tenant_select on public.dulabs_plantillas;
create policy tenant_select on public.dulabs_plantillas
  for select to authenticated
  using (id_tenant = auth.uid());

drop policy if exists tenant_select on public.dulabs_campanas;
create policy tenant_select on public.dulabs_campanas
  for select to authenticated
  using (id_tenant = auth.uid());

-- Tablas relacionadas al tenant vía phone_number_id -----------------------

drop policy if exists tenant_select on public.dulabs_mensajes_log;
create policy tenant_select on public.dulabs_mensajes_log
  for select to authenticated
  using (phone_number_id in (select public.dulabs_numeros_del_tenant()));

drop policy if exists tenant_select on public.dulabs_pausas_chat;
create policy tenant_select on public.dulabs_pausas_chat
  for select to authenticated
  using (phone_number_id in (select public.dulabs_numeros_del_tenant()));
