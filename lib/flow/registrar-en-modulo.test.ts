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
import type { ManejadorRegistroModulo, RegistroModuloInput } from "@/lib/flow/registro-modulo";
import { safeParseFlowDefinition } from "@/lib/flow/schemas";
import { isCriticalAction, resolveActionCapabilitySpec } from "@/lib/flow/action-capabilities";
import { REGISTROS_FLOW_POR_MODULO } from "@/lib/modulos/registros-flow";
import { MODULOS } from "@/lib/tenant-modulos";

const T = "tenant-uno";
const PN = "pn-uno";
const MODULO = "publibordados_clientes"; // cualquier ModuloId registrado sirve; el motor no lo interpreta

const accion = { actionType: "registrar_en_modulo" as const, modulo: MODULO, campos: { a: "var_a", b: "var_b" } };

function ejecutor(opts: {
  dueno?: boolean;
  habilitado?: boolean | Error;
  manejador?: ManejadorRegistroModulo | null;
}) {
  const llamadas: RegistroModuloInput[] = [];
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
  } as unknown as InternalActionDeps);
  return { ex, llamadas };
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

describe("registrar_en_modulo — resultado del manejador", () => {
  it("rechazo del módulo: reintentable → RETRYABLE; definitivo → NON_RETRYABLE (con el motivo)", async () => {
    const reint = await ejecutor({ manejador: async () => ({ ok: false, motivo: "error_bd", reintentable: true }) }).ex.dispatch(req(), ctx);
    assert.deepEqual([reint.success, reint.classification, reint.error], [false, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, "registro_rechazado:error_bd"]);
    const def = await ejecutor({ manejador: async () => ({ ok: false, motivo: "datos_invalidos", reintentable: false }) }).ex.dispatch(req(), ctx);
    assert.deepEqual([def.classification, def.error], [EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, "registro_rechazado:datos_invalidos"]);
  });

  it("el manejador lanza → EXTERNAL_AMBIGUOUS (no se asume éxito)", async () => {
    const r = await ejecutor({
      manejador: async () => {
        throw new Error("boom");
      },
    }).ex.dispatch(req(), ctx);
    assert.deepEqual([r.success, r.classification], [false, EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS]);
  });

  it("registro ya existente (reintento) → éxito con registroCreado=false", async () => {
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
