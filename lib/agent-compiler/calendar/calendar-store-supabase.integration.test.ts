/**
 * Bloque 17 — harness de integración REAL contra Supabase para el store del
 * calendario (Bloque 15). Mismo patrón EXACTO que
 * lib/agent-compiler/registry/registry-store-supabase.integration.test.ts:
 * gated por 3 requisitos, tenants descartables, nunca en el manifiesto
 * offline.
 *
 * ⚠️ NO SE EJECUTA POR DEFECTO. Este repositorio no tiene staging separado:
 * .env.local apunta al MISMO proyecto de producción que usa todo lo demás.
 *
 * REQUISITOS (los 3, a propósito):
 *   1. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en el entorno.
 *   2. La migración supabase/migrations/20261101000000_dulabs_business_agent_calendar.sql
 *      YA aplicada en ESE proyecto (este harness no la aplica).
 *   3. RUN_AGENT_COMPILER_SUPABASE_INTEGRATION_TESTS=1.
 *
 * Diferencia con el harness del Registry: dulabs_business_agent_calendar_connections
 * SÍ admite DELETE (sin trigger deny-delete) -- cada test limpia su propia
 * fila con deleteConnection al terminar. Los states OAuth (tabla de un solo
 * uso, sin PII, strings aleatorios) se dejan expirar solos -- no hay
 * deleteOAuthState en el puerto (no se inventa acá).
 *
 * grant_id/API key: NUNCA se imprimen -- solo se comparan por igualdad o se
 * verifica su AUSENCIA en la proyección pública.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseCalendarStore } from "@/lib/agent-compiler/calendar/calendar-store-supabase";
import { toPublicConnection } from "@/lib/agent-compiler/calendar/types";

const OPT_IN = process.env.RUN_AGENT_COMPILER_SUPABASE_INTEGRATION_TESTS === "1";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUEDE_CORRER = OPT_IN && Boolean(SUPABASE_URL) && Boolean(SERVICE_ROLE_KEY);

/** Mismo prefijo reconocible que el harness del Registry -- nunca un tenant real. */
function tenantDescartable(): string {
  return `99999999-dead-9eee-9eee-${randomUUID().slice(24)}`;
}

describe("Calendar Store — integración REAL contra Supabase (gated)", { skip: !PUEDE_CORRER }, () => {
  if (!PUEDE_CORRER) {
    it("SALTADO: falta RUN_AGENT_COMPILER_SUPABASE_INTEGRATION_TESTS=1 y/o credenciales de Supabase", () => {
      assert.ok(true);
    });
    return;
  }

  const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const store = createSupabaseCalendarStore(supabase);

  it("OAuth state real: create + consume atómico -> ok, tenant correcto", async () => {
    const tenantId = tenantDescartable();
    const state = `test-state-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await store.createOAuthState({ state, tenantId, expiresAt });

    const consumed = await store.consumeOAuthState(state, new Date().toISOString());
    assert.equal(consumed.ok, true, JSON.stringify(consumed));
    if (consumed.ok) assert.equal(consumed.tenantId, tenantId);
  });

  it("replay real: el mismo state no puede consumirse dos veces (constraint atómico de Postgres)", async () => {
    const tenantId = tenantDescartable();
    const state = `test-state-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await store.createOAuthState({ state, tenantId, expiresAt });

    const first = await store.consumeOAuthState(state, new Date().toISOString());
    assert.equal(first.ok, true);
    const replay = await store.consumeOAuthState(state, new Date().toISOString());
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.reason, "already_consumed");
  });

  it("expiración real: un state ya vencido no se puede consumir", async () => {
    const tenantId = tenantDescartable();
    const state = `test-state-${randomUUID()}`;
    const yaVencido = new Date(Date.now() - 60 * 1000).toISOString(); // hace 1 minuto
    await store.createOAuthState({ state, tenantId, expiresAt: yaVencido });

    const consumed = await store.consumeOAuthState(state, new Date().toISOString());
    assert.equal(consumed.ok, false);
    if (!consumed.ok) assert.equal(consumed.reason, "expired");
  });

  it("state inexistente -> not_found", async () => {
    const consumed = await store.consumeOAuthState(`no-existe-${randomUUID()}`, new Date().toISOString());
    assert.equal(consumed.ok, false);
    if (!consumed.ok) assert.equal(consumed.reason, "not_found");
  });

  it("saveConnection + getConnection real: round-trip completo, luego se limpia (deleteConnection real)", async () => {
    const tenantId = tenantDescartable();
    const nowIso = new Date().toISOString();
    await store.saveConnection({
      tenantId,
      provider: "nylas",
      grantId: `grant-prueba-${randomUUID()}`,
      accountEmail: "prueba@example.com",
      status: "connected",
      selectedCalendarId: null,
      selectedCalendarName: null,
      connectedAt: nowIso,
      updatedAt: nowIso,
    });

    const leido = await store.getConnection(tenantId);
    assert.ok(leido, "debe leerse de vuelta desde la DB real");
    assert.equal(leido!.status, "connected");
    assert.equal(leido!.accountEmail, "prueba@example.com");

    // La proyección pública nunca expone el grant, ni siquiera con datos reales.
    const publica = toPublicConnection(leido);
    assert.equal("grantId" in publica, false);

    // Limpieza real -- a diferencia del Registry, esta tabla SÍ admite DELETE.
    await store.deleteConnection(tenantId);
    const trasBorrar = await store.getConnection(tenantId);
    assert.equal(trasBorrar, null, "quedó limpio, sin fila permanente huérfana");
  });

  it("tenant isolation real: un tenant descartable B nunca ve la conexión de un tenant descartable A", async () => {
    const tenantA = tenantDescartable();
    const tenantB = tenantDescartable();
    const nowIso = new Date().toISOString();
    await store.saveConnection({
      tenantId: tenantA,
      provider: "nylas",
      grantId: `grant-A-${randomUUID()}`,
      accountEmail: "a@example.com",
      status: "connected",
      selectedCalendarId: null,
      selectedCalendarName: null,
      connectedAt: nowIso,
      updatedAt: nowIso,
    });

    const leidoPorB = await store.getConnection(tenantB);
    assert.equal(leidoPorB, null, "B no ve la conexión de A");

    await store.deleteConnection(tenantA); // limpieza
  });

  it("deleteConnection real es idempotente: borrar dos veces no lanza", async () => {
    const tenantId = tenantDescartable();
    await store.deleteConnection(tenantId); // nunca existió
    await store.deleteConnection(tenantId); // segunda vez, tampoco existe
    assert.equal(await store.getConnection(tenantId), null);
  });
});
