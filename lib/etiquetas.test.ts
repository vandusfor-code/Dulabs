/**
 * FASE F7 (Contacts + Variables + Tags, autorizado) — smoke test de
 * integración REAL para lib/etiquetas.ts (dulabs_etiquetas /
 * dulabs_conversacion_etiquetas). Mismo patrón que
 * lib/flow/flow-orchestrator-store-supabase.test.ts: se salta sin
 * credenciales, usa tenants/tags/conversación descartables, limpia al
 * final. No usa el tenant de AMORE/Daniela ni sus etiquetas reales.
 *
 * Cubre:
 *  - 11. agregar tag
 *  - 12. no duplicar tag (dedup real vía unique constraint + 23505)
 *  - 13. quitar tag (idempotente)
 *  - 16. contacto sin ningún tag -- listarEtiquetasDeConversacion = []
 *  - 17. tenant isolation de tags (etiqueta de otro tenant -> tag_not_found)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  agregarEtiquetaAConversacion,
  quitarEtiquetaDeConversacion,
  listarEtiquetasDeConversacion,
} from "@/lib/etiquetas";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "FASE F7 — lib/etiquetas.ts (Supabase real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const PHONE_NUMBER_ID = `f7-etiquetas-phone-${Date.now()}`;
    const TELEFONO = "573000002222";
    let etiquetaIdA: number;
    let etiquetaIdB: number;

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { data: tagA, error: errA } = await supabase
        .from("dulabs_etiquetas")
        .insert({ tenant_id: TENANT_A, nombre: `f7_vip_${Date.now()}` })
        .select("id")
        .single();
      if (errA) throw new Error(`no se pudo crear la etiqueta de prueba (tenant A): ${errA.message}`);
      etiquetaIdA = tagA.id as number;

      const { data: tagB, error: errB } = await supabase
        .from("dulabs_etiquetas")
        .insert({ tenant_id: TENANT_B, nombre: `f7_otro_tenant_${Date.now()}` })
        .select("id")
        .single();
      if (errB) throw new Error(`no se pudo crear la etiqueta de prueba (tenant B): ${errB.message}`);
      etiquetaIdB = tagB.id as number;
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      await supabase
        .from("dulabs_conversacion_etiquetas")
        .delete()
        .eq("phone_number_id", PHONE_NUMBER_ID);
      if (etiquetaIdA) await supabase.from("dulabs_etiquetas").delete().eq("id", etiquetaIdA);
      if (etiquetaIdB) await supabase.from("dulabs_etiquetas").delete().eq("id", etiquetaIdB);
    });

    it("16. conversación sin ningún tag -- lista vacía, no lanza", async () => {
      const tags = await listarEtiquetasDeConversacion(supabase, {
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente: TELEFONO,
      });
      assert.deepEqual(tags, []);
    });

    it("11. agrega una etiqueta real a la conversación", async () => {
      const resultado = await agregarEtiquetaAConversacion(supabase, {
        tenantId: TENANT_A,
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente: TELEFONO,
        etiquetaId: etiquetaIdA,
      });
      assert.equal(resultado.ok, true);
      if (!resultado.ok) return;
      assert.ok(resultado.nombre.startsWith("f7_vip_"));

      const tags = await listarEtiquetasDeConversacion(supabase, {
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente: TELEFONO,
      });
      assert.equal(tags.includes(resultado.nombre), true);
    });

    it("12. agregar la MISMA etiqueta dos veces no duplica (23505 -> éxito idempotente)", async () => {
      const primera = await agregarEtiquetaAConversacion(supabase, {
        tenantId: TENANT_A,
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente: TELEFONO,
        etiquetaId: etiquetaIdA,
      });
      const segunda = await agregarEtiquetaAConversacion(supabase, {
        tenantId: TENANT_A,
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente: TELEFONO,
        etiquetaId: etiquetaIdA,
      });
      assert.equal(primera.ok, true);
      assert.equal(segunda.ok, true);

      const { count } = await supabase
        .from("dulabs_conversacion_etiquetas")
        .select("id", { count: "exact", head: true })
        .eq("phone_number_id", PHONE_NUMBER_ID)
        .eq("telefono_cliente", TELEFONO)
        .eq("etiqueta_id", etiquetaIdA);
      assert.equal(count, 1);
    });

    it("17. tenant isolation -- una etiqueta de OTRO tenant nunca se puede asignar", async () => {
      const resultado = await agregarEtiquetaAConversacion(supabase, {
        tenantId: TENANT_A,
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente: TELEFONO,
        etiquetaId: etiquetaIdB,
      });
      assert.equal(resultado.ok, false);
      if (resultado.ok) return;
      assert.equal(resultado.motivo, "tag_not_found");

      const { count } = await supabase
        .from("dulabs_conversacion_etiquetas")
        .select("id", { count: "exact", head: true })
        .eq("phone_number_id", PHONE_NUMBER_ID)
        .eq("etiqueta_id", etiquetaIdB);
      assert.equal(count, 0);
    });

    it("13. quita una etiqueta asignada (y es idempotente si se repite)", async () => {
      const quitar1 = await quitarEtiquetaDeConversacion(supabase, {
        tenantId: TENANT_A,
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente: TELEFONO,
        etiquetaId: etiquetaIdA,
      });
      assert.equal(quitar1.ok, true);

      const tagsTrasQuitar = await listarEtiquetasDeConversacion(supabase, {
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente: TELEFONO,
      });
      assert.equal(tagsTrasQuitar.length, 0);

      // Repetir el quitar (ya no estaba asignada) sigue siendo ok -- idempotente.
      const quitar2 = await quitarEtiquetaDeConversacion(supabase, {
        tenantId: TENANT_A,
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente: TELEFONO,
        etiquetaId: etiquetaIdA,
      });
      assert.equal(quitar2.ok, true);
    });
  },
);
