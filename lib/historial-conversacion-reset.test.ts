/**
 * Fase 8A.3 (autorizado) — regresión de aislamiento para el reset manual del
 * historial conversacional de un número de prueba (ver informe de esta
 * fase: se borraron filas reales de dulabs_mensajes_log para
 * phone_number_id=1282448611609227 + telefono_cliente=573148127388, y una
 * fila de dulabs_flow_executions cuyo status era waiting_input).
 *
 * dulabs_mensajes_log NO tiene columna id_tenant -- el aislamiento real es
 * por (phone_number_id, telefono_cliente), exactamente el mismo filtro que
 * ya usa obtenerHistorialConversacion (lib/historial-conversacion.ts). Este
 * test prueba esa MISMA combinación de filtros (no una reimplementación):
 * borrar por (phone_number_id, telefono_cliente) nunca toca otro número,
 * ni siquiera otro telefono_cliente del mismo phone_number_id.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { obtenerHistorialConversacion } from "@/lib/historial-conversacion";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "Fase 8A.3 — reset de historial aislado por (phone_number_id, telefono_cliente)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const PHONE = `test-8a3-${Date.now()}`;
    const TEL_A = "573000001111"; // el que se "resetea"
    const TEL_B = "573000002222"; // otro número, NUNCA debe verse afectado
    const insertados: number[] = [];

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      for (const [telefono, texto] of [
        [TEL_A, "mensaje viejo de A"],
        [TEL_B, "mensaje de B, nunca se debe borrar"],
      ] as const) {
        const { data, error } = await supabase
          .from("dulabs_mensajes_log")
          .insert({
            phone_number_id: PHONE,
            telefono_cliente: telefono,
            direccion: "entrante",
            contenido: texto,
            origen: "entrante",
            wamid: `TEST_8A3_${randomUUID()}`,
          })
          .select("id")
          .single();
        if (error) throw error;
        insertados.push(data!.id as number);
      }
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      // Por si el test falla a mitad de camino, limpiar cualquier resto (de
      // ambos números de prueba, nunca de un número real).
      await supabase.from("dulabs_mensajes_log").delete().eq("phone_number_id", PHONE);
    });

    it("borrar por (phone_number_id, telefono_cliente) deja el historial de A vacío y el de B intacto", async () => {
      const antesA = await obtenerHistorialConversacion(supabase, PHONE, TEL_A);
      const antesB = await obtenerHistorialConversacion(supabase, PHONE, TEL_B);
      assert.equal(antesA.length, 1);
      assert.equal(antesB.length, 1);

      const { error } = await supabase.from("dulabs_mensajes_log").delete().eq("phone_number_id", PHONE).eq("telefono_cliente", TEL_A);
      if (error) throw error;

      const despuesA = await obtenerHistorialConversacion(supabase, PHONE, TEL_A);
      const despuesB = await obtenerHistorialConversacion(supabase, PHONE, TEL_B);
      assert.deepEqual(despuesA, [], "A debe quedar completamente limpio -- conversación nueva desde cero");
      assert.equal(despuesB.length, 1, "B nunca debió verse afectado por el reset de A");
      assert.equal(despuesB[0]!.content, "mensaje de B, nunca se debe borrar");
    });
  }
);
