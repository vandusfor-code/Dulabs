/**
 * DuLabs Developer V1 -- Fase 8 (autorizado, D5). Aislamiento RLS real de
 * dulabs_dev_memberships y de las tablas Developer bajo la NUEVA función de
 * resolución (dulabs_dev_workspaces_del_usuario), con usuarios Developer
 * "puros" (membresía Developer, sin fallback Business) y sesión real
 * (no service_role).
 *
 * REQUIERE las migraciones de Fase 2 y 20261014000000 aplicadas.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { crearClienteDePruebaComoSesion } from "@/lib/test-helpers/sesion-prueba";
import { crearMiembro } from "@/lib/developer/memberships-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function clienteComoSesion(token: string): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

describe(
  "DuLabs Developer V1 — RLS de identidad Developer real entre workspaces (Fase 8)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const wsA = randomUUID();
    const wsB = randomUUID();
    const userIds: string[] = [];
    let sesionA: SupabaseClient;
    let sesionB: SupabaseClient;
    let apiKeyIdA = "";

    async function usuarioDevPuro(ws: string, pref: string): Promise<{ userId: string; token: string }> {
      const email = `${pref}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const password = `F8Rls-${randomUUID()}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw error ?? new Error("no user");
      userIds.push(data.user.id);
      await crearMiembro(admin, { workspaceId: ws, userId: data.user.id, rol: "OWNER" });
      const sesion = crearClienteDePruebaComoSesion();
      const { data: signIn, error: eSign } = await sesion.auth.signInWithPassword({ email, password });
      if (eSign || !signIn.session) throw eSign ?? new Error("no session");
      return { userId: data.user.id, token: signIn.session.access_token };
    }

    before(async () => {
      const a = await usuarioDevPuro(wsA, "f8-rls-a");
      const b = await usuarioDevPuro(wsB, "f8-rls-b");
      sesionA = clienteComoSesion(a.token);
      sesionB = clienteComoSesion(b.token);

      const key = await admin
        .from("dulabs_dev_api_keys")
        .insert({ workspace_id: wsA, name: "rls8", key_hash: "y".repeat(64), prefix: "dl_live_rls8" })
        .select("id")
        .single();
      if (key.error) throw new Error(`seed api_keys: ${key.error.message}`);
      apiKeyIdA = key.data.id;
    });

    after(async () => {
      await admin.from("dulabs_dev_api_keys").delete().eq("workspace_id", wsA).then(() => {}, () => {});
      for (const id of userIds) await admin.auth.admin.deleteUser(id).then(() => {}, () => {});
    });

    it("dulabs_dev_memberships: A ve las membresías de SU workspace, B no ve ninguna de A", async () => {
      const comoA = await sesionA.from("dulabs_dev_memberships").select("id, workspace_id, rol").eq("workspace_id", wsA);
      assert.equal(comoA.error, null);
      assert.ok((comoA.data ?? []).length >= 1, "A debe ver su propia membresía en wsA");

      const comoBsobreA = await sesionB.from("dulabs_dev_memberships").select("id").eq("workspace_id", wsA);
      assert.equal((comoBsobreA.data ?? []).length, 0, "B nunca ve membresías del workspace de A (aunque filtre por wsA explícito)");
    });

    it("dulabs_dev_memberships: mutación vía rol authenticated está bloqueada (sin políticas de escritura)", async () => {
      await sesionA.from("dulabs_dev_memberships").update({ rol: "MEMBER" }).eq("workspace_id", wsA);
      // Control vía service_role: la fila de A sigue siendo OWNER (el UPDATE de sesión no aplicó).
      const { data } = await admin.from("dulabs_dev_memberships").select("rol").eq("workspace_id", wsA).eq("user_id", userIds[0]).single();
      assert.equal(data!.rol, "OWNER", "ningún authenticated puede mutar membresías -- solo el backend service_role");
    });

    it("tablas Developer bajo la nueva función: A ve su API key (dev membership resuelve el workspace), B no", async () => {
      const comoA = await sesionA.from("dulabs_dev_api_keys").select("id").eq("id", apiKeyIdA);
      assert.equal((comoA.data ?? []).length, 1, "A resuelve wsA por su membresía Developer y ve su key");

      const comoB = await sesionB.from("dulabs_dev_api_keys").select("id").eq("id", apiKeyIdA);
      assert.equal((comoB.data ?? []).length, 0, "B nunca ve la key de A");
    });
  }
);
