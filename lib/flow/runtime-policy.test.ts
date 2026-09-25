/**
 * Política de runtime del flow (lib/flow/runtime-policy.ts) — mecanismo
 * GENÉRICO del motor. Lo esencial para la regresión: un flow SIN
 * runtimePolicy (todos los publicados antes: AMORE, Daniela, Solo Talento...)
 * obtiene la política vacía y nada cambia.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  decidirReinicio,
  esPalabraReinicio,
  leerPoliticaRuntime,
  politicaDeDefinicion,
  reiniciarSiLaPoliticaLoPide,
} from "@/lib/flow/runtime-policy";
import { safeParseFlowDefinition } from "@/lib/flow/schemas";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { solotalentoFlow } from "@/lib/flows/solotalento.flow";
import type { FlowRuntimePolicy } from "@/lib/flow/types";

const AHORA = Date.parse("2026-09-24T12:00:00Z");
const hace = (horas: number) => new Date(AHORA - horas * 3_600_000).toISOString();
const POLITICA: FlowRuntimePolicy = { deterministic: true, restart: { keywords: ["reiniciar", "menú", "inicio"], afterInactivityHours: 24 } };
const activa = (status: string, horas = 0) => ({ status, last_activity_at: hace(horas) }) as never;

describe("politicaDeDefinicion — retrocompatible", () => {
  it("un flow sin runtimePolicy (p. ej. Solo Talento) → política vacía", () => {
    assert.deepEqual(politicaDeDefinicion(solotalentoFlow()), {});
    assert.deepEqual(politicaDeDefinicion(null), {});
  });
  it("una política inválida se ignora (nunca rompe el runtime)", () => {
    assert.deepEqual(politicaDeDefinicion({ runtimePolicy: { deterministic: "si" } }), {});
    assert.deepEqual(politicaDeDefinicion({ runtimePolicy: { restart: { afterInactivityHours: -1 } } }), {});
  });
  it("una política válida se conserva al validar/parsear la definición", () => {
    const def = { ...solotalentoFlow(), runtimePolicy: POLITICA };
    const r = safeParseFlowDefinition(def);
    assert.ok(r.success);
    assert.deepEqual(r.data.runtimePolicy, POLITICA);
    // La política no agrega ni quita errores de publicación.
    assert.deepEqual(validateFlowForPublish(def).errors, validateFlowForPublish(solotalentoFlow()).errors);
    assert.deepEqual(politicaDeDefinicion(def), POLITICA);
  });
});

describe("esPalabraReinicio — mensaje completo, sin adivinar", () => {
  const k = POLITICA.restart!.keywords;
  for (const s of ["reiniciar", "Reiniciar", "REINICIAR!", "menú", "Menu", "MENÚ.", " inicio ", "Inicio 🙏"]) {
    it(`"${s}" → reinicia`, () => assert.equal(esPalabraReinicio(s, k), true));
  }
  for (const s of ["", "hola", "menú de gorras", "quiero reiniciar el pedido", "inicios", "6"]) {
    it(`"${s}" → no reinicia`, () => assert.equal(esPalabraReinicio(s, k), false));
  }
  it("sin palabras configuradas nunca reinicia", () => {
    assert.equal(esPalabraReinicio("menú", undefined), false);
    assert.equal(esPalabraReinicio("menú", []), false);
  });
});

describe("decidirReinicio", () => {
  const d = (x: Partial<Parameters<typeof decidirReinicio>[0]>) =>
    decidirReinicio({ politica: POLITICA, texto: "", activa: activa("waiting_input"), ahoraMs: AHORA, ...x });

  it("política vacía (todo flow sin runtimePolicy) → nunca reinicia, ni por palabra ni por tiempo", () => {
    assert.equal(d({ politica: {}, texto: "menú", activa: activa("waiting_input", 1000) }), null);
  });
  it("sin ejecución activa → nada (el camino normal ya arranca desde start)", () => {
    assert.equal(d({ texto: "menú", activa: null }), null);
  });
  it("palabra con ejecución esperando respuesta → 'palabra'", () => {
    assert.equal(d({ texto: "menú" }), "palabra");
  });
  it("> horas configuradas sin actividad → 'inactividad' (texto o botón)", () => {
    assert.equal(d({ texto: "Hola", activa: activa("waiting_input", 24.5) }), "inactividad");
    assert.equal(d({ texto: "Empresa", buttonId: "empresa", activa: activa("waiting_input", 48) }), "inactividad");
  });
  it("≤ horas configuradas → continúa donde iba", () => {
    assert.equal(d({ texto: "Hola", activa: activa("waiting_input", 23.9) }), null);
  });
  it("sin afterInactivityHours no hay reinicio por tiempo", () => {
    assert.equal(d({ politica: { restart: { keywords: ["menú"] } }, texto: "Hola", activa: activa("waiting_input", 1000) }), null);
  });
  it("NUNCA corta un efecto en vuelo (waiting_effect), ni con palabra ni por tiempo", () => {
    assert.equal(d({ texto: "menú", activa: activa("waiting_effect", 100) }), null);
  });
  it("un botón con id igual a una palabra no cuenta como palabra", () => {
    assert.equal(d({ texto: "inicio", buttonId: "inicio" }), null);
  });
});

describe("leerPoliticaRuntime", () => {
  const def = { runtimePolicy: POLITICA };
  const store = (o: { activa?: unknown; publicada?: string | null; lanzar?: boolean }) => {
    const llamadas: string[] = [];
    return {
      llamadas,
      store: {
        getActiveExecution: async () => {
          llamadas.push("activa");
          if (o.lanzar) throw new Error("db");
          return (o.activa ?? null) as never;
        },
        getFlow: async () => {
          llamadas.push("flow");
          return (o.publicada === null ? null : { published_version_id: o.publicada ?? "v-pub" }) as never;
        },
        getFlowVersion: async (_t: string, id: string) => {
          llamadas.push(`version:${id}`);
          return { definition_json: id.startsWith("sin") ? {} : def } as never;
        },
      },
    };
  };
  const base = { tenantId: "t", conversation: { phoneNumberId: "p", telefonoCliente: "c" }, flowId: "f" };

  it("con ejecución activa usa la versión de ESA ejecución", async () => {
    const s = store({ activa: { flow_version_id: "v-activa-1" } });
    const r = await leerPoliticaRuntime({ ...base, store: s.store });
    assert.deepEqual(r.politica, POLITICA);
    assert.deepEqual(s.llamadas, ["activa", "version:v-activa-1"]);
  });
  it("sin ejecución activa usa la versión publicada del flow", async () => {
    const s = store({ publicada: "v-pub-2" });
    assert.deepEqual((await leerPoliticaRuntime({ ...base, store: s.store })).politica, POLITICA);
  });
  it("una versión ya leída se sirve de caché (las versiones son inmutables)", async () => {
    const s = store({ activa: { flow_version_id: "v-cache-3" } });
    await leerPoliticaRuntime({ ...base, store: s.store });
    await leerPoliticaRuntime({ ...base, store: s.store });
    assert.equal(s.llamadas.filter((l) => l.startsWith("version")).length, 1);
  });
  it("flow sin política o sin versión publicada → vacía", async () => {
    assert.deepEqual((await leerPoliticaRuntime({ ...base, store: store({ publicada: "sin-politica-4" }).store })).politica, {});
    assert.deepEqual((await leerPoliticaRuntime({ ...base, store: store({ publicada: null }).store })).politica, {});
  });
  it("un error de base de datos → política vacía (comportamiento de siempre), nunca lanza", async () => {
    assert.deepEqual((await leerPoliticaRuntime({ ...base, store: store({ lanzar: true }).store })).politica, {});
  });
});

describe("reiniciarSiLaPoliticaLoPide", () => {
  const supabaseEventos = (existe: boolean | "error") =>
    ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ limit: async () => (existe === "error" ? { data: null, error: { message: "x" } } : { data: existe ? [{ id: 1 }] : [], error: null }) }),
          }),
        }),
      }),
    }) as unknown as SupabaseClient;
  const fila = { id: "x", status: "waiting_input", last_activity_at: hace(0), state_version: 3, variables: {}, exports: {}, metadata: {} } as never;

  function correr(opts: { politica?: FlowRuntimePolicy; texto?: string; existe?: boolean | "error" }) {
    const guardados: Array<{ status: string; version: number }> = [];
    return reiniciarSiLaPoliticaLoPide({
      supabase: supabaseEventos(opts.existe ?? false),
      store: {
        saveExecutionState: async (_t, _id, state, v) => {
          guardados.push({ status: state.status, version: v });
          return { stateVersion: v + 1 } as never;
        },
      },
      tenantId: "t",
      politica: opts.politica ?? POLITICA,
      activa: fila,
      texto: opts.texto ?? "menú",
      eventId: "w1",
      ahoraMs: AHORA,
    }).then((motivo) => ({ motivo, guardados }));
  }

  it("cierra la ejecución activa como 'completed' con CAS sobre su state_version", async () => {
    const r = await correr({});
    assert.equal(r.motivo, "palabra");
    assert.deepEqual(r.guardados, [{ status: "completed", version: 3 }]);
  });
  it("reintento de Meta (el wamid ya fue procesado) → no reinicia", async () => {
    assert.deepEqual((await correr({ existe: true })).guardados, []);
  });
  it("error verificando duplicados → no reinicia (fail-safe)", async () => {
    assert.deepEqual((await correr({ existe: "error" })).guardados, []);
  });
  it("política vacía → no toca nada", async () => {
    assert.deepEqual((await correr({ politica: {} })).guardados, []);
  });
});

describe("runtimePolicy.humanTakeover (genérico)", () => {
  const flow = (runtimePolicy: unknown) => ({
    name: "f",
    runtimePolicy,
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [{ id: "e1", source: "start", target: "end" }],
    variables: [],
  });

  it("el esquema acepta renewHours positivo (hasta 30 días) y lo conserva", () => {
    const r = safeParseFlowDefinition(flow({ humanTakeover: { renewHours: 5 } }));
    assert.ok(r.success);
    assert.deepEqual(r.data.runtimePolicy?.humanTakeover, { renewHours: 5 });
    assert.deepEqual(politicaDeDefinicion({ runtimePolicy: { humanTakeover: { renewHours: 5 } } }).humanTakeover, { renewHours: 5 });
  });

  it("el esquema rechaza valores inválidos; una política inválida en BD se ignora (comportamiento de siempre)", () => {
    for (const malo of [{ renewHours: 0 }, { renewHours: -1 }, { renewHours: 24 * 31 }, {}]) {
      assert.equal(safeParseFlowDefinition(flow({ humanTakeover: malo })).success, false, JSON.stringify(malo));
    }
    assert.deepEqual(politicaDeDefinicion({ runtimePolicy: { humanTakeover: { renewHours: "5" } } }), {});
  });

  it("ningún otro flow del repositorio declara humanTakeover (AMORE, Daniela, Solo Talento no cambian)", async () => {
    const { amoreRouterFlow } = await import("@/lib/flows/amore-router.flow");
    const { danielaRouterFlow } = await import("@/lib/flows/daniela-router.flow");
    const { danielaAgendarCitaFlow } = await import("@/lib/flows/daniela-agendar-cita.flow");
    for (const f of [amoreRouterFlow(), danielaRouterFlow(), danielaAgendarCitaFlow(), solotalentoFlow()]) {
      assert.equal(f.runtimePolicy?.humanTakeover, undefined, f.name);
    }
  });
});
