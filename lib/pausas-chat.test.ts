import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { activarPausaChat, activarPausaPorRespuestaHumana, chatEnPausaHumana, logIaBloqueadaPorHumano } from "@/lib/pausas-chat";

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

// ---------------------------------------------------------------------------
// activarPausaPorRespuestaHumana — la respuesta de la asesora desde el celular
// nunca acorta una pausa más larga (corrección compartida, autorizada).
// Fake en memoria de dulabs_pausas_chat con la semántica real que usan
// extenderPausaChat y el refresco de seguimiento: upsert(ignoreDuplicates),
// update().eq().eq()[.lt()], select().eq().eq().maybeSingle().
// ---------------------------------------------------------------------------

type FilaPausa = {
  phone_number_id: string;
  telefono_cliente: string;
  pausado_hasta: string;
  pausado_desde?: string;
  seguimiento_enviado?: boolean;
};

function pausasEnMemoria(iniciales: FilaPausa[] = []) {
  const filas = iniciales.map((f) => ({ ...f }));
  const coincide = (f: FilaPausa, filtros: Array<[string, string, unknown]>) =>
    filtros.every(([op, col, val]) => {
      const actual = (f as Record<string, unknown>)[col];
      return op === "eq" ? actual === val : String(actual) < String(val);
    });
  const supabase = {
    from(tabla: string) {
      assert.equal(tabla, "dulabs_pausas_chat");
      return {
        upsert(fila: FilaPausa, opts: { onConflict: string; ignoreDuplicates?: boolean }) {
          const existente = filas.find((f) => f.phone_number_id === fila.phone_number_id && f.telefono_cliente === fila.telefono_cliente);
          let afectadas: FilaPausa[] = [];
          if (!existente) {
            filas.push({ ...fila });
            afectadas = [fila];
          } else if (!opts.ignoreDuplicates) {
            Object.assign(existente, fila);
            afectadas = [existente];
          }
          const res = { data: afectadas.map((f) => ({ pausado_hasta: f.pausado_hasta })), error: null };
          return Object.assign(Promise.resolve({ data: null, error: null }), { select: async () => res });
        },
        update(cambios: Partial<FilaPausa>) {
          const filtros: Array<[string, string, unknown]> = [];
          const aplicar = () => {
            const afectadas = filas.filter((f) => coincide(f, filtros));
            for (const f of afectadas) Object.assign(f, cambios);
            return afectadas;
          };
          const q = {
            eq(col: string, val: unknown) {
              filtros.push(["eq", col, val]);
              return q;
            },
            lt(col: string, val: unknown) {
              filtros.push(["lt", col, val]);
              return q;
            },
            async select() {
              return { data: aplicar().map((f) => ({ pausado_hasta: f.pausado_hasta })), error: null };
            },
            then(resolve: (v: { data: null; error: null }) => void) {
              aplicar();
              resolve({ data: null, error: null });
            },
          };
          return q;
        },
        select() {
          const filtros: Array<[string, string, unknown]> = [];
          const q = {
            eq(col: string, val: unknown) {
              filtros.push(["eq", col, val]);
              return q;
            },
            async maybeSingle() {
              const f = filas.find((x) => coincide(x, filtros));
              return { data: f ? { pausado_hasta: f.pausado_hasta } : null, error: null };
            },
          };
          return q;
        },
      };
    },
  };
  return { supabase: supabase as unknown as SupabaseClient, filas };
}

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const PN = "1337486632773969";
const CHAT = "573148127388";
const hastaEn = (ms: number) => new Date(Date.now() + ms).toISOString();
const restante = (iso: string) => Date.parse(iso) - Date.now();

describe("activarPausaPorRespuestaHumana — la asesora nunca acorta el traspaso", () => {
  it("traspaso de 30 días + respuesta de la asesora (30 min) → sigue en ~30 días", async () => {
    const { supabase, filas } = pausasEnMemoria([
      { phone_number_id: PN, telefono_cliente: CHAT, pausado_hasta: hastaEn(720 * HORA), pausado_desde: new Date(0).toISOString(), seguimiento_enviado: true },
    ]);
    const r = await activarPausaPorRespuestaHumana(supabase, PN, CHAT, 30 * MIN);
    assert.equal(r.ok, true);
    assert.equal(filas.length, 1);
    assert.ok(restante(filas[0].pausado_hasta) > 719 * HORA, "la pausa de 30 días no debe acortarse");
    // Mismo efecto que siempre sobre el seguimiento: "una persona acaba de responder".
    assert.equal(filas[0].seguimiento_enviado, false);
    assert.ok(Date.now() - Date.parse(filas[0].pausado_desde!) < 5000);
  });

  it("traspaso de Daniela (24 h) + respuesta de Dani → sigue en ~24 h (regresión Daniela)", async () => {
    const { supabase, filas } = pausasEnMemoria([{ phone_number_id: PN, telefono_cliente: CHAT, pausado_hasta: hastaEn(24 * HORA) }]);
    await activarPausaPorRespuestaHumana(supabase, PN, CHAT, 30 * MIN);
    assert.ok(restante(filas[0].pausado_hasta) > 23 * HORA);
  });

  it("sin pausa previa → crea la pausa de 30 min (comportamiento de siempre)", async () => {
    const { supabase, filas } = pausasEnMemoria();
    await activarPausaPorRespuestaHumana(supabase, PN, CHAT, 30 * MIN);
    assert.equal(filas.length, 1);
    assert.ok(Math.abs(restante(filas[0].pausado_hasta) - 30 * MIN) < 5000);
    assert.equal(filas[0].seguimiento_enviado, false);
  });

  it("pausa más corta o vencida → se extiende a 30 min (comportamiento de siempre)", async () => {
    for (const previa of [hastaEn(5 * MIN), hastaEn(-HORA)]) {
      const { supabase, filas } = pausasEnMemoria([{ phone_number_id: PN, telefono_cliente: CHAT, pausado_hasta: previa, seguimiento_enviado: true }]);
      await activarPausaPorRespuestaHumana(supabase, PN, CHAT, 30 * MIN);
      assert.ok(Math.abs(restante(filas[0].pausado_hasta) - 30 * MIN) < 5000);
      assert.equal(filas[0].seguimiento_enviado, false);
    }
  });

  it("solo toca SU chat: la pausa de otro cliente o de otro número queda igual", async () => {
    const otroChat = { phone_number_id: PN, telefono_cliente: "573000000001", pausado_hasta: hastaEn(2 * HORA), seguimiento_enviado: true };
    const otroNumero = { phone_number_id: "OTRO", telefono_cliente: CHAT, pausado_hasta: hastaEn(2 * HORA), seguimiento_enviado: true };
    const { supabase, filas } = pausasEnMemoria([otroChat, otroNumero]);
    await activarPausaPorRespuestaHumana(supabase, PN, CHAT, 30 * MIN);
    assert.deepEqual(filas.slice(0, 2), [otroChat, otroNumero]);
  });

  it("contraste: activarPausaChat (la función anterior del eco) SÍ acortaba el traspaso a 30 min", async () => {
    const upserts: FilaPausa[] = [];
    const supabase = {
      from: () => ({
        upsert: async (fila: FilaPausa) => {
          upserts.push(fila);
          return { error: null };
        },
      }),
    } as unknown as SupabaseClient;
    await activarPausaChat(supabase, PN, CHAT, 30 * MIN);
    assert.ok(restante(upserts[0].pausado_hasta) < 31 * MIN);
  });
});
