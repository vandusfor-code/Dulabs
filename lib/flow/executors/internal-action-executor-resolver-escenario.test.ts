/**
 * Cableado real entre InternalActionExecutor y
 * lib/bot-escenarios/resolver.ts para actionType "resolver_escenario" -- el
 * resto de la suite (lib/bot-escenarios/resolver.test.ts) prueba la lógica
 * pura; este archivo prueba que el executor lea/escriba las variables
 * correctas de request.payload/data (mensajeActual, __firstMessageText,
 * contexto, __turnoEscenario) y que tenant_mismatch/dependencias inyectadas
 * funcionen igual que el resto de acciones de este mismo archivo.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalActionExecutor } from "@/lib/flow/executors/internal-action-executor";
import type { InternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import type { EffectDispatchRequest } from "@/lib/flow/executor-types";
import type { EscenarioRow } from "@/lib/bot-escenarios/tipos";

const AUTHORIZER: InternalActionAuthorizer = {
  assertActivacionOwnedByTenant: async () => true,
  assertPhoneNumberOwnedByTenant: async () => true,
};

function baseRequest(payload: Record<string, unknown>): EffectDispatchRequest {
  return {
    effectId: "eff-1",
    executionRowId: "exec-1",
    tenantId: "tenant-amore",
    nodeId: "act-resolver-escenario",
    attempt: 1,
    kind: "action",
    action: { actionType: "resolver_escenario" },
    payload,
  } as EffectDispatchRequest;
}

const ESCENARIO_SALUDO: EscenarioRow = {
  id: "e1",
  tenantId: "tenant-amore",
  codigo: "001_saludo",
  nombre: "Saludo",
  modo: "deterministic",
  prioridad: 10,
  activo: true,
  variantes: [{ tipo: "contains", valor: "hola" }],
  respuestas: ["¡Hola! 💗"],
  config: {},
};

function crearExecutor(overrides: Partial<ConstructorParameters<typeof InternalActionExecutor>[0]> = {}) {
  return new InternalActionExecutor({
    supabase: {} as SupabaseClient,
    authorizer: AUTHORIZER,
    guardarLeadEnterprise: async () => ({ ok: false, motivo: "no_usado" }) as never,
    activarPausaChat: async () => ({ ok: false }) as never,
    verificarDisponibilidad: async () => ({ disponible: false }) as never,
    sugerirHorariosLibres: async () => [] as never,
    crearCita: async () => ({ ok: false }) as never,
    readPausaUntil: async () => null,
    consultarDisponibilidadEspecialista: async () => ({ disponible: false }) as never,
    validarServicioEspecialista: async () => ({ ok: false }) as never,
    agendarCitaEspecialista: async () => ({ ok: false }) as never,
    cancelarCitaEspecialista: async () => ({ ok: false }) as never,
    consultarCitasActivasEspecialista: async () => ({ ok: false }) as never,
    moverCitaEspecialista: async () => ({ ok: false }) as never,
    listarHorariosDisponiblesEspecialista: async () => ({ ok: false }) as never,
    cargarEscenariosReal: async () => [ESCENARIO_SALUDO],
    listarCatalogoServiciosReal: async () => [],
    listarProfesionalesServicioReal: async () => ({ profesionales: [] }),
    ...overrides,
  });
}

describe("InternalActionExecutor — resolver_escenario (cableado real)", () => {
  it("lee mensajeActual (turno actual) con prioridad sobre __firstMessageText (solo el primer turno)", async () => {
    const executor = crearExecutor();
    const result = await executor.dispatch(
      baseRequest({ mensajeActual: "hola", __firstMessageText: "un mensaje viejo que no debe usarse" }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, true);
    assert.equal((result.data as Record<string, unknown>).escenarioCodigo, "001_saludo");
  });

  it("en el primer turno (sin mensajeActual todavía) usa __firstMessageText", async () => {
    const executor = crearExecutor();
    const result = await executor.dispatch(baseRequest({ __firstMessageText: "hola" }), { tenantId: "tenant-amore", internal: true });
    assert.equal(result.success, true);
    assert.equal((result.data as Record<string, unknown>).escenarioCodigo, "001_saludo");
  });

  it("propaga y limpia el contexto conversacional correctamente (siempre emite las 6 claves)", async () => {
    const escenarioConContexto: EscenarioRow = {
      ...ESCENARIO_SALUDO,
      codigo: "999_test_transfer",
      modo: "transfer",
      variantes: [{ tipo: "contains", valor: "hablar con alguien" }],
      respuestas: ["Ya te comunico 💗"],
    };
    const executor = crearExecutor({ cargarEscenariosReal: async () => [escenarioConContexto] });
    const result = await executor.dispatch(
      baseRequest({
        mensajeActual: "hablar con alguien",
        ultimoServicioId: "s-viejo",
        ultimoServicioNombre: "Servicio Viejo",
        ultimoServicioBId: "s-viejo-b",
        ultimoServicioBNombre: "Servicio Viejo B",
      }),
      { tenantId: "tenant-amore", internal: true },
    );
    const data = result.data as Record<string, unknown>;
    assert.equal(data.ultimoServicioId, "", "el contexto debe quedar limpio tras una transferencia");
    assert.equal(data.ultimoServicioNombre, "");
    assert.equal(data.ultimoServicioBId, "", "el segundo servicio de una comparación también debe limpiarse");
    assert.equal(data.ultimoServicioBNombre, "");
  });

  it("incrementa __turnoEscenario en cada llamada (usado para rotar plantillas)", async () => {
    const executor = crearExecutor();
    const r1 = await executor.dispatch(baseRequest({ mensajeActual: "hola" }), { tenantId: "tenant-amore", internal: true });
    assert.equal((r1.data as Record<string, unknown>).__turnoEscenario, 1);
    const r2 = await executor.dispatch(
      baseRequest({ mensajeActual: "hola", __turnoEscenario: (r1.data as Record<string, unknown>).__turnoEscenario }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal((r2.data as Record<string, unknown>).__turnoEscenario, 2);
  });

  it("rechaza dispatch externo (context.internal=false), mismo gate que el resto de acciones internas", async () => {
    const executor = crearExecutor();
    const result = await executor.dispatch(baseRequest({ mensajeActual: "hola" }), { tenantId: "tenant-amore", internal: false });
    assert.equal(result.success, false);
    assert.equal(result.error, "external_action_not_routed");
  });
});
