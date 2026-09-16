/**
 * DuLabs Developer V1 -- Fase 2 (autorizado, sección 6 del brief). E2E real
 * contra Postgres para lib/developer/api-keys-store.ts.
 *
 * REQUIERE la migración 20261007000000_dulabs_developer_v1_fase2_data_model.sql aplicada.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { crearApiKey, autenticarApiKey, revocarApiKey, listarApiKeys } from "@/lib/developer/api-keys-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — api-keys-store real contra Postgres (Fase 2)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_api_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    it("crea una key: devuelve la clave en claro UNA vez, y en la base solo se guarda el hash (nunca el valor en claro)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { fila, claveEnClaro } = await crearApiKey(admin, { workspaceId, name: "prod" });
      assert.match(claveEnClaro, /^dl_live_/);

      const { data: crudo } = await admin.from("dulabs_dev_api_keys").select("key_hash").eq("id", fila.id).single();
      assert.notEqual(crudo!.key_hash, claveEnClaro, "el hash almacenado nunca debe ser igual al valor en claro");
      assert.doesNotMatch(String(crudo!.key_hash), /^dl_live_/, "el valor almacenado no debe tener forma de API key en claro");
    });

    it("autenticarApiKey: clave válida y no revocada -> autenticado, resuelve el workspace correcto", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { claveEnClaro } = await crearApiKey(admin, { workspaceId, name: "prod" });

      const resultado = await autenticarApiKey(admin, claveEnClaro);
      assert.equal(resultado.autenticado, true);
      if (resultado.autenticado) assert.equal(resultado.workspaceId, workspaceId);
    });

    it("autenticarApiKey: clave inexistente/alterada -> no_encontrada (nunca revela si el prefijo era correcto)", async () => {
      const resultado = await autenticarApiKey(admin, "dl_live_" + "0".repeat(40));
      assert.equal(resultado.autenticado, false);
      if (!resultado.autenticado) assert.equal(resultado.motivo, "no_encontrada");
    });

    it("autenticarApiKey: clave real pero de OTRO workspace nunca se confunde -- resuelve exactamente su propio workspace_id", async () => {
      const workspaceA = randomUUID();
      const workspaceB = randomUUID();
      workspacesUsados.push(workspaceA, workspaceB);
      const { claveEnClaro: claveA } = await crearApiKey(admin, { workspaceId: workspaceA, name: "a" });
      await crearApiKey(admin, { workspaceId: workspaceB, name: "b" });

      const resultado = await autenticarApiKey(admin, claveA);
      assert.equal(resultado.autenticado, true);
      if (resultado.autenticado) {
        assert.equal(resultado.workspaceId, workspaceA);
        assert.notEqual(resultado.workspaceId, workspaceB);
      }
    });

    it("revocarApiKey: revoca correctamente y la clave revocada deja de autenticar", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { fila, claveEnClaro } = await crearApiKey(admin, { workspaceId, name: "prod" });

      const revocacion = await revocarApiKey(admin, { workspaceId, apiKeyId: fila.id });
      assert.equal(revocacion.revocada, true);

      const resultado = await autenticarApiKey(admin, claveEnClaro);
      assert.equal(resultado.autenticado, false);
      if (!resultado.autenticado) assert.equal(resultado.motivo, "revocada");
    });

    it("revocarApiKey: workspace_id incorrecto no puede revocar la key de otro workspace (ownership real, no solo por id)", async () => {
      const workspaceA = randomUUID();
      const workspaceB = randomUUID();
      workspacesUsados.push(workspaceA, workspaceB);
      const { fila, claveEnClaro } = await crearApiKey(admin, { workspaceId: workspaceA, name: "a" });

      const intento = await revocarApiKey(admin, { workspaceId: workspaceB, apiKeyId: fila.id });
      assert.equal(intento.revocada, false, "un workspace no puede revocar la key de otro workspace");

      const sigueViva = await autenticarApiKey(admin, claveEnClaro);
      assert.equal(sigueViva.autenticado, true, "la key de A debe seguir activa tras el intento fallido de B");
    });

    it("revocarApiKey: revocar dos veces la misma key no da error, pero la segunda vez no 'revoca' nada nuevo", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { fila } = await crearApiKey(admin, { workspaceId, name: "prod" });

      const primera = await revocarApiKey(admin, { workspaceId, apiKeyId: fila.id });
      assert.equal(primera.revocada, true);
      const segunda = await revocarApiKey(admin, { workspaceId, apiKeyId: fila.id });
      assert.equal(segunda.revocada, false, "ya estaba revocada -- no hay una segunda revocación real");
    });

    it("listarApiKeys: aislado por workspace_id, nunca mezcla keys de otro workspace", async () => {
      const workspaceA = randomUUID();
      const workspaceB = randomUUID();
      workspacesUsados.push(workspaceA, workspaceB);
      await crearApiKey(admin, { workspaceId: workspaceA, name: "a1" });
      await crearApiKey(admin, { workspaceId: workspaceA, name: "a2" });
      await crearApiKey(admin, { workspaceId: workspaceB, name: "b1" });

      const listaA = await listarApiKeys(admin, workspaceA);
      assert.equal(listaA.length, 2);
      assert.ok(listaA.every((k) => k.workspace_id === workspaceA));
    });
  }
);
