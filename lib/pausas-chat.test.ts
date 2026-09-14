import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatEnPausaHumana, logIaBloqueadaPorHumano } from "@/lib/pausas-chat";

// Fake mínimo de Supabase: from(tabla).select().eq().eq().maybeSingle().
// Registra la tabla y los filtros consultados para poder afirmar que el guard
// consulta EXACTAMENTE (phone_number_id, telefono_cliente) de dulabs_pausas_chat.
function fakeSupabase(resultado: { data: unknown; error: { message: string } | null }) {
  const filtros: Record<string, string> = {};
  let tabla = "";
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: string) => {
      filtros[col] = val;
      return chain;
    },
    maybeSingle: async () => resultado,
  };
  const supabase = {
    from: (t: string) => {
      tabla = t;
      return chain;
    },
    _inspect: () => ({ tabla, filtros }),
  };
  return supabase as unknown as SupabaseClient & { _inspect: () => { tabla: string; filtros: Record<string, string> } };
}

const FUTURO = new Date(Date.now() + 60_000).toISOString();
const PASADO = new Date(Date.now() - 60_000).toISOString();

describe("chatEnPausaHumana — humano tiene prioridad", () => {
  it("TRUE cuando hay una pausa vigente (pausado_hasta en el futuro)", async () => {
    const supabase = fakeSupabase({ data: { pausado_hasta: FUTURO }, error: null });
    assert.equal(await chatEnPausaHumana(supabase, "PN1", "573000000000"), true);
    // consulta la tabla y las columnas correctas (aislamiento por conversación)
    assert.deepEqual(supabase._inspect(), {
      tabla: "dulabs_pausas_chat",
      filtros: { phone_number_id: "PN1", telefono_cliente: "573000000000" },
    });
  });

  it("FALSE cuando la pausa ya venció (pausado_hasta en el pasado)", async () => {
    const supabase = fakeSupabase({ data: { pausado_hasta: PASADO }, error: null });
    assert.equal(await chatEnPausaHumana(supabase, "PN1", "573000000000"), false);
  });

  it("FALSE cuando no hay fila (conversación en modo IA normal)", async () => {
    const supabase = fakeSupabase({ data: null, error: null });
    assert.equal(await chatEnPausaHumana(supabase, "PN1", "573000000000"), false);
  });

  it("FALSE (fail-open) ante un error de lectura, sin lanzar", async () => {
    const supabase = fakeSupabase({ data: null, error: { message: "boom" } });
    assert.equal(await chatEnPausaHumana(supabase, "PN1", "573000000000"), false);
  });
});

describe("logIaBloqueadaPorHumano — observabilidad sin datos sensibles", () => {
  it("emite AI_RESPONSE_BLOCKED_HUMAN_TAKEOVER con tenant/chat/etapa y sin contenido", () => {
    const original = console.log;
    let linea = "";
    console.log = (msg?: unknown) => {
      linea = String(msg);
    };
    try {
      logIaBloqueadaPorHumano({
        etapa: "flow_send",
        phoneNumberId: "PN1",
        telefonoCliente: "573000000000",
        tenantId: "tenant-x",
        referencia: "node-9",
      });
    } finally {
      console.log = original;
    }
    assert.match(linea, /AI_RESPONSE_BLOCKED_HUMAN_TAKEOVER/);
    assert.match(linea, /etapa=flow_send/);
    assert.match(linea, /tenant=tenant-x/);
    assert.match(linea, /chat=573000000000/);
    assert.match(linea, /ref=node-9/);
  });
});
