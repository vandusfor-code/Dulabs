/**
 * Acción GENÉRICA `registrar_en_modulo` (CORE). Sin negocio concreto: se prueba con un módulo y
 * manejadores de prueba. Regresión: un flow que no la usa no cambia (esquema, capacidades,
 * ruteo interno), y las barreras de seguridad se aplican ANTES de llamar al manejador.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { InternalActionExecutor, type InternalActionDeps } from "@/lib/flow/executors/internal-action-executor";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchRequest } from "@/lib/flow/executor-types";
import type { ManejadorRegistroModulo, RegistroModuloInput, RegistrosModuloStore, EstadoRegistroModulo } from "@/lib/flow/registro-modulo";
import { safeParseFlowDefinition } from "@/lib/flow/schemas";
import { isCriticalAction, resolveActionCapabilitySpec } from "@/lib/flow/action-capabilities";
import { REGISTROS_FLOW_POR_MODULO } from "@/lib/modulos/registros-flow";
import { MODULOS } from "@/lib/tenant-modulos";
import { amoreRouterFlow } from "@/lib/flows/amore-router.flow";
import { danielaRouterFlow } from "@/lib/flows/daniela-router.flow";
import { danielaAgendarCitaFlow } from "@/lib/flows/daniela-agendar-cita.flow";
import { solotalentoFlow } from "@/lib/flows/solotalento.flow";

const T = "tenant-uno";
const PN = "pn-uno";
const MODULO = "publibordados_clientes"; // cualquier ModuloId registrado sirve; el motor no lo interpreta

const accion = { actionType: "registrar_en_modulo" as const, modulo: MODULO, campos: { a: "var_a", b: "var_b" } };

/** Respaldo en memoria con las MISMAS reglas que dulabs_registros_modulo (única por ejecución; solo "pendiente" cambia). */
function storeMemoria(opts: { fallaAbrir?: boolean } = {}) {
  const filas: Array<{ id: number; tenantId: string; modulo: string; flowExecutionId: string; estado: EstadoRegistroModulo; intentos: number; error?: string | null; registroId?: string | null }> = [];
  const store: RegistrosModuloStore = {
    async abrir(i) {
      if (opts.fallaAbrir) throw new Error("bd caída");
      let f = filas.find((x) => x.tenantId === i.tenantId && x.modulo === i.modulo && x.flowExecutionId === i.flowExecutionId);
      if (!f) filas.push((f = { id: filas.length + 1, tenantId: i.tenantId, modulo: i.modulo, flowExecutionId: i.flowExecutionId, estado: "pendiente", intentos: 0 }));
      return { id: f.id, estado: f.estado, intentos: f.intentos };
    },
    async resolver(i) {
      const f = filas.find((x) => x.id === i.id && x.tenantId === i.tenantId && x.estado === "pendiente");
      if (!f) return { actualizado: false };
      Object.assign(f, { estado: i.estado, intentos: f.intentos + 1, error: i.error ?? null, registroId: i.registroId == null ? null : String(i.registroId) });
      return { actualizado: true };
    },
    reclamar: async () => [],
    resumen: async () => ({ pendientes: 0, fallidos: 0, filas: [] }),
    reencolar: async () => false,
  };
  return { store, filas };
}

function ejecutor(opts: {
  dueno?: boolean;
  habilitado?: boolean | Error;
  manejador?: ManejadorRegistroModulo | null;
  store?: RegistrosModuloStore;
  ahoraMs?: () => number;
}) {
  const llamadas: RegistroModuloInput[] = [];
  const esperas: number[] = [];
  const manejador: ManejadorRegistroModulo =
    opts.manejador ??
    (async (input) => {
      llamadas.push(input);
      return { ok: true, registroId: 7, creado: true };
    });
  const ex = new InternalActionExecutor({
    supabase: {} as SupabaseClient,
    authorizer: { assertPhoneNumberOwnedByTenant: async () => opts.dueno ?? true, assertActivacionOwnedByTenant: async () => false },
    moduloHabilitado: async () => {
      if (opts.habilitado instanceof Error) throw opts.habilitado;
      return opts.habilitado ?? true;
    },
    registrosDeModulo: opts.manejador === null ? {} : { [MODULO]: manejador },
    registrosModuloStore: opts.store,
    esperarMs: async (ms: number) => {
      esperas.push(ms);
    },
    ahoraMs: opts.ahoraMs,
  } as unknown as InternalActionDeps);
  return { ex, llamadas, esperas };
}

/** Manejador que responde según una secuencia y cuenta llamadas. */
function secuencia(...pasos: Array<"ok" | "transitorio" | "permanente" | "lanza" | "ok-existente">) {
  let i = 0;
  const contador = { llamadas: 0 };
  const manejador: ManejadorRegistroModulo = async () => {
    contador.llamadas++;
    const paso = pasos[Math.min(i++, pasos.length - 1)];
    if (paso === "lanza") throw new Error("socket hang up");
    if (paso === "transitorio") return { ok: false, motivo: "error_bd", reintentable: true };
    if (paso === "permanente") return { ok: false, motivo: "datos_invalidos", reintentable: false };
    return { ok: true, registroId: 7, creado: paso === "ok" };
  };
  return Object.defineProperty(manejador, "llamadas", { get: () => contador.llamadas }) as ManejadorRegistroModulo & { readonly llamadas: number };
}

const req = (over: Partial<EffectDispatchRequest> = {}): EffectDispatchRequest => ({
  effectId: "fx-1",
  executionRowId: "exec-real-1",
  tenantId: T,
  nodeId: "act-registrar",
  kind: "action",
  attempt: 1,
  action: accion,
  payload: { var_a: "uno", var_b: 2, otra: "no se envía", objeto: { x: 1 } },
  conversation: { phoneNumberId: PN, telefonoCliente: "573000000001" },
  ...over,
});
const ctx = { tenantId: T, internal: true };

describe("registrar_en_modulo — barreras (antes de tocar el módulo)", () => {
  it("éxito: el manejador recibe SOLO los campos declarados, la ejecución real y la conversación", async () => {
    const { ex, llamadas } = ejecutor({});
    const r = await ex.dispatch(req(), ctx);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.SUCCESS);
    assert.deepEqual(r.data, { registroId: 7, registroCreado: true });
    assert.equal(llamadas.length, 1);
    assert.deepEqual(llamadas[0].campos, { a: "uno", b: 2 });
    assert.equal(llamadas[0].flowExecutionId, "exec-real-1");
    assert.deepEqual([llamadas[0].tenantId, llamadas[0].phoneNumberId, llamadas[0].telefonoCliente], [T, PN, "573000000001"]);
  });

  it("valores no primitivos o ausentes llegan como null (nunca objetos arbitrarios)", async () => {
    const { ex, llamadas } = ejecutor({});
    await ex.dispatch(req({ action: { ...accion, campos: { a: "objeto", b: "no_existe" } } }), ctx);
    assert.deepEqual(llamadas[0].campos, { a: null, b: null });
  });

  it("número de otro tenant → SECURITY_REJECTED y el manejador NO se llama", async () => {
    const { ex, llamadas } = ejecutor({ dueno: false });
    const r = await ex.dispatch(req(), ctx);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
    assert.equal(llamadas.length, 0);
  });

  it("módulo no habilitado para el tenant → SECURITY_REJECTED", async () => {
    const { ex, llamadas } = ejecutor({ habilitado: false });
    const r = await ex.dispatch(req(), ctx);
    assert.deepEqual([r.classification, r.error], [EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED, "modulo_no_habilitado"]);
    assert.equal(llamadas.length, 0);
  });

  it("no se pudo verificar el módulo (error de BD) → RETRYABLE, nunca 'permitido'", async () => {
    const { ex, llamadas } = ejecutor({ habilitado: new Error("db caída") });
    const r = await ex.dispatch(req(), ctx);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE);
    assert.equal(llamadas.length, 0);
  });

  it("módulo desconocido o sin manejador registrado → NON_RETRYABLE", async () => {
    const r1 = await ejecutor({}).ex.dispatch(req({ action: { ...accion, modulo: "no_existe" } }), ctx);
    assert.deepEqual([r1.classification, r1.error], [EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, "modulo_desconocido"]);
    const r2 = await ejecutor({ manejador: null }).ex.dispatch(req(), ctx);
    assert.deepEqual([r2.classification, r2.error], [EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, "modulo_sin_registro"]);
  });

  it("sin conversación o sin ejecución → VALIDATION_ERROR", async () => {
    const { ex } = ejecutor({});
    assert.equal((await ex.dispatch(req({ conversation: undefined }), ctx)).classification, EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR);
    assert.equal((await ex.dispatch(req({ executionRowId: "" }), ctx)).classification, EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR);
  });

  it("fuera del contexto interno → SECURITY_REJECTED (igual que toda acción interna)", async () => {
    const r = await ejecutor({}).ex.dispatch(req(), { tenantId: T, internal: false });
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
  });
});

describe("registrar_en_modulo — resultado del manejador y reintentos en línea", () => {
  it("error transitorio → reintento → éxito (el cliente no pierde la solicitud)", async () => {
    const m = secuencia("transitorio", "ok");
    const { store, filas } = storeMemoria();
    const { ex, esperas } = ejecutor({ manejador: m, store });
    const r = await ex.dispatch(req(), ctx);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.SUCCESS);
    assert.equal(m.llamadas, 2);
    assert.deepEqual(esperas, [300], "espera creciente entre intentos");
    assert.deepEqual([filas.length, filas[0].estado, filas[0].registroId], [1, "registrado", "7"]);
  });

  it("timeout / respuesta ambigua (el registro SÍ se guardó) → el reintento lo encuentra: sin duplicar", async () => {
    // 1er intento: el módulo guarda y la respuesta se pierde (lanza). 2do: el módulo responde "ya existía".
    const m = secuencia("lanza", "ok-existente");
    const { store, filas } = storeMemoria();
    const r = await ejecutor({ manejador: m, store }).ex.dispatch(req(), ctx);
    assert.deepEqual(r.data, { registroId: 7, registroCreado: false });
    assert.equal(filas.length, 1);
    assert.equal(filas[0].estado, "registrado");
  });

  it("error permanente (datos inválidos) → UN solo intento, NON_RETRYABLE y respaldo 'fallido' visible", async () => {
    const m = secuencia("permanente", "ok");
    const { store, filas } = storeMemoria();
    const { ex, esperas } = ejecutor({ manejador: m, store });
    const r = await ex.dispatch(req(), ctx);
    assert.deepEqual([r.classification, r.error], [EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, "registro_rechazado:datos_invalidos"]);
    assert.equal(m.llamadas, 1, "un error definitivo no se reintenta");
    assert.deepEqual(esperas, []);
    assert.deepEqual([filas[0].estado, filas[0].error], ["fallido", "datos_invalidos"]);
  });

  it("fallo persistente → 3 intentos acotados, RETRYABLE y respaldo 'pendiente' para el conciliador", async () => {
    const m = secuencia("transitorio");
    const { store, filas } = storeMemoria();
    const { ex, esperas } = ejecutor({ manejador: m, store });
    const r = await ex.dispatch(req(), ctx);
    assert.deepEqual([r.success, r.classification, r.error], [false, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, "registro_pendiente:error_bd"]);
    assert.equal(m.llamadas, 3);
    assert.deepEqual(esperas, [300, 1200]);
    assert.deepEqual([filas[0].estado, filas[0].error, filas[0].intentos], ["pendiente", "error_bd", 1]);
  });

  it("el manejador lanza siempre → transitorio (nunca se asume éxito) y queda pendiente", async () => {
    const { store, filas } = storeMemoria();
    const r = await ejecutor({ manejador: secuencia("lanza"), store }).ex.dispatch(req(), ctx);
    assert.deepEqual([r.success, r.classification, r.error], [false, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, "registro_pendiente:excepcion"]);
    assert.equal(filas[0].estado, "pendiente");
  });

  it("presupuesto de tiempo: si no alcanza para otra espera, no reintenta más (lo retoma el conciliador)", async () => {
    let t = 0;
    const m = secuencia("transitorio");
    const { ex } = ejecutor({
      manejador: m,
      store: storeMemoria().store,
      ahoraMs: () => {
        t += 10_000; // cada consulta del reloj "consume" 10 s
        return t;
      },
    });
    await ex.dispatch(req(), ctx);
    assert.ok(m.llamadas < 3, `llamadas=${m.llamadas}`);
  });

  it("sin poder abrir el respaldo el registro se intenta igual; si además falla, el error lo dice (registro_sin_respaldo)", async () => {
    const ok = await ejecutor({ manejador: secuencia("ok"), store: storeMemoria({ fallaAbrir: true }).store }).ex.dispatch(req(), ctx);
    assert.equal(ok.classification, EFFECT_RESULT_CLASSIFICATIONS.SUCCESS);
    const mal = await ejecutor({ manejador: secuencia("transitorio"), store: storeMemoria({ fallaAbrir: true }).store }).ex.dispatch(req(), ctx);
    assert.equal(mal.error, "registro_sin_respaldo:error_bd");
  });

  it("barreras de seguridad/configuración: sin respaldo y sin llamar al módulo", async () => {
    for (const [opts, esperado] of [
      [{ dueno: false }, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED],
      [{ habilitado: false }, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED],
    ] as const) {
      const m = secuencia("ok");
      const { store, filas } = storeMemoria();
      const r = await ejecutor({ ...opts, manejador: m, store }).ex.dispatch(req(), ctx);
      assert.equal(r.classification, esperado);
      assert.deepEqual([m.llamadas, filas.length], [0, 0]);
    }
  });

  it("verificar el módulo falla por la BD 3 veces → pendiente (recuperable), sin llamar al módulo", async () => {
    const m = secuencia("ok");
    const { store, filas } = storeMemoria();
    const r = await ejecutor({ habilitado: new Error("db"), manejador: m, store }).ex.dispatch(req(), ctx);
    assert.deepEqual([r.classification, r.error], [EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, "registro_pendiente:modulo_no_verificable"]);
    assert.equal(m.llamadas, 0);
    assert.equal(filas[0].estado, "pendiente");
  });

  it("registro ya existente (reintento del efecto) → éxito con registroCreado=false", async () => {
    const r = await ejecutor({ manejador: async () => ({ ok: true, registroId: 7, creado: false }) }).ex.dispatch(req(), ctx);
    assert.deepEqual(r.data, { registroId: 7, registroCreado: false });
  });
});

describe("registrar_en_modulo — esquema, capacidades y registro (regresión)", () => {
  const flowCon = (config: Record<string, unknown>) => ({
    name: "f",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "a", type: "action", config },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "a" },
      { id: "e2", source: "a", target: "end" },
    ],
    variables: [],
  });

  it("el esquema acepta la acción bien formada y la conserva al parsear", () => {
    const r = safeParseFlowDefinition(flowCon(accion));
    assert.ok(r.success);
    assert.deepEqual((r.data.nodes[1] as { config: unknown }).config, accion);
  });

  it("el esquema rechaza módulo o campos mal formados", () => {
    for (const mala of [
      { ...accion, modulo: "Mayúsculas" },
      { ...accion, modulo: "" },
      { ...accion, campos: {} },
      { ...accion, campos: { "Campo Malo": "x" } },
      { ...accion, campos: { a: "" } },
    ]) {
      assert.equal(safeParseFlowDefinition(flowCon(mala)).success, false, JSON.stringify(mala));
    }
  });

  it("capacidad: 'elevated', sin afirmar hechos externos", () => {
    const spec = resolveActionCapabilitySpec(accion);
    assert.equal(spec.criticality, "elevated");
    assert.equal(spec.verifiesOnSuccess, undefined);
    assert.equal(isCriticalAction(accion), false);
  });

  it("cada manejador del registro corresponde a un módulo declarado en MODULOS", () => {
    for (const modulo of Object.keys(REGISTROS_FLOW_POR_MODULO)) assert.ok((MODULOS as readonly string[]).includes(modulo), modulo);
  });
});

describe("transferir_soporte — pauseMode (genérico, opt-in por flow)", () => {
  function transferencia(pauseMode?: "replace" | "extend") {
    const llamadas: string[] = [];
    const ex = new InternalActionExecutor({
      supabase: {} as SupabaseClient,
      authorizer: { assertPhoneNumberOwnedByTenant: async () => true, assertActivacionOwnedByTenant: async () => false },
      activarPausaChat: async () => {
        llamadas.push("activar");
        return { ok: true, pausadoHasta: "2030-01-01T00:00:00Z" };
      },
      extenderPausaChat: async () => {
        llamadas.push("extender");
        return { ok: true, efecto: "ya_mas_larga", pausadoHasta: "2030-02-01T00:00:00Z" };
      },
      readPausaUntil: async () => "2030-02-01T00:00:00Z",
    } as unknown as InternalActionDeps);
    const action = { actionType: "transferir_soporte" as const, pauseDurationHours: 5, ...(pauseMode ? { pauseMode } : {}) };
    return { llamadas, run: () => ex.dispatch(req({ nodeId: "act-transferir", action }), ctx) };
  }

  it("sin pauseMode (todos los flows existentes): REEMPLAZA la pausa, exactamente como siempre", async () => {
    const t = transferencia();
    assert.equal((await t.run()).success, true);
    assert.deepEqual(t.llamadas, ["activar"]);
  });

  it("AMORE, Daniela y Solo Talento no declaran pauseMode: siguen reemplazando la pausa de 24 h", () => {
    for (const flow of [amoreRouterFlow(), danielaRouterFlow(), danielaAgendarCitaFlow(), solotalentoFlow()]) {
      const transferencias = flow.nodes.filter((n) => n.type === "action" && (n.config as { actionType?: string }).actionType === "transferir_soporte");
      assert.ok(transferencias.length > 0, flow.name);
      for (const n of transferencias) assert.equal((n.config as { pauseMode?: string }).pauseMode, undefined, flow.name);
    }
  });

  it("pauseMode 'replace' explícito = comportamiento de siempre", async () => {
    const t = transferencia("replace");
    await t.run();
    assert.deepEqual(t.llamadas, ["activar"]);
  });

  it("pauseMode 'extend': usa la pausa que nunca acorta una vigente más larga", async () => {
    const t = transferencia("extend");
    const r = await t.run();
    assert.equal(r.success, true);
    assert.deepEqual(t.llamadas, ["extender"]);
  });

  it("el esquema acepta replace/extend y rechaza otro valor", () => {
    const flow = (config: Record<string, unknown>) => ({
      name: "f",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "a", type: "action", config },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "a" },
        { id: "e2", source: "a", target: "end" },
      ],
      variables: [],
    });
    for (const modo of ["replace", "extend"]) assert.ok(safeParseFlowDefinition(flow({ actionType: "transferir_soporte", pauseMode: modo })).success);
    assert.equal(safeParseFlowDefinition(flow({ actionType: "transferir_soporte", pauseMode: "nunca" })).success, false);
  });
});
