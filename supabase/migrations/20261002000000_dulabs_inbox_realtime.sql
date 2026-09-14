-- Fase 11 (Completion & Debt Zero, autorizado) — habilita Supabase Realtime
-- (Postgres Changes) para el Human Inbox: F9 dejó el Inbox con refresco
-- 100% manual. Esta migración NO crea infraestructura nueva de
-- websockets/backend -- usa el mecanismo ya integrado de Supabase
-- (publicación lógica de Postgres + Realtime Authorization), que YA respeta
-- las políticas RLS reales de estas tablas (ver
-- 20260717090000_politicas_rls_lectura_tenant.sql +
-- 20260718090300_rls_tenant_por_membresia.sql, donde tenant_select en
-- dulabs_mensajes_log ya resuelve el tenant vía membresía de equipo real,
-- no auth.uid() literal) -- verificado antes de escribir esto: esas
-- políticas son correctas para el modelo de equipo actual, así que
-- Realtime hereda el MISMO aislamiento por tenant que ya protege cualquier
-- lectura directa del navegador, sin necesitar ninguna política nueva.
--
-- Solo lectura vía suscripción: el navegador nunca escribe a través de
-- Realtime, solo recibe notificaciones de cambios para refrescar la UI
-- (que sigue llamando a las mismas APIs de siempre para los datos reales).

-- Hallazgo real al preparar esto: dulabs_conversacion_eventos y
-- dulabs_conversacion_estado (F9) tienen RLS habilitado pero SIN ninguna
-- política de SELECT para `authenticated` -- deny-by-default, así que hoy
-- Realtime no les devolvería ninguna fila a un usuario real (no es un
-- riesgo de seguridad, pero sí dejaría esa parte de esta fase inútil sin
-- esto). Se agregan las políticas de solo lectura por tenant que faltaban,
-- MISMO criterio exacto que ya usa dulabs_mensajes_log/dulabs_pausas_chat
-- (20260717090000_politicas_rls_lectura_tenant.sql): nunca INSERT/UPDATE/
-- DELETE para authenticated, esa escritura sigue siendo exclusiva del
-- backend con service-role.
drop policy if exists tenant_select on public.dulabs_conversacion_eventos;
create policy tenant_select on public.dulabs_conversacion_eventos
  for select to authenticated
  using (phone_number_id in (select public.dulabs_numeros_del_tenant()));

drop policy if exists tenant_select on public.dulabs_conversacion_estado;
create policy tenant_select on public.dulabs_conversacion_estado
  for select to authenticated
  using (phone_number_id in (select public.dulabs_numeros_del_tenant()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dulabs_mensajes_log'
  ) then
    alter publication supabase_realtime add table public.dulabs_mensajes_log;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dulabs_conversacion_eventos'
  ) then
    alter publication supabase_realtime add table public.dulabs_conversacion_eventos;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dulabs_conversacion_estado'
  ) then
    alter publication supabase_realtime add table public.dulabs_conversacion_estado;
  end if;
end $$;
