-- Flow Store — verificación manual de RLS, idempotencia e inmutabilidad.
-- Ejecutar en Supabase SQL Editor DESPUÉS de 20260828100000_dulabs_flow_store.sql
--
-- Requiere: función dulabs_tenant_del_usuario() y un usuario authenticated
-- con membresía en un tenant de prueba.

-- ---------------------------------------------------------------------------
-- 1. Credenciales: authenticated NO debe ver filas
-- ---------------------------------------------------------------------------
-- SET ROLE authenticated;
-- SET request.jwt.claim.sub = '<user-uuid-con-membresia>';
-- SELECT count(*) FROM dulabs_flow_credentials; -- debe ser 0 o permission denied
-- RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2. Idempotencia eventos (INSERT ON CONFLICT DO NOTHING)
-- ---------------------------------------------------------------------------
-- INSERT INTO dulabs_flow_events (tenant_id, flow_execution_id, event_id, event_type)
-- VALUES ('...', '...', 'wamid.TEST', 'text')
-- ON CONFLICT (tenant_id, flow_execution_id, event_id) DO NOTHING;
-- Segundo INSERT idéntico → 0 filas nuevas.

-- ---------------------------------------------------------------------------
-- 3. DELETE en auditoría debe fallar
-- ---------------------------------------------------------------------------
-- DELETE FROM dulabs_flow_events WHERE id = 1;
-- ERROR: DELETE prohibido en tabla de auditoría dulabs_flow_events

-- ---------------------------------------------------------------------------
-- 4. Inmutabilidad definition_json publicado
-- ---------------------------------------------------------------------------
-- UPDATE dulabs_flow_versions SET definition_json = '{"hacked":true}'
-- WHERE tenant_id = '...' AND id = '...' AND published_at IS NOT NULL;
-- ERROR: definition_json es inmutable tras publicación

-- ---------------------------------------------------------------------------
-- 5. FK compuesta cross-tenant (ejecución → versión de otro tenant)
-- ---------------------------------------------------------------------------
-- INSERT INTO dulabs_flow_executions (tenant_id, flow_id, flow_version_id, ...)
-- con flow_version_id de tenant A pero tenant_id = tenant B → ERROR 23503

-- ---------------------------------------------------------------------------
-- 6. FK compuesta integration en effect
-- ---------------------------------------------------------------------------
-- INSERT INTO dulabs_flow_effects (..., tenant_id = B, integration_id de tenant A)
-- → ERROR 23503 (no existe par tenant B + integration_id A)
