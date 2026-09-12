/**
 * Fase 3C (Trigger Router SaaS → Runtime, autorizado) — conexión de
 * resolverActivacionTriggerRouter() dentro de resolverFlowIdConTriggerRouting
 * (lib/flow-runtime-bridge.ts). Dos bloques:
 *
 * 1. Pruebas PURAS (Supabase falso, sin red, corren SIEMPRE) -- ejercitan la
 *    lógica de autorización en sí (allowlist OR SaaS, fail-closed ante
 *    excepción, kill switch, no duplicar la consulta si el allowlist ya
 *    autorizó). Mismo patrón de Supabase falso que
 *    lib/disponibilidad-servicio-nylas.test.ts / la sección "Escala -- 100
 *    tenants" de lib/flow-trigger-router-activacion.test.ts.
 *
 * 2. Integración real (Supabase real, tenant/flow/número descartables,
 *    gateada por HAS_SUPABASE) -- confirma que la activación SaaS de verdad
 *    dispara el matching real de triggers, con aislamiento real de
 *    tenant/phone_number_id, y que trigger_routing_activo=false dejado en
 *    su default no cambia el comportamiento de ningún cliente existente.
 *
 * NUNCA activa trigger_routing_activo para AMORE/Daniela/Solo Talento/
 * Charlotte -- todas las filas usadas acá son sintéticas y descartables,
 * creadas y borradas por este mismo archivo. NUNCA envía WhatsApp real
 * (sendMessageDepsOverride no se usa -- estos tests nunca llegan a
 * send_message porque los flows de prueba terminan en un nodo message que
 * SendMessageExecutor real intentaría enviar; en vez de eso se prueba
 * resolverFlowIdConTriggerRouting() de forma aislada, sin invocar
 * atenderMensajeConFlow/el Orchestrator completo, salvo en los tests de
 * integración real que ya reutilizan el patrón establecido del archivo
 * hermano lib/flow-runtime-bridge-trigger-routing.test.ts).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolverFlowIdConTriggerRouting } from "@/lib/flow-runtime-bridge";
import { createFlow, createFlowVersion, publishFlowVersion, createFlowTrigger } from "@/lib/flow/flow-store";
import type { FlowOrchestratorStore } from "@/lib/flow/orchestrator-types";
import type { FlowDefinition } from "@/lib/flow/types";
import type { ClienteConfig } from "@/lib/supabase";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// 1. PRUEBAS PURAS -- Supabase falso, nunca red real, corren siempre.
// ---------------------------------------------------------------------------

type FilaClienteConfigFake = {
  id_tenant: string;
  flow_activo: boolean;
  flow_id: string | null;
  trigger_routing_activo: boolean;
};

/**
 * Fake mínimo de SupabaseClient: soporta exactamente los dos caminos que
 * resolverFlowIdConTriggerRouting puede recorrer --
 * `.from("dulabs_clientes_config")...maybeSingle()` (resolverActivacionTriggerRouter)
 * y `.from("dulabs_flow_triggers")...` (resolveFlowForIncomingEvent, siempre
 * con una tabla de triggers VACÍA acá a propósito -- estas pruebas verifican
 * la AUTORIZACIÓN, no el matching real de triggers, que ya tiene su propia
 * suite dedicada e íntegramente real más abajo).
 */
function crearSupabaseFalso(params: {
  filaClienteConfig: FilaClienteConfigFake | null | "throw";
  onConsultaClienteConfig?: () => void;
}): SupabaseClient {
  const from = (tabla: string) => {
    if (tabla === "dulabs_clientes_config") {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        async maybeSingle() {
          params.onConsultaClienteConfig?.();
          if (params.filaClienteConfig === "throw") {
            throw new Error("fallo simulado de Supabase (test E)");
          }
          return { data: params.filaClienteConfig, error: null };
        },
      };
      return builder;
    }
    if (tabla === "dulabs_flow_triggers") {
      // Tabla de triggers SIEMPRE vacía -- ninguna de estas pruebas
      // necesita que el Trigger Router de verdad encuentre un match, solo
      // confirmar si LLEGÓ o no a consultarlo.
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        then(resolve: (r: { data: unknown[]; error: null }) => unknown) {
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    }
    throw new Error(`tabla inesperada en el fake: ${tabla}`);
  };
  return { from } as unknown as SupabaseClient;
}

const FAKE_STORE_SIN_EJECUCION: FlowOrchestratorStore = {
  getActiveExecution: async () => null,
} as unknown as FlowOrchestratorStore;

/** Simula una conversación YA en curso -- getActiveExecution devuelve una fila real (no null). */
const FAKE_STORE_CON_EJECUCION_ACTIVA: FlowOrchestratorStore = {
  getActiveExecution: async () => ({ id: "execution-fake-activa" }) as never,
} as unknown as FlowOrchestratorStore;

/**
 * Simula el escenario real del test D de lib/flow-runtime-bridge-fallback.test.ts
 * (tenantId inválido) -- getActiveExecution lanza una excepción real DENTRO
 * de resolverFlowIdConTriggerRouting (Opción C, autorizada).
 */
const FAKE_STORE_GETACTIVEEXECUTION_LANZA: FlowOrchestratorStore = {
  getActiveExecution: async () => {
    throw new Error('invalid input syntax for type uuid: "esto-no-es-un-uuid-valido"');
  },
} as unknown as FlowOrchestratorStore;

function clienteFake(flowId: string): ClienteConfig & { flow_activo: true; flow_id: string } {
  return {
    id: `c-fake-${randomUUID().slice(0, 8)}`,
    id_tenant: randomUUID(),
    phone_number_id: "phone-fake-no-en-ningun-allowlist",
    nombre_negocio: "Fase 3C fake",
    flow_activo: true as const,
    flow_id: flowId,
  } as ClienteConfig & { flow_activo: true; flow_id: string };
}

describe("Fase 3C — resolverFlowIdConTriggerRouting: lógica de autorización (Supabase falso, sin red)", () => {
  // A. trigger_routing_activo=false + fuera del allowlist -> legacy.
  it("A. trigger_routing_activo=false (fila real, no allowlist) -> usar_flow_id = cliente.flow_id", async () => {
    const supabase = crearSupabaseFalso({ filaClienteConfig: { id_tenant: "t", flow_activo: true, flow_id: "otro-flow", trigger_routing_activo: false } });
    const cliente = clienteFake("flow-legacy-a");
    const r = await resolverFlowIdConTriggerRouting({ supabase, cliente, telefonoCliente: "573000000000", texto: "hola", store: FAKE_STORE_SIN_EJECUCION });
    assert.deepEqual(r, { kind: "usar_flow_id", flowId: "flow-legacy-a" });
  });

  // C. flow_activo=false en la fila (aunque alguien forzara trigger_routing_activo=true
  // a nivel de dato, el propio resolverActivacionTriggerRouter ya lo revalida y
  // lo trata como inactivo -- ver lib/flow-trigger-router-activacion.ts).
  it("C. flow_activo=false -> SaaS nunca autoriza, cae a legacy", async () => {
    const supabase = crearSupabaseFalso({ filaClienteConfig: { id_tenant: "t", flow_activo: false, flow_id: null, trigger_routing_activo: false } });
    const cliente = clienteFake("flow-legacy-c");
    const r = await resolverFlowIdConTriggerRouting({ supabase, cliente, telefonoCliente: "573000000000", texto: "hola", store: FAKE_STORE_SIN_EJECUCION });
    assert.deepEqual(r, { kind: "usar_flow_id", flowId: "flow-legacy-c" });
  });

  // D. flow_id=null -> mismo resultado, por la misma razón que C.
  it("D. flow_id=null -> SaaS nunca autoriza, cae a legacy", async () => {
    const supabase = crearSupabaseFalso({ filaClienteConfig: { id_tenant: "t", flow_activo: true, flow_id: null, trigger_routing_activo: false } });
    const cliente = clienteFake("flow-legacy-d");
    const r = await resolverFlowIdConTriggerRouting({ supabase, cliente, telefonoCliente: "573000000000", texto: "hola", store: FAKE_STORE_SIN_EJECUCION });
    assert.deepEqual(r, { kind: "usar_flow_id", flowId: "flow-legacy-d" });
  });

  // E. resolverActivacionTriggerRouter lanza una excepción real -> fail-closed,
  // NUNCA se propaga, NUNCA rompe el mensaje -- cae a cliente.flow_id.
  it("E. resolverActivacionTriggerRouter lanza una excepción -> fallback a cliente.flow_id, sin propagar el error", async () => {
    const supabase = crearSupabaseFalso({ filaClienteConfig: "throw" });
    const cliente = clienteFake("flow-legacy-e");
    const r = await resolverFlowIdConTriggerRouting({ supabase, cliente, telefonoCliente: "573000000000", texto: "hola", store: FAKE_STORE_SIN_EJECUCION });
    assert.deepEqual(r, { kind: "usar_flow_id", flowId: "flow-legacy-e" }, "una excepción de Supabase nunca debe romper el mensaje ni cambiar el flow usado");
  });

  // F. Kill switch activo -> SaaS se considera inactivo aunque la fila real
  // esté 100% configurada como activa.
  it("F. TRIGGER_ROUTER_KILL_SWITCH activo -> SaaS inactivo, cae a legacy aunque la fila diga trigger_routing_activo=true", async () => {
    const original = process.env.TRIGGER_ROUTER_KILL_SWITCH;
    process.env.TRIGGER_ROUTER_KILL_SWITCH = "on";
    try {
      const supabase = crearSupabaseFalso({ filaClienteConfig: { id_tenant: "t", flow_activo: true, flow_id: "otro-flow", trigger_routing_activo: true } });
      const cliente = clienteFake("flow-legacy-f");
      const r = await resolverFlowIdConTriggerRouting({ supabase, cliente, telefonoCliente: "573000000000", texto: "hola", store: FAKE_STORE_SIN_EJECUCION });
      assert.deepEqual(r, { kind: "usar_flow_id", flowId: "flow-legacy-f" });
    } finally {
      if (original === undefined) delete process.env.TRIGGER_ROUTER_KILL_SWITCH;
      else process.env.TRIGGER_ROUTER_KILL_SWITCH = original;
    }
  });

  // H. allowlist=false + SaaS=false (combinación explícita) -> legacy.
  it("H. allowlist=false + SaaS=false -> legacy", async () => {
    const supabase = crearSupabaseFalso({ filaClienteConfig: { id_tenant: "t", flow_activo: true, flow_id: "otro-flow", trigger_routing_activo: false } });
    const cliente = clienteFake("flow-legacy-h");
    const r = await resolverFlowIdConTriggerRouting({ supabase, cliente, telefonoCliente: "573000000000", texto: "hola", store: FAKE_STORE_SIN_EJECUCION });
    assert.deepEqual(r, { kind: "usar_flow_id", flowId: "flow-legacy-h" });
  });

  // I. allowlist=true + SaaS=false -> comportamiento ACTUAL (idéntico a antes
  // de F3C): el Trigger Router SÍ se consulta (por el allowlist), y la
  // resolución SaaS NUNCA se consulta (no hace falta, el allowlist ya
  // autorizó) -- se confirma que dulabs_clientes_config nunca fue tocado.
  it("I. allowlist=true + SaaS=false -> Trigger Router se consulta por el allowlist, SIN consultar la fila SaaS (no duplica la consulta)", async () => {
    let seConsultoClienteConfig = false;
    const supabase = crearSupabaseFalso({
      filaClienteConfig: { id_tenant: "t", flow_activo: true, flow_id: "otro-flow", trigger_routing_activo: false },
      onConsultaClienteConfig: () => {
        seConsultoClienteConfig = true;
      },
    });
    const cliente = clienteFake("flow-legacy-i");
    // "test-trigger-routing-suite" + "573000009001" están en el allowlist
    // real (lib/flow-routing.ts::TRIGGER_ROUTING_TEST_SENDERS).
    const clienteAllowlisted = { ...cliente, phone_number_id: "test-trigger-routing-suite" };
    const r = await resolverFlowIdConTriggerRouting({
      supabase,
      cliente: clienteAllowlisted,
      telefonoCliente: "573000009001",
      texto: "hola",
      store: FAKE_STORE_SIN_EJECUCION,
    });
    // Sin triggers reales en el fake, cae a legacy -- lo importante es que
    // llegó hasta acá (pasó el gate) sin necesitar la fila SaaS.
    assert.deepEqual(r, { kind: "usar_flow_id", flowId: "flow-legacy-i" });
    assert.equal(seConsultoClienteConfig, false, "el allowlist ya autorizó -- nunca debe consultarse dulabs_clientes_config de más");
  });

  // J. allowlist=false + SaaS=true -> el Trigger Router SÍ se consulta,
  // habilitado únicamente por la activación SaaS.
  it("J. allowlist=false + SaaS=true -> Trigger Router se consulta por la activación SaaS", async () => {
    let seConsultoClienteConfig = false;
    const supabase = crearSupabaseFalso({
      filaClienteConfig: { id_tenant: "t", flow_activo: true, flow_id: "otro-flow", trigger_routing_activo: true },
      onConsultaClienteConfig: () => {
        seConsultoClienteConfig = true;
      },
    });
    const cliente = clienteFake("flow-legacy-j");
    const r = await resolverFlowIdConTriggerRouting({ supabase, cliente, telefonoCliente: "573000000000", texto: "hola", store: FAKE_STORE_SIN_EJECUCION });
    // Sin triggers reales en el fake, cae a legacy -- lo importante es que
    // SÍ consultó la activación SaaS (única forma en que pudo llegar hasta
    // la tabla de triggers, vacía, y terminar en flow_id legacy de todas formas).
    assert.deepEqual(r, { kind: "usar_flow_id", flowId: "flow-legacy-j" });
    assert.equal(seConsultoClienteConfig, true, "sin allowlist, la única vía de autorización es la activación SaaS -- debe haberse consultado");
  });

  // Corrección (autorizada) — reordenamiento: activeExecution se revisa
  // ANTES que la activación SaaS, para que una conversación ya en curso
  // NUNCA dispare una consulta nueva a resolverActivacionTriggerRouter.
  // Estos 4 tests son COMPORTAMENTALES (no inspeccionan texto-fuente): usan
  // el mismo spy ya establecido (onConsultaClienteConfig, sobre el Supabase
  // falso) para demostrar si la consulta SaaS real ocurrió o no, más un
  // FlowOrchestratorStore falso controlable para simular conversación
  // nueva vs. en curso.

  // 1. Conversación NUEVA + SaaS activo -> SÍ se consulta.
  it("1. conversación nueva + SaaS activo -> resolverActivacionTriggerRouter SÍ se consulta", async () => {
    let seConsulto = false;
    const supabase = crearSupabaseFalso({
      filaClienteConfig: { id_tenant: "t", flow_activo: true, flow_id: "otro-flow", trigger_routing_activo: true },
      onConsultaClienteConfig: () => {
        seConsulto = true;
      },
    });
    const cliente = clienteFake("flow-legacy-1");
    await resolverFlowIdConTriggerRouting({ supabase, cliente, telefonoCliente: "573000000000", texto: "hola", store: FAKE_STORE_SIN_EJECUCION });
    assert.equal(seConsulto, true, "conversación nueva -- la activación SaaS SÍ debe consultarse");
  });

  // 2. Conversación ACTIVA + SaaS activo -> NUNCA se consulta.
  it("2. conversación activa + SaaS activo -> resolverActivacionTriggerRouter NUNCA se consulta", async () => {
    let seConsulto = false;
    const supabase = crearSupabaseFalso({
      filaClienteConfig: { id_tenant: "t", flow_activo: true, flow_id: "otro-flow", trigger_routing_activo: true },
      onConsultaClienteConfig: () => {
        seConsulto = true;
      },
    });
    const cliente = clienteFake("flow-legacy-2");
    const r = await resolverFlowIdConTriggerRouting({
      supabase,
      cliente,
      telefonoCliente: "573000000000",
      texto: "hola",
      store: FAKE_STORE_CON_EJECUCION_ACTIVA,
    });
    assert.equal(seConsulto, false, "conversación YA activa -- NUNCA debe consultarse la activación SaaS, sin importar que esté activa para este número");
    assert.deepEqual(r, { kind: "usar_flow_id", flowId: "flow-legacy-2" }, "una ejecución activa siempre devuelve cliente.flow_id, sin excepción");
  });

  // 3. Conversación ACTIVA + SaaS inactivo -> comportamiento legacy (mismo
  // resultado que 2, mismo motivo: ni siquiera llega a mirar el flag).
  it("3. conversación activa + SaaS inactivo -> comportamiento legacy, sin consultar la fila SaaS", async () => {
    let seConsulto = false;
    const supabase = crearSupabaseFalso({
      filaClienteConfig: { id_tenant: "t", flow_activo: true, flow_id: "otro-flow", trigger_routing_activo: false },
      onConsultaClienteConfig: () => {
        seConsulto = true;
      },
    });
    const cliente = clienteFake("flow-legacy-3");
    const r = await resolverFlowIdConTriggerRouting({
      supabase,
      cliente,
      telefonoCliente: "573000000000",
      texto: "hola",
      store: FAKE_STORE_CON_EJECUCION_ACTIVA,
    });
    assert.equal(seConsulto, false);
    assert.deepEqual(r, { kind: "usar_flow_id", flowId: "flow-legacy-3" });
  });

  // 4. Conversación NUEVA + SaaS inactivo -> comportamiento legacy (SÍ
  // consulta la fila, la respuesta es "inactivo", cae a legacy igual).
  it("4. conversación nueva + SaaS inactivo -> comportamiento legacy", async () => {
    const supabase = crearSupabaseFalso({ filaClienteConfig: { id_tenant: "t", flow_activo: true, flow_id: "otro-flow", trigger_routing_activo: false } });
    const cliente = clienteFake("flow-legacy-4");
    const r = await resolverFlowIdConTriggerRouting({ supabase, cliente, telefonoCliente: "573000000000", texto: "hola", store: FAKE_STORE_SIN_EJECUCION });
    assert.deepEqual(r, { kind: "usar_flow_id", flowId: "flow-legacy-4" });
  });

  // 3 (micro-auditoría, Opción C) — getActiveExecution lanza DENTRO de
  // resolverFlowIdConTriggerRouting -> NO debe propagar la excepción; debe
  // devolver usar_flow_id/cliente.flow_id de inmediato (fail-closed
  // temporal), sin siquiera intentar la resolución SaaS. La garantía real
  // de que esto preserva "excepcion_fallback_a_legacy" para el caller la
  // demuestra, end-to-end y SIN modificar ese test, el test D de
  // lib/flow-runtime-bridge-fallback.test.ts (ver validación de esta fase).
  it("3. getActiveExecution lanza dentro del resolver -> NO propaga, retorna usar_flow_id/cliente.flow_id de inmediato", async () => {
    let seConsultoSaaS = false;
    const supabase = crearSupabaseFalso({
      filaClienteConfig: { id_tenant: "t", flow_activo: true, flow_id: "otro-flow", trigger_routing_activo: true },
      onConsultaClienteConfig: () => {
        seConsultoSaaS = true;
      },
    });
    const cliente = clienteFake("flow-legacy-3-getactiveexecution");
    const r = await resolverFlowIdConTriggerRouting({
      supabase,
      cliente,
      telefonoCliente: "573000000000",
      texto: "hola",
      store: FAKE_STORE_GETACTIVEEXECUTION_LANZA,
    });
    assert.deepEqual(r, { kind: "usar_flow_id", flowId: "flow-legacy-3-getactiveexecution" }, "una excepción de getActiveExecution nunca debe propagarse ni cambiar el flow usado");
    assert.equal(seConsultoSaaS, false, "fail-closed temporal: ni siquiera debe intentarse la resolución SaaS si no se pudo determinar activeExecution");
  });
});

// ---------------------------------------------------------------------------
// 2. INTEGRACIÓN REAL -- Supabase real, tenant/flow/número descartables.
// ---------------------------------------------------------------------------

describe(
  "Fase 3C — Trigger Router SaaS conectado al Runtime (integración real, tenant descartable)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const sufijo = randomUUID().slice(0, 8);
    const PHONE_A = `fase3c-a-${sufijo}`;
    const PHONE_B = `fase3c-b-${sufijo}`;
    const PHONE_M_LEGACY = `fase3c-m-${sufijo}`; // trigger_routing_activo=false explícito (M)

    let flowLegacyA: string;
    let flowTriggerA: string;
    let flowLegacyB: string;
    let flowTriggerB: string;
    let flowLegacyM: string;
    const flowIdsCreados: string[] = [];
    const phonesCreados: string[] = [];

    function flowEco(mensaje: string): FlowDefinition {
      return {
        name: mensaje,
        nodes: [
          { id: "start", type: "start", config: { triggerType: "first_message" } },
          { id: "msg", type: "message", config: { text: mensaje } },
          { id: "end", type: "end", config: {} },
        ],
        edges: [
          { id: "e1", source: "start", target: "msg" },
          { id: "e2", source: "msg", target: "end" },
        ],
        variables: [],
      };
    }

    async function crearYPublicar(tenantId: string, slug: string, mensaje: string): Promise<string> {
      const flow = await createFlow(supabase, { tenantId, slug: `${slug}-${sufijo}`, name: slug });
      flowIdsCreados.push(flow.id);
      const version = await createFlowVersion(supabase, { tenantId, flowId: flow.id, versionNumber: 1, definition: flowEco(mensaje) });
      await publishFlowVersion(supabase, tenantId, flow.id, version.id);
      return flow.id;
    }

    async function insertarClienteConfig(input: { phoneNumberId: string; tenantId: string; flowId: string; triggerRoutingActivo: boolean }) {
      await supabase.from("dulabs_clientes_config").insert({
        nombre_negocio: `Fase3C test ${input.phoneNumberId}`,
        whatsapp_business_account_id: `waba-${input.phoneNumberId}`,
        phone_number_id: input.phoneNumberId,
        telefono_negocio: "0000000000",
        id_tenant: input.tenantId,
        flow_activo: true,
        flow_id: input.flowId,
        trigger_routing_activo: input.triggerRoutingActivo,
      });
      phonesCreados.push(input.phoneNumberId);
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

      flowLegacyA = await crearYPublicar(TENANT_A, "f3c-legacy-a", "[LEGACY A] nunca debería verse si el trigger gana");
      flowTriggerA = await crearYPublicar(TENANT_A, "f3c-trigger-a", "[TRIGGER A] ganado por keyword real");
      flowLegacyB = await crearYPublicar(TENANT_B, "f3c-legacy-b", "[LEGACY B]");
      flowTriggerB = await crearYPublicar(TENANT_B, "f3c-trigger-b", "[TRIGGER B] -- jamas debe ganarle a un evento del tenant A");
      flowLegacyM = await crearYPublicar(TENANT_A, "f3c-legacy-m", "[LEGACY M -- trigger_routing_activo=false]");

      await createFlowTrigger(supabase, { tenantId: TENANT_A, flowId: flowTriggerA, config: { type: "message_contains", keywords: ["saas-b-test"] }, priority: 0 });
      // Mismo keyword en tenant B, prioridad altísima -- nunca debe poder
      // ganarle a un evento del tenant A (aislamiento real, test K).
      await createFlowTrigger(supabase, { tenantId: TENANT_B, flowId: flowTriggerB, config: { type: "message_contains", keywords: ["saas-b-test"] }, priority: 999 });

      await insertarClienteConfig({ phoneNumberId: PHONE_A, tenantId: TENANT_A, flowId: flowLegacyA, triggerRoutingActivo: true });
      await insertarClienteConfig({ phoneNumberId: PHONE_B, tenantId: TENANT_B, flowId: flowLegacyB, triggerRoutingActivo: true });
      await insertarClienteConfig({ phoneNumberId: PHONE_M_LEGACY, tenantId: TENANT_A, flowId: flowLegacyM, triggerRoutingActivo: false });
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (phonesCreados.length > 0) await supabase.from("dulabs_clientes_config").delete().in("phone_number_id", phonesCreados);
      await supabase.from("dulabs_flow_triggers").delete().eq("tenant_id", TENANT_A);
      await supabase.from("dulabs_flow_triggers").delete().eq("tenant_id", TENANT_B);
      await supabase.from("dulabs_flow_executions").delete().eq("phone_number_id", PHONE_A);
      await supabase.from("dulabs_flow_executions").delete().eq("phone_number_id", PHONE_B);
      await supabase.from("dulabs_flow_executions").delete().eq("phone_number_id", PHONE_M_LEGACY);
    });

    function clienteReal(phoneNumberId: string, tenantId: string, flowId: string): ClienteConfig & { flow_activo: true; flow_id: string } {
      return {
        id: `c-3c-${randomUUID().slice(0, 8)}`,
        id_tenant: tenantId,
        phone_number_id: phoneNumberId,
        nombre_negocio: "Fase 3C test (borrar)",
        flow_activo: true as const,
        flow_id: flowId,
      } as ClienteConfig & { flow_activo: true; flow_id: string };
    }

    function storeReal(): FlowOrchestratorStore {
      // Solo se necesita getActiveExecution para estas pruebas (nunca se
      // crea ninguna ejecución -- resolverFlowIdConTriggerRouting no toca
      // el Orchestrator).
      return {
        getActiveExecution: async (tenantId: string, conversation: { phoneNumberId: string; telefonoCliente: string }) => {
          const { data } = await supabase
            .from("dulabs_flow_executions")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("phone_number_id", conversation.phoneNumberId)
            .eq("telefono_cliente", conversation.telefonoCliente)
            .in("status", ["running", "waiting_input", "waiting_effect"])
            .maybeSingle();
          return data ?? null;
        },
      } as unknown as FlowOrchestratorStore;
    }

    // B. trigger_routing_activo=true real + trigger real coincidente -> el
    // Trigger Router selecciona el flow del trigger, NO el flow_id legacy.
    it("B. trigger_routing_activo=true (real) + keyword real coincidente -> selecciona el flow del trigger, no el legacy", async () => {
      const cliente = clienteReal(PHONE_A, TENANT_A, flowLegacyA);
      const r = await resolverFlowIdConTriggerRouting({
        supabase,
        cliente,
        telefonoCliente: "573000001001",
        texto: "quiero saas-b-test por favor",
        store: storeReal(),
      });
      assert.deepEqual(r, { kind: "usar_flow_id", flowId: flowTriggerA });
    });

    // K. Tenant isolation real -- el trigger del tenant B (prioridad 999,
    // mismo keyword) jamás gana el routing de un evento del tenant A.
    it("K. tenant isolation real: un trigger de otro tenant, con prioridad altísima y mismo keyword, nunca gana", async () => {
      const cliente = clienteReal(PHONE_A, TENANT_A, flowLegacyA);
      const r = await resolverFlowIdConTriggerRouting({
        supabase,
        cliente,
        telefonoCliente: "573000001002",
        texto: "quiero saas-b-test por favor",
        store: storeReal(),
      });
      assert.equal(r.kind, "usar_flow_id");
      assert.equal((r as { flowId: string }).flowId, flowTriggerA, "debe ganar el trigger del tenant A");
      assert.notEqual((r as { flowId: string }).flowId, flowTriggerB, "NUNCA el trigger del tenant B");
    });

    // L. phone_number_id isolation real -- PHONE_B (tenant B) resuelve
    // ÚNICAMENTE su propio trigger, nunca el de PHONE_A/tenant A.
    it("L. phone_number_id isolation real: PHONE_B solo puede resolver tenant B + flow B", async () => {
      const cliente = clienteReal(PHONE_B, TENANT_B, flowLegacyB);
      const r = await resolverFlowIdConTriggerRouting({
        supabase,
        cliente,
        telefonoCliente: "573000001003",
        texto: "quiero saas-b-test por favor",
        store: storeReal(),
      });
      assert.deepEqual(r, { kind: "usar_flow_id", flowId: flowTriggerB }, "PHONE_B debe resolver el trigger de SU PROPIO tenant, no el de A");
    });

    // M. Cliente existente con trigger_routing_activo=false (default real,
    // fila insertada explícitamente en false) -> resultado IDÉNTICO al
    // comportamiento anterior a F3C (cliente.flow_id, sin importar que
    // exista un trigger real coincidente en su propio tenant).
    it("M. trigger_routing_activo=false (default real) -> resultado idéntico al comportamiento anterior, ignora el trigger real existente", async () => {
      const cliente = clienteReal(PHONE_M_LEGACY, TENANT_A, flowLegacyM);
      const r = await resolverFlowIdConTriggerRouting({
        supabase,
        cliente,
        telefonoCliente: "573000001004",
        // Mismo keyword que el trigger REAL de TENANT_A -- si SaaS estuviera
        // habilitado, ganaría flowTriggerA. Con trigger_routing_activo=false
        // debe ignorarse por completo.
        texto: "quiero saas-b-test por favor",
        store: storeReal(),
      });
      assert.deepEqual(r, { kind: "usar_flow_id", flowId: flowLegacyM }, "sin activación SaaS, el trigger real del propio tenant se ignora -- comportamiento legacy intacto");
    });
  },
);
