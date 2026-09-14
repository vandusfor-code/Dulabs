/**
 * FASE 10 (Scalability, autorizado) — tests puros de
 * lib/conversaciones-inbox.ts. Fake de Supabase en memoria: un caso simula
 * la función RPC ya aplicada (camino feliz), el otro simula que la
 * migración de F10 todavía no se aplicó (RPC inexistente) para probar el
 * fallback tolerante -- mismo criterio que lib/conversacion-estado.test.ts
 * para la migración de F9.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverUltimoMensajePorConversacion, type UltimoMensajeConversacion } from "@/lib/conversaciones-inbox";

function crearFakeSupabase(opts: {
  rpcDisponible: boolean;
  filasRpc?: UltimoMensajeConversacion[];
  filasCrudas: UltimoMensajeConversacion[];
}) {
  return {
    rpc(nombre: string, params: Record<string, unknown>) {
      assert.equal(nombre, "dulabs_conversaciones_recientes");
      assert.ok(Array.isArray(params.p_phone_number_ids));
      if (!opts.rpcDisponible) {
        return Promise.resolve({ data: null, error: { code: "PGRST202", message: "función no encontrada" } });
      }
      return Promise.resolve({ data: opts.filasRpc ?? [], error: null });
    },
    from(tabla: string) {
      assert.equal(tabla, "dulabs_mensajes_log");
      const builder = {
        select() { return builder; },
        in() { return builder; },
        order() { return builder; },
        limit() { return Promise.resolve({ data: opts.filasCrudas, error: null }); },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe("resolverUltimoMensajePorConversacion", () => {
  it("con la migración aplicada, usa el resultado del RPC tal cual", async () => {
    const filasRpc: UltimoMensajeConversacion[] = [
      { phone_number_id: "p1", telefono_cliente: "c1", contenido: "hola", direccion: "entrante", created_at: "2026-01-02T00:00:00Z" },
    ];
    const supabase = crearFakeSupabase({ rpcDisponible: true, filasRpc, filasCrudas: [] });
    const resultado = await resolverUltimoMensajePorConversacion(supabase, ["p1"]);
    assert.deepEqual(resultado, filasRpc);
  });

  it("sin la migración aplicada (RPC inexistente), cae al fallback de deduplicar en memoria", async () => {
    const filasCrudas: UltimoMensajeConversacion[] = [
      { phone_number_id: "p1", telefono_cliente: "c1", contenido: "más reciente", direccion: "saliente", created_at: "2026-01-03T00:00:00Z" },
      { phone_number_id: "p1", telefono_cliente: "c1", contenido: "vieja", direccion: "entrante", created_at: "2026-01-01T00:00:00Z" },
      { phone_number_id: "p1", telefono_cliente: "c2", contenido: "otra conversación", direccion: "entrante", created_at: "2026-01-02T00:00:00Z" },
    ];
    const supabase = crearFakeSupabase({ rpcDisponible: false, filasCrudas });
    const resultado = await resolverUltimoMensajePorConversacion(supabase, ["p1"]);
    assert.equal(resultado.length, 2);
    const c1 = resultado.find((r) => r.telefono_cliente === "c1");
    assert.equal(c1?.contenido, "más reciente");
  });

  it("sin números de teléfono, no llama a Supabase y devuelve vacío", async () => {
    const supabase = {
      rpc() { throw new Error("no debería llamarse"); },
      from() { throw new Error("no debería llamarse"); },
    } as unknown as SupabaseClient;
    const resultado = await resolverUltimoMensajePorConversacion(supabase, []);
    assert.deepEqual(resultado, []);
  });
});
