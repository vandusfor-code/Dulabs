/**
 * DuLabs Developer V1 -- Fase 7 (Billing + Usage + Limits, autorizado).
 * E2E real contra Postgres del límite de números incluidos por plan,
 * aplicado de forma ATÓMICA (dulabs_dev_registrar_numero_con_limite).
 *
 * Sin metaToken en estos tests -> no se ejercita el cifrado (eso ya lo
 * prueba whatsapp-numbers-store.e2e.test.ts); acá el foco es el conteo de
 * cupo y la concurrencia.
 *
 * REQUIERE la migración 20261013000000 aplicada.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { registrarNumeroConLimite, listarNumeros } from "@/lib/developer/whatsapp-numbers-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — límite de números por plan real contra Postgres (Fase 7)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_whatsapp_numbers").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    function nuevoWorkspace() {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      return workspaceId;
    }

    const reg = (workspaceId: string, limite: number | null, phone = `phn-${randomUUID()}`) =>
      registrarNumeroConLimite(admin, { workspaceId, phoneNumberId: phone, limiteNumeros: limite });

    it("Test 12 -- límite de números: con 2 incluidos, el 3er número se rechaza (limite_numeros_excedido)", async () => {
      const workspaceId = nuevoWorkspace();
      assert.equal((await reg(workspaceId, 2)).ok, true);
      assert.equal((await reg(workspaceId, 2)).ok, true);
      const tercero = await reg(workspaceId, 2);
      assert.equal(tercero.ok, false);
      if (!tercero.ok) assert.equal(tercero.motivo, "limite_numeros_excedido");

      const lista = await listarNumeros(admin, workspaceId);
      assert.equal(lista.length, 2, "el número rechazado nunca debe crearse (sin fila parcial)");
    });

    it("Test 13 -- creación CONCURRENTE de números: con límite 2 y 5 altas simultáneas (phones distintos), exactamente 2 entran", async () => {
      const workspaceId = nuevoWorkspace();
      const intentos = await Promise.all(Array.from({ length: 5 }, () => reg(workspaceId, 2)));
      const creados = intentos.filter((r) => r.ok).length;
      const rechazados = intentos.filter((r) => !r.ok).length;
      assert.equal(creados, 2, "nunca más de 2 números pueden crearse bajo concurrencia real");
      assert.equal(rechazados, 3);

      const lista = await listarNumeros(admin, workspaceId);
      assert.equal(lista.length, 2, "exactamente 2 filas, nunca 3+ pese a 5 altas concurrentes");
    });

    it("reconexión del MISMO número no consume cupo nuevo", async () => {
      const workspaceId = nuevoWorkspace();
      const phone = `phn-${randomUUID()}`;
      const creado = await reg(workspaceId, 1, phone);
      assert.equal(creado.ok, true);
      if (creado.ok) assert.equal(creado.reconectado, false);

      // Reconecta el MISMO phone -- no debe consumir cupo (límite 1 sigue ok).
      const reconecta = await reg(workspaceId, 1, phone);
      assert.equal(reconecta.ok, true);
      if (reconecta.ok) assert.equal(reconecta.reconectado, true);

      const lista = await listarNumeros(admin, workspaceId);
      assert.equal(lista.length, 1, "reconectar nunca duplica la fila");

      // Un número NUEVO distinto sí choca con el límite de 1.
      const nuevo = await reg(workspaceId, 1);
      assert.equal(nuevo.ok, false);
    });

    it("Test 15 -- cross-tenant: los números de B NUNCA cuentan contra el cupo de A", async () => {
      const workspaceA = nuevoWorkspace();
      const workspaceB = nuevoWorkspace();
      // B llena su cupo de 2.
      assert.equal((await reg(workspaceB, 2)).ok, true);
      assert.equal((await reg(workspaceB, 2)).ok, true);
      // A, con su propio límite de 2, sigue pudiendo registrar 2 -- el conteo
      // es por workspace, nunca global.
      assert.equal((await reg(workspaceA, 2)).ok, true);
      assert.equal((await reg(workspaceA, 2)).ok, true);
      const terceroA = await reg(workspaceA, 2);
      assert.equal(terceroA.ok, false, "el cupo de A depende SOLO de los números de A");

      assert.equal((await listarNumeros(admin, workspaceA)).length, 2);
      assert.equal((await listarNumeros(admin, workspaceB)).length, 2);
    });

    it("plan sin límite de números (null) -- nunca se rechaza un alta", async () => {
      const workspaceId = nuevoWorkspace();
      for (let i = 0; i < 4; i++) assert.equal((await reg(workspaceId, null)).ok, true);
      assert.equal((await listarNumeros(admin, workspaceId)).length, 4);
    });
  }
);
