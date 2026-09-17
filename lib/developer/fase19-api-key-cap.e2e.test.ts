/**
 * DuLabs Developer V1 -- Fase 19 (19.5). E2E del tope de API keys por workspace:
 * al llegar a MAX_API_KEYS_ACTIVAS, crear otra lanza ErrorLimiteApiKeys; revocar
 * una libera cupo. Requiere Supabase real; crea filas desechables y limpia.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { crearApiKey, revocarApiKey, contarApiKeysActivas, ErrorLimiteApiKeys, MAX_API_KEYS_ACTIVAS } from "@/lib/developer/api-keys-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("Fase 19 -- tope de API keys (e2e)", { skip: HAS_SUPABASE ? false : "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" }, () => {
  const admin: SupabaseClient = HAS_SUPABASE
    ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
    : (null as unknown as SupabaseClient);
  const workspaces: string[] = [];
  after(async () => {
    for (const ws of workspaces) await admin.from("dulabs_dev_api_keys").delete().eq("workspace_id", ws).then(() => {}, () => {});
  });

  it("al llegar al tope, crear otra lanza ErrorLimiteApiKeys; revocar libera cupo", async () => {
    const workspaceId = randomUUID();
    workspaces.push(workspaceId);

    let primeraId = "";
    for (let i = 0; i < MAX_API_KEYS_ACTIVAS; i++) {
      const { fila } = await crearApiKey(admin, { workspaceId, name: `beta-key-${i}` });
      if (i === 0) primeraId = fila.id;
    }
    assert.equal(await contarApiKeysActivas(admin, workspaceId), MAX_API_KEYS_ACTIVAS);

    await assert.rejects(
      crearApiKey(admin, { workspaceId, name: "excede" }),
      (e: unknown) => e instanceof ErrorLimiteApiKeys,
    );

    // Revocar una libera cupo -> se puede crear de nuevo.
    await revocarApiKey(admin, { workspaceId, apiKeyId: primeraId });
    assert.equal(await contarApiKeysActivas(admin, workspaceId), MAX_API_KEYS_ACTIVAS - 1);
    const { fila } = await crearApiKey(admin, { workspaceId, name: "tras-revocar" });
    assert.ok(fila.id, "debe poder crearse tras revocar");
  });
});
