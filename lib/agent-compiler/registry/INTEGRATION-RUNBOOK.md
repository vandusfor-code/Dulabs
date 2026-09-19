# Business Agent Registry — Runbook de integración real (Bloque 14)

Estado: **Fase 1 auditada ✅ · harness gated listo ✅ · Fase 3 (correr contra DB real) PENDIENTE de entorno seguro.**

Este runbook documenta *exactamente* qué crear/configurar para validar el Registry
contra un Postgres/Supabase real **sin tocar producción**. Nada aquí se ejecuta
automáticamente; requiere una acción humana (crear el proyecto dedicado / correr
el harness con el opt-in explícito).

## Por qué no se corrió todavía

- No hay Supabase local: **sin `supabase` CLI, sin Docker, sin `supabase/config.toml`** en este entorno.
- No hay staging separado: `.env.local` apunta al **mismo proyecto de producción** (`SUPABASE_URL=https://eobppll…`), confirmado por la cabecera del harness y por memoria (`feedback-worker-tests-produccion`).
- El harness escribe filas **PERMANENTES** en `dulabs_business_agent_versions` (append-only, trigger deny-delete). Aunque usa **solo tenants descartables** (`99999999-dead-…`, cero impacto en tenants reales), no hay cleanup posible → no debe correrse contra prod sin decisión explícita.

## Auditoría Fase 1 (hecha, sin cambios de código)

`registry-store-supabase.ts` es consistente con `20261018000000_dulabs_business_agent_versions.sql`:
- INSERT usa exactamente: `tenant_id, flow_id, flow_version_id, spec_json, spec_checksum, ir_json, ir_checksum, gate_rules_json, flow_checksum, validation_status, validation_report, compiled_by` (resto por default).
- Lectura por `(tenant_id, flow_version_id)` (unique constraint) + join a `dulabs_flow_versions`.
- Publish/rollback reutilizan `publishFlowVersion` → RPC atómico **`dulabs_flow_publish_version`** (row-lock) — no se reimplementa.
- Binding = `dulabs_clientes_config.flow_activo/.flow_id` (WHERE `id_tenant`, nunca cross-tenant).
- `retired_at` (best-effort, columna ya existente) para SUPERSEDED.

Sin tablas/columnas/RPC inventados.

## Opción A — Proyecto Supabase DEDICADO (recomendada, 0 riesgo sobre prod)

1. Crear un proyecto Supabase **nuevo y separado** (no el de prod).
2. Aplicar **todas** las migraciones (son interdependientes; el Registry depende de la cadena flow-store + RLS + clientes_config):
   - `supabase link --project-ref <ref-dedicado>` y `supabase db push`, **o** aplicar `supabase/migrations/*.sql` en orden.
   - Dependencias mínimas del Registry: `20260828100000_dulabs_flow_store.sql`, `20260828110000_dulabs_flow_store_critical_fixes.sql` (RPC `dulabs_flow_publish_version`), `20260718090300_rls_tenant_por_membresia.sql` (helper `dulabs_tenant_del_usuario`), la migración de `dulabs_clientes_config`, y `20261018000000_dulabs_business_agent_versions.sql`.
3. Poner las credenciales del proyecto dedicado en un archivo **no committeado** (p. ej. `.env.integration`, ya cubierto por el `.gitignore` de `.env*`):
   ```
   SUPABASE_URL=https://<ref-dedicado>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service_role_del_proyecto_dedicado>
   ```
4. Correr el harness gated:
   ```bash
   RUN_AGENT_COMPILER_SUPABASE_INTEGRATION_TESTS=1 \
     npx tsx --env-file=.env.integration --test \
     lib/agent-compiler/registry/registry-store-supabase.integration.test.ts
   ```

## Opción B — Contra PROD con tenants descartables (irreversible; requiere OK explícito)

La migración `20261018000000` ya está aplicada en prod. Las dependencias ya existen (prod corre el flow path). El harness es seguro por diseño (tenants `99999999-dead-…`), pero deja filas permanentes. Comando:
```bash
RUN_AGENT_COMPILER_SUPABASE_INTEGRATION_TESTS=1 \
  npx tsx --env-file=.env.local --test \
  lib/agent-compiler/registry/registry-store-supabase.integration.test.ts
```
`--env-file` carga las credenciales sin imprimirlas. Solo con autorización explícita (decisión irreversible sobre prod).

## Qué verifica el harness (evidencia real, no fake en memoria)

`createDraftVersion` real (dulabs_flows + dulabs_flow_versions + dulabs_business_agent_versions) · `publishVersion` real (RPC `dulabs_flow_publish_version`, pointer consistente) · `resolvePublishedVersion` real · checksum persistido == calculado · gate_rules persistidas == calculadas · **tenant isolation real** (tenant B no lee/publica versión de A). **No** cubre: concurrencia real (dos conexiones), rendimiento.

## Después del Registry real (Fase 4 — primer E2E real, prerequisitos)

Requiere infra/credenciales que NO están en este entorno:
- Un número de WhatsApp Cloud API real + `meta_permanent_token` en `dulabs_clientes_config`.
- Un Business Agent **publicado** y su número **vinculado** (`flow_activo=true`, `flow_id`).
- `ANTHROPIC_API_KEY` real (para el LLM del Flow Engine y el clasificador semántico del Gate).
- Provider de citas: `internal` (dulabs_especialistas/dulabs_citas_especialista) es la vía lista; Nylas solo tiene grant para AMORE (env `NYLAS_GRANT_ID_AMORE`); Google Calendar no soportado.
- La verificación E2E real (webhook → agente → WhatsApp) debe hacerse en el número/entorno que autorices, nunca sobre un tenant real en uso.
