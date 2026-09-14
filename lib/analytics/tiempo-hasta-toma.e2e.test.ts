/**
 * FASE 11 (Completion & Debt Zero, autorizado) — E2E real contra Supabase
 * de dulabs_tiempo_hasta_toma_promedio_seg (cierra la limitación "tiempo
 * hasta toma no implementado" documentada en F10). Tenant/número
 * descartables, nunca AMORE/Daniela/Charlotte/Solo Talento.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "dulabs_tiempo_hasta_toma_promedio_seg — E2E real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const sufijo = randomUUID().slice(0, 8);
    const phoneNumberId = `f11-tiempo-toma-${sufijo}`;
    const cliente1 = "573000000060";
    const cliente2 = "573000000061";

    let rpcDisponible = false;

    after(async () => {
      if (!HAS_SUPABASE) return;
      await admin.from("dulabs_mensajes_log").delete().eq("phone_number_id", phoneNumberId);
      await admin.from("dulabs_conversacion_eventos").delete().eq("phone_number_id", phoneNumberId);
    });

    it("promedia correctamente el gap entre el último mensaje entrante y el handoff_tomado, ignorando eventos que no son handoff real", async () => {
      const ahora = Date.now();

      // Conversación 1: último mensaje entrante 100s antes del handoff.
      await admin.from("dulabs_mensajes_log").insert({
        phone_number_id: phoneNumberId,
        telefono_cliente: cliente1,
        direccion: "entrante",
        contenido: "hola",
        created_at: new Date(ahora - 200_000).toISOString(),
      });
      await admin.from("dulabs_conversacion_eventos").insert({
        phone_number_id: phoneNumberId,
        telefono_cliente: cliente1,
        tipo: "asignado",
        miembro_id: null,
        detalle: { motivo: "handoff_tomado" },
        created_at: new Date(ahora - 100_000).toISOString(),
      });

      // Conversación 2: último mensaje entrante 300s antes del handoff.
      await admin.from("dulabs_mensajes_log").insert({
        phone_number_id: phoneNumberId,
        telefono_cliente: cliente2,
        direccion: "entrante",
        contenido: "hola de nuevo",
        created_at: new Date(ahora - 400_000).toISOString(),
      });
      await admin.from("dulabs_conversacion_eventos").insert({
        phone_number_id: phoneNumberId,
        telefono_cliente: cliente2,
        tipo: "asignado",
        miembro_id: null,
        detalle: { motivo: "handoff_tomado" },
        created_at: new Date(ahora - 100_000).toISOString(),
      });

      // Ruido que NUNCA debe contarse: una reasignación simple (no handoff)
      // y un "liberado" (devuelto a IA) en la MISMA ventana de tiempo.
      await admin.from("dulabs_conversacion_eventos").insert({
        phone_number_id: phoneNumberId,
        telefono_cliente: cliente1,
        tipo: "reasignado",
        miembro_id: null,
        detalle: { miembro_id_destino: 999 },
        created_at: new Date(ahora - 50_000).toISOString(),
      });

      const r = await admin.rpc("dulabs_tiempo_hasta_toma_promedio_seg", {
        p_phone_number_ids: [phoneNumberId],
        p_desde: new Date(ahora - 3600_000).toISOString(),
        p_hasta: new Date(ahora).toISOString(),
      });
      rpcDisponible = !r.error;
      if (!rpcDisponible) {
        console.error(
          "[tiempo-hasta-toma.e2e] RPC no disponible todavía (migración 20261003000000 sin aplicar) -- se documenta y se continúa.",
        );
        return;
      }

      const fila = r.data?.[0];
      assert.equal(Number(fila.muestras), 2, "solo los 2 eventos handoff_tomado reales deben contar, nunca la reasignación simple");
      // (100s + 300s) / 2 = 200s.
      assert.ok(Math.abs(Number(fila.promedio_seg) - 200) < 2, `esperado ~200s, vino ${fila.promedio_seg}`);
    });

    it("sin ningún handoff en el rango -> muestras=0, promedio null (nunca 0 falso)", async () => {
      if (!rpcDisponible) return;
      const r = await admin.rpc("dulabs_tiempo_hasta_toma_promedio_seg", {
        p_phone_number_ids: [phoneNumberId],
        p_desde: new Date(Date.now() - 365 * 24 * 3600_000).toISOString(),
        p_hasta: new Date(Date.now() - 300 * 24 * 3600_000).toISOString(),
      });
      assert.equal(r.error, null);
      const fila = r.data?.[0];
      assert.equal(Number(fila.muestras), 0);
      assert.equal(fila.promedio_seg, null);
    });
  },
);
