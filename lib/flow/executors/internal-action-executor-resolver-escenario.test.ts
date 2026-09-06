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
import { AMORE_ESCENARIOS_SEED } from "@/lib/bot-escenarios/seed-amore";
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";

const CATALOGO_UNAS: ServicioCatalogoReal[] = [
  { id: "s-dipping", nombre: "Dipping", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-pressón", nombre: "Press On", precio: 80000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-una", nombre: "Uña", precio: 8000, duracionMin: 15, categoria: "Uñas", descripcion: null },
];

const AUTHORIZER: InternalActionAuthorizer = {
  assertActivacionOwnedByTenant: async () => true,
  assertPhoneNumberOwnedByTenant: async () => true,
};

function baseRequest(
  payload: Record<string, unknown>,
  conversation?: { phoneNumberId: string; telefonoCliente: string },
): EffectDispatchRequest {
  return {
    effectId: "eff-1",
    executionRowId: "exec-1",
    tenantId: "tenant-amore",
    nodeId: "act-resolver-escenario",
    attempt: 1,
    kind: "action",
    action: { actionType: "resolver_escenario" },
    payload,
    conversation,
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
    cargarConocimientoReal: async () => [],
    // FASE 1 -- Agendamiento conversacional (autorizado). Default seguro
    // para este archivo (que no prueba agendamiento): AMORE_ESCENARIOS_SEED
    // ya incluye 070_agendamiento, así que cualquier guion real que
    // mencione "quiero una cita" activaría el wiring de resolver.ts que
    // resuelve especialistas reales -- sin este default fallaría contra el
    // supabase falso de este archivo.
    cargarEspecialistas: async () => [],
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

  describe("esPrimerTurno -- señal mínima de continuidad (FASE, refinamiento conversacional)", () => {
    it("turno=0 (primer mensaje real de la conversación) -> esPrimerTurno=true", async () => {
      const executor = crearExecutor();
      const result = await executor.dispatch(baseRequest({ mensajeActual: "hola" }), { tenantId: "tenant-amore", internal: true });
      assert.equal((result.data as Record<string, unknown>).esPrimerTurno, true);
    });

    it("turno>0 (conversación ya en curso) -> esPrimerTurno=false, sin importar qué escenario gane", async () => {
      const executor = crearExecutor();
      const result = await executor.dispatch(
        baseRequest({ mensajeActual: "hola", __turnoEscenario: 1 }),
        { tenantId: "tenant-amore", internal: true },
      );
      assert.equal((result.data as Record<string, unknown>).esPrimerTurno, false);
    });

    it("sección 24 A-G del pedido: guion completo de conversación real -- solo el turno 1 es esPrimerTurno=true, todos los siguientes false", async () => {
      const executor = crearExecutor({
        cargarEscenariosReal: async () => AMORE_ESCENARIOS_SEED.map((e, i) => ({ ...e, id: `e${i}`, tenantId: "tenant-amore" })),
        listarCatalogoServiciosReal: async () => CATALOGO_UNAS,
      });

      const guion = [
        "Hola",
        "Quiero arreglarme las uñas",
        "No sé qué hacerme",
        "¿Qué es el Dipping?",
        "¿Y cuánto cuesta?",
        "Quiero una cita",
      ];

      let turno: unknown = undefined;
      const esPrimerTurnoPorMensaje: boolean[] = [];
      for (const mensaje of guion) {
        const result = await executor.dispatch(
          baseRequest({ mensajeActual: mensaje, ...(turno !== undefined ? { __turnoEscenario: turno } : {}) }),
          { tenantId: "tenant-amore", internal: true },
        );
        const data = result.data as Record<string, unknown>;
        esPrimerTurnoPorMensaje.push(data.esPrimerTurno as boolean);
        turno = data.__turnoEscenario;
      }

      assert.deepEqual(
        esPrimerTurnoPorMensaje,
        [true, false, false, false, false, false],
        `esPrimerTurno debía ser [true, false, false, false, false, false] para el guion completo, fue ${JSON.stringify(esPrimerTurnoPorMensaje)}`,
      );
    });
  });

  // Revisión (autorizada, secciones 15/16/28-C) -- saludo ocasional
  // personalizado por nombre para una clienta que regresa, SOLO en el
  // primer turno de la ejecución (nunca consulta Supabase en cada mensaje).
  describe("nombreClienteConocido -- saludo ocasional por nombre (revisión, autorizada)", () => {
    it("turno=0 con telefonoCliente real -> consulta y expone el nombre ya registrado", async () => {
      let telefonoRecibido: string | undefined;
      const executor = crearExecutor({
        buscarNombreConocido: async (_supabase, _phoneNumberId, telefonoCliente) => {
          telefonoRecibido = telefonoCliente;
          return "Mariana";
        },
      });
      const result = await executor.dispatch(
        baseRequest({ mensajeActual: "hola" }, { phoneNumberId: "pn-1", telefonoCliente: "573148127388" }),
        { tenantId: "tenant-amore", internal: true },
      );
      assert.equal((result.data as Record<string, unknown>).nombreClienteConocido, "Mariana");
      assert.equal(telefonoRecibido, "573148127388", "nunca debe inventar o dejar vacío el teléfono real de la conversación");
    });

    it("turno=0 sin registro conocido (cliente nueva) -> string vacío, nunca inventa un nombre", async () => {
      const executor = crearExecutor({ buscarNombreConocido: async () => null });
      const result = await executor.dispatch(
        baseRequest({ mensajeActual: "hola" }, { phoneNumberId: "pn-1", telefonoCliente: "573148127388" }),
        { tenantId: "tenant-amore", internal: true },
      );
      assert.equal((result.data as Record<string, unknown>).nombreClienteConocido, "");
    });

    it("turno>0 -- NUNCA vuelve a consultar (evita una lectura de Supabase en cada mensaje)", async () => {
      let llamadas = 0;
      const executor = crearExecutor({
        buscarNombreConocido: async () => {
          llamadas += 1;
          return "Mariana";
        },
      });
      const result = await executor.dispatch(
        baseRequest({ mensajeActual: "hola", __turnoEscenario: 3 }, { phoneNumberId: "pn-1", telefonoCliente: "573148127388" }),
        { tenantId: "tenant-amore", internal: true },
      );
      assert.equal((result.data as Record<string, unknown>).nombreClienteConocido, "");
      assert.equal(llamadas, 0);
    });

    it("sin telefonoCliente real en la conversación -> nunca llama a buscarNombreConocido", async () => {
      let llamadas = 0;
      const executor = crearExecutor({
        buscarNombreConocido: async () => {
          llamadas += 1;
          return "Mariana";
        },
      });
      const result = await executor.dispatch(baseRequest({ mensajeActual: "hola" }), { tenantId: "tenant-amore", internal: true });
      assert.equal((result.data as Record<string, unknown>).nombreClienteConocido, "");
      assert.equal(llamadas, 0);
    });
  });
});
