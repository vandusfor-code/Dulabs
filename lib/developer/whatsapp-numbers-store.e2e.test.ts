/**
 * DuLabs Developer V1 -- Fase 2 (autorizado, sección 7 del brief). E2E real
 * contra Postgres para lib/developer/whatsapp-numbers-store.ts.
 *
 * REQUIERE la migración 20261007000000_dulabs_developer_v1_fase2_data_model.sql aplicada.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { registrarNumero, listarNumeros, obtenerNumeroDelWorkspace, obtenerTokenMetaDelNumero } from "@/lib/developer/whatsapp-numbers-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — whatsapp-numbers-store real contra Postgres (Fase 2)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    // El token de Meta se cifra con secure-crypto.ts (fail-closed) --
    // mismo patrón que lib/developer/secure-crypto.test.ts: se fija una
    // clave de prueba real (32 bytes) para la duración de esta suite y se
    // restaura la original al final, en vez de depender de que
    // DEVELOPER_TOKEN_ENCRYPTION_KEY ya esté configurada en el entorno
    // local (no lo está, mismo patrón ya visto con TOKEN_ENCRYPTION_KEY de
    // Business). Esto prueba el cifrado/descifrado real, no lo saltea.
    const claveOriginal = process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    before(() => {
      process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    });
    after(() => {
      if (claveOriginal === undefined) delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
      else process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveOriginal;
    });

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_whatsapp_numbers").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    it("registrarNumero: primera vez, queda 'conectado' y asociado al workspace correcto", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const phoneNumberId = `phn-${randomUUID()}`;
      const resultado = await registrarNumero(admin, { workspaceId, phoneNumberId, displayName: "Línea principal" });
      assert.equal(resultado.ok, true);
      if (resultado.ok) {
        assert.equal(resultado.fila.workspace_id, workspaceId);
        assert.equal(resultado.fila.estado, "conectado");
      }
    });

    it("registrarNumero: phone_number_id ya conectado a OTRO workspace se rechaza explícitamente (unicidad global real de Postgres)", async () => {
      const workspaceA = randomUUID();
      const workspaceB = randomUUID();
      workspacesUsados.push(workspaceA, workspaceB);
      const phoneNumberId = `phn-${randomUUID()}`;
      const primero = await registrarNumero(admin, { workspaceId: workspaceA, phoneNumberId });
      assert.equal(primero.ok, true);

      const segundo = await registrarNumero(admin, { workspaceId: workspaceB, phoneNumberId });
      assert.equal(segundo.ok, false);
      if (!segundo.ok) assert.equal(segundo.motivo, "numero_ya_conectado_a_otro_workspace");

      const numerosB = await listarNumeros(admin, workspaceB);
      assert.equal(numerosB.length, 0, "B nunca debe terminar con el número de A en su lista");
    });

    it("registrarNumero: mismo workspace registrando el mismo número dos veces actualiza (reconecta), no duplica fila", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const phoneNumberId = `phn-${randomUUID()}`;
      await registrarNumero(admin, { workspaceId, phoneNumberId, displayName: "v1" });
      await registrarNumero(admin, { workspaceId, phoneNumberId, displayName: "v2" });

      const lista = await listarNumeros(admin, workspaceId);
      assert.equal(lista.length, 1, "el UNIQUE(phone_number_id) + upsert debe mantener una sola fila");
      assert.equal(lista[0].display_name, "v2");
    });

    it("obtenerNumeroDelWorkspace: un workspace no puede resolver el número de otro aunque conozca el id exacto", async () => {
      const workspaceA = randomUUID();
      const workspaceB = randomUUID();
      workspacesUsados.push(workspaceA, workspaceB);
      const phoneNumberId = `phn-${randomUUID()}`;
      const registro = await registrarNumero(admin, { workspaceId: workspaceA, phoneNumberId });
      assert.equal(registro.ok, true);
      if (!registro.ok) return;

      const comoB = await obtenerNumeroDelWorkspace(admin, { workspaceId: workspaceB, numeroId: registro.fila.id });
      assert.equal(comoB, null, "el filtro por workspace_id debe bloquear el acceso cruzado, no solo el filtro por id");

      const comoA = await obtenerNumeroDelWorkspace(admin, { workspaceId: workspaceA, numeroId: registro.fila.id });
      assert.ok(comoA);
    });

    it("el token de Meta nunca viaja en claro: la fila normal no lo incluye, y descifrado real via obtenerTokenMetaDelNumero coincide con el original", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const phoneNumberId = `phn-${randomUUID()}`;
      const tokenOriginal = `EAAG${randomUUID()}`;
      const registro = await registrarNumero(admin, { workspaceId, phoneNumberId, metaToken: tokenOriginal });
      assert.equal(registro.ok, true);
      if (!registro.ok) return;

      assert.ok(!("meta_token_cifrado" in registro.fila), "la proyección pública no debe incluir el campo del token cifrado");

      const { data: crudo } = await admin.from("dulabs_dev_whatsapp_numbers").select("meta_token_cifrado").eq("id", registro.fila.id).single();
      assert.notEqual(crudo!.meta_token_cifrado, tokenOriginal, "el token nunca debe quedar guardado en claro");

      const descifrado = await obtenerTokenMetaDelNumero(admin, { workspaceId, numeroId: registro.fila.id });
      assert.equal(descifrado, tokenOriginal);
    });
  }
);
