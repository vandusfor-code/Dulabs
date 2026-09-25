/**
 * PUBLI BORDADOS — runtime de punta a punta (sin red ni base de datos real).
 *
 * Piezas REALES: motor (runFlowEngine), orquestador (createExecutionOrchestrator:
 * idempotencia por evento, reintento de envío, save_data → contacto, efectos),
 * InternalActionExecutor (transferir_soporte → activarPausaChat real),
 * chatEnPausaHumana (gate del webhook), activarPausaPorRespuestaHumana (eco de
 * la asesora) y reiniciarFlowPublibordadosSiCorresponde (reinicio).
 * Lo único simulado es el almacenamiento (en memoria, con las mismas reglas:
 * ejecuciones por tenant, CAS por state_version, evento único por ejecución,
 * contacto único por número+teléfono con merge de custom_fields) y el envío a
 * Meta (se registra en vez de enviarse).
 *
 * `recibir` reproduce el orden del webhook + bridge: pausa → reinicio de
 * Publi Bordados → evento start/button/text → orquestador.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { createExecutionOrchestrator, type FlowOrchestratorStore } from "@/lib/flow/flow-orchestrator";
import { createTestEffectExecutorFramework } from "@/lib/flow/executor-factory";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectExecutor } from "@/lib/flow/executor-types";
import { InternalActionExecutor, type InternalActionDeps } from "@/lib/flow/executors/internal-action-executor";
import type { ManejadorRegistroModulo } from "@/lib/flow/registro-modulo";
import type { FlowExecutionRow } from "@/lib/flow/flow-store-types";
import { engineStateToExecutionUpdate } from "@/lib/flow/flow-store-types";
import { FlowExecutionConcurrencyConflictError } from "@/lib/flow/flow-store-errors";
import type { FlowEngineEvent, FlowEngineState } from "@/lib/flow/engine-types";
import type { FlowDefinition } from "@/lib/flow/types";
import { activarPausaChat, activarPausaPorRespuestaHumana, chatEnPausaHumana } from "@/lib/pausas-chat";
import {
  PUBLIBORDADOS_BIENVENIDA,
  PUBLIBORDADOS_CANTIDAD,
  PUBLIBORDADOS_MAYORISTA,
  PUBLIBORDADOS_NOMBRE,
  PUBLIBORDADOS_PRODUCTO,
  PUBLIBORDADOS_REINTENTO_CANTIDAD,
  PUBLIBORDADOS_REINTENTO_OPCION,
  PUBLIBORDADOS_TIPO_CLIENTE,
  PUBLIBORDADOS_TRASPASO,
  publibordadosFlow,
} from "@/lib/flows/publibordados.flow";
import { leerPoliticaRuntime, reiniciarSiLaPoliticaLoPide } from "@/lib/flow/runtime-policy";

const T_PB = "f46242e0-e05e-4225-bc45-9539615f26df";
const T_OTRO = "00000000-0000-4000-8000-000000000002";
const PN_PB = "1337486632773969";
const PN_OTRO = "999000111222333";
const CLIENTE = "573148127388";

const HORA = 60 * 60 * 1000;

function flowOtroTenant(): FlowDefinition {
  return {
    name: "Otro negocio",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "q", type: "question", config: { text: "¿Tu ciudad?", variableKey: "ciudad", required: true, validation: { kind: "text" } } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "q" },
      { id: "e2", source: "q", target: "end" },
    ],
    variables: [{ key: "ciudad", label: "Ciudad", type: "string" }],
  };
}

type Contacto = { id_tenant: string; phone_number_id: string; telefono_cliente: string; custom_fields: Record<string, unknown> };
type Pausa = { phone_number_id: string; telefono_cliente: string; pausado_hasta: string; pausado_desde?: string; seguimiento_enviado?: boolean };
type Enviado = { tenantId: string; phoneNumberId: string; telefono: string; texto: string; botones: string[] };

const ACTIVOS = new Set(["running", "waiting_input", "waiting_effect"]);

function crearMundo() {
  const flows: Record<string, { tenant: string; definition: FlowDefinition; numero: string }> = {
    "flow-pb": { tenant: T_PB, definition: publibordadosFlow(), numero: PN_PB },
    "flow-otro": { tenant: T_OTRO, definition: flowOtroTenant(), numero: PN_OTRO },
    // Copia del flow de PB publicada por OTRO tenant (para probar que no puede pausar un número ajeno).
    "flow-pb-copia": { tenant: T_OTRO, definition: publibordadosFlow(), numero: PN_PB },
  };
  const duenoNumero: Record<string, string> = { [PN_PB]: T_PB, [PN_OTRO]: T_OTRO };
  const ejecuciones: FlowExecutionRow[] = [];
  const eventos: Array<{ tenant_id: string; flow_execution_id: string; event_id: string }> = [];
  const efectos = new Map<string, { status: string; applied?: Record<string, unknown> }>();
  const contactos: Contacto[] = [];
  const pausas: Pausa[] = [];
  const enviados: Enviado[] = [];
  let seq = 0;

  const clave = (pn: string, tel: string) => `${pn}|${tel}`;

  const store: FlowOrchestratorStore = {
    async getActiveExecution(tenantId, conv) {
      return (
        [...ejecuciones]
          .reverse()
          .find(
            (e) =>
              e.tenant_id === tenantId &&
              e.phone_number_id === conv.phoneNumberId &&
              e.telefono_cliente === conv.telefonoCliente &&
              ACTIVOS.has(e.status),
          ) ?? null
      );
    },
    async getExecutionById(tenantId, id) {
      return ejecuciones.find((e) => e.id === id && e.tenant_id === tenantId) ?? null;
    },
    async getFlow(tenantId, flowId) {
      const f = flows[flowId];
      if (!f || f.tenant !== tenantId) return null;
      return { tenant_id: tenantId, id: flowId, slug: flowId, name: flowId, status: "published", published_version_id: `${flowId}-v1` } as never;
    },
    async getFlowVersion(tenantId, versionId) {
      const flowId = versionId.replace(/-v1$/, "");
      const f = flows[flowId];
      if (!f || f.tenant !== tenantId) return null;
      return { tenant_id: tenantId, id: versionId, flow_id: flowId, version_number: 1, definition_json: f.definition } as never;
    },
    async createExecution(input) {
      const activa = await store.getActiveExecution(input.tenantId, { phoneNumberId: input.phoneNumberId, telefonoCliente: input.telefonoCliente });
      if (activa) return { created: false, existing: activa } as never;
      const ahora = new Date().toISOString();
      const row = {
        tenant_id: input.tenantId,
        id: `row-${++seq}`,
        flow_id: input.flowId,
        flow_version_id: input.flowVersionId,
        execution_id: input.executionId,
        phone_number_id: input.phoneNumberId,
        telefono_cliente: input.telefonoCliente,
        ...engineStateToExecutionUpdate(input.initialState),
        state_version: 1,
        created_at: ahora,
        updated_at: ahora,
      } as FlowExecutionRow;
      ejecuciones.push(row);
      return { created: true, row } as never;
    },
    async saveExecutionState(tenantId, id, state: FlowEngineState, expected) {
      const i = ejecuciones.findIndex((e) => e.id === id && e.tenant_id === tenantId);
      if (i < 0) throw new Error("execution not found");
      if (ejecuciones[i].state_version !== expected) throw new FlowExecutionConcurrencyConflictError({ tenantId, executionRowId: id, expectedStateVersion: expected });
      ejecuciones[i] = { ...ejecuciones[i], ...engineStateToExecutionUpdate(state), state_version: expected + 1 };
      return { stateVersion: expected + 1 } as never;
    },
    async insertEventIdempotent(input) {
      if (eventos.some((e) => e.tenant_id === input.tenantId && e.flow_execution_id === input.flowExecutionId && e.event_id === input.eventId)) {
        return { inserted: false, row: null } as never;
      }
      eventos.push({ tenant_id: input.tenantId, flow_execution_id: input.flowExecutionId, event_id: input.eventId });
      return { inserted: true, row: {} } as never;
    },
    async insertEffectIdempotent(input) {
      const k = `${input.flowExecutionId}|${input.effectId}`;
      if (efectos.has(k)) return { inserted: false } as never;
      efectos.set(k, { status: "pending" });
      return { inserted: true } as never;
    },
    async getEffectByEffectId(_t, execId, effectId) {
      const fx = efectos.get(`${execId}|${effectId}`);
      if (!fx || fx.status === "pending") return null;
      return { effect_id: effectId, status: fx.status, result_payload_applied: fx.applied ?? null, result_payload_raw: fx.applied ?? null } as never;
    },
    async resolveEffectResult(input) {
      const fx = efectos.get(`${input.flowExecutionId}|${input.effectId}`)!;
      fx.status = input.status;
      fx.applied = input.resultPayloadApplied;
      return { ok: true, row: { effect_id: input.effectId, status: input.status, result_payload_applied: input.resultPayloadApplied ?? null } } as never;
    },
    async recordNodeTransition() {},
    async resolveOrCreateContact(tenantId, conv) {
      let c = contactos.find((x) => clave(x.phone_number_id, x.telefono_cliente) === clave(conv.phoneNumberId, conv.telefonoCliente));
      if (!c) {
        c = { id_tenant: tenantId, phone_number_id: conv.phoneNumberId, telefono_cliente: conv.telefonoCliente, custom_fields: {} };
        contactos.push(c);
      }
      return { customFields: { ...c.custom_fields } };
    },
    async persistContactCustomFields(tenantId, conv, customFields) {
      const c = contactos.find((x) => clave(x.phone_number_id, x.telefono_cliente) === clave(conv.phoneNumberId, conv.telefonoCliente));
      if (!c) contactos.push({ id_tenant: tenantId, phone_number_id: conv.phoneNumberId, telefono_cliente: conv.telefonoCliente, custom_fields: { ...customFields } });
      else c.custom_fields = { ...c.custom_fields, ...customFields };
    },
  };

  // dulabs_pausas_chat + dulabs_flow_events en memoria, con la API de supabase-js que usan las funciones reales.
  const supabase = {
    from(tabla: string) {
      if (tabla === "dulabs_flow_events") {
        const filtros: Record<string, unknown> = {};
        const q = {
          select: () => q,
          eq(col: string, val: unknown) {
            filtros[col] = val;
            return q;
          },
          async limit() {
            return { data: eventos.filter((e) => Object.entries(filtros).every(([k, v]) => (e as Record<string, unknown>)[k] === v)), error: null };
          },
        };
        return q;
      }
      assert.equal(tabla, "dulabs_pausas_chat");
      const filtros: Array<[string, string, unknown]> = [];
      const coincide = (f: Pausa) =>
        filtros.every(([op, col, val]) => {
          const actual = (f as Record<string, unknown>)[col];
          return op === "eq" ? actual === val : String(actual) < String(val);
        });
      return {
        upsert(fila: Pausa, opts: { ignoreDuplicates?: boolean }) {
          const existente = pausas.find((p) => p.phone_number_id === fila.phone_number_id && p.telefono_cliente === fila.telefono_cliente);
          let afectadas: Pausa[] = [];
          if (!existente) {
            pausas.push({ ...fila });
            afectadas = [fila];
          } else if (!opts?.ignoreDuplicates) {
            Object.assign(existente, fila);
            afectadas = [existente];
          }
          const res = { data: afectadas.map((p) => ({ pausado_hasta: p.pausado_hasta })), error: null };
          return Object.assign(Promise.resolve({ data: null, error: null }), { select: async () => res });
        },
        update(cambios: Partial<Pausa>) {
          const aplicar = () => {
            const af = pausas.filter(coincide);
            for (const p of af) Object.assign(p, cambios);
            return af;
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
              return { data: aplicar().map((p) => ({ pausado_hasta: p.pausado_hasta })), error: null };
            },
            then(resolve: (v: { data: null; error: null }) => void) {
              aplicar();
              resolve({ data: null, error: null });
            },
          };
          return q;
        },
        select() {
          const q = {
            eq(col: string, val: unknown) {
              filtros.push(["eq", col, val]);
              return q;
            },
            async maybeSingle() {
              const p = pausas.find(coincide);
              return { data: p ? { pausado_hasta: p.pausado_hasta } : null, error: null };
            },
          };
          return q;
        },
      };
    },
  } as unknown as SupabaseClient;

  /** Envío a Meta simulado. `fallarProximos` fuerza N fallos transitorios (503) antes de enviar. */
  let fallarProximos = 0;
  const envio: EffectExecutor = {
    kind: "send_message",
    version: "test",
    capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
    async dispatch(request) {
      if (fallarProximos > 0) {
        fallarProximos--;
        return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, error: "503", metadata: { httpStatus: 503 } };
      }
      const msg = (request as unknown as { message: { content: { text?: string }; buttons?: Array<{ label: string }> } }).message;
      enviados.push({
        tenantId: request.tenantId,
        phoneNumberId: request.conversation!.phoneNumberId,
        telefono: request.conversation!.telefonoCliente,
        texto: msg.content.text ?? "",
        botones: (msg.buttons ?? []).map((b) => b.label),
      });
      return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data: { delivered: true }, appliedResult: { delivered: true } };
    },
  };

  // Módulo de solicitudes: mismo contrato que la BD real (una por ejecución, idempotente; la
  // lógica SQL se prueba contra Postgres en clientes/solicitudes.integracion.test.ts).
  const solicitudes: Array<{ id: number; tenant: string; telefono: string; flowExecutionId: string; campos: Record<string, unknown> }> = [];
  let registroFalla = false;
  const registrarSolicitud: ManejadorRegistroModulo = async (input) => {
    if (registroFalla) return { ok: false, motivo: "error_bd", reintentable: true };
    const previa = solicitudes.find((x) => x.tenant === input.tenantId && x.flowExecutionId === input.flowExecutionId);
    if (previa) return { ok: true, registroId: previa.id, creado: false };
    const nueva = { id: solicitudes.length + 1, tenant: input.tenantId, telefono: input.telefonoCliente, flowExecutionId: input.flowExecutionId, campos: { ...input.campos } };
    solicitudes.push(nueva);
    return { ok: true, registroId: nueva.id, creado: true };
  };

  // transferir_soporte y registrar_en_modulo REALES (InternalActionExecutor): verifican que el
  // número sea del tenant; el registro además exige el módulo habilitado para el tenant.
  const acciones = new InternalActionExecutor({
    supabase,
    authorizer: {
      assertPhoneNumberOwnedByTenant: async (tenantId: string, pn: string) => duenoNumero[pn] === tenantId,
      assertActivacionOwnedByTenant: async () => false,
    },
    registrosDeModulo: { publibordados_clientes: registrarSolicitud },
    moduloHabilitado: async (_sb: SupabaseClient, tenantId: string, modulo: string) => tenantId === T_PB && modulo === "publibordados_clientes",
    activarPausaChat,
    readPausaUntil: async (_sb: SupabaseClient, pn: string, tel: string) =>
      pausas.find((p) => p.phone_number_id === pn && p.telefono_cliente === tel)?.pausado_hasta ?? null,
  } as unknown as InternalActionDeps);

  const orquestador = createExecutionOrchestrator({
    store,
    engine: { createFlowEngineState, runFlowEngine },
    effectFramework: createTestEffectExecutorFramework({ executors: [envio, acciones] }),
    clock: { sleepMs: async () => {} },
  });

  /** Webhook + bridge: pausa → reinicio PB → start/button/text → orquestador. */
  async function recibir(
    msg: { texto?: string; boton?: string; wamid: string; tenant?: string; numero?: string; telefono?: string; flowId?: string },
  ): Promise<{ pausado: true } | { pausado: false; outcome: string }> {
    const tenant = msg.tenant ?? T_PB;
    const numero = msg.numero ?? PN_PB;
    const telefono = msg.telefono ?? CLIENTE;
    const texto = msg.texto ?? "";
    if (await chatEnPausaHumana(supabase, numero, telefono)) return { pausado: true };
    const flowId = msg.flowId ?? (tenant === T_PB ? "flow-pb" : "flow-otro");
    // Mismo orden que el bridge: política declarada por el flow → reinicio si la política lo pide.
    const { politica, activa: activaAntes } = await leerPoliticaRuntime({
      store,
      tenantId: tenant,
      conversation: { phoneNumberId: numero, telefonoCliente: telefono },
      flowId,
    });
    await reiniciarSiLaPoliticaLoPide({ supabase, store, tenantId: tenant, politica, activa: activaAntes, texto, eventId: msg.wamid, buttonId: msg.boton });
    const activa = await store.getActiveExecution(tenant, { phoneNumberId: numero, telefonoCliente: telefono });
    const engineEvent: FlowEngineEvent = !activa
      ? { type: "start", text: msg.boton || texto, eventId: msg.wamid }
      : msg.boton && activa.expected_input === "button"
        ? { type: "button", id: msg.boton, eventId: msg.wamid }
        : { type: "text", text: texto, eventId: msg.wamid };
    const r = await orquestador.process({
      tenantId: tenant,
      conversation: { phoneNumberId: numero, telefonoCliente: telefono },
      flowId,
      eventId: msg.wamid,
      eventType: "message",
      payload: { text: texto },
      engineEvent,
      receivedAt: new Date().toISOString(),
    });
    return { pausado: false, outcome: r.outcome };
  }

  let n = 0;
  const w = () => `wamid.${++n}`;
  /** Conversación completa hasta el traspaso. */
  async function completar(pasos: Array<{ texto?: string; boton?: string }>, telefono = CLIENTE) {
    await recibir({ texto: "Hola", wamid: w(), telefono });
    for (const p of pasos) await recibir({ ...p, wamid: w(), telefono });
  }

  return {
    store,
    supabase,
    ejecuciones,
    contactos,
    solicitudes,
    fallarRegistro: (v: boolean) => {
      registroFalla = v;
    },
    pausas,
    enviados,
    recibir,
    completar,
    w,
    fallarEnvios: (k: number) => {
      fallarProximos = k;
    },
    textos: (telefono = CLIENTE) => enviados.filter((e) => e.telefono === telefono).map((e) => e.texto),
    activa: (telefono = CLIENTE, tenant = T_PB, numero = PN_PB) => store.getActiveExecution(tenant, { phoneNumberId: numero, telefonoCliente: telefono }),
    envejecer(horas: number, telefono = CLIENTE) {
      for (const e of ejecuciones) {
        if (e.telefono_cliente === telefono && ACTIVOS.has(e.status)) e.last_activity_at = new Date(Date.now() - horas * HORA).toISOString();
      }
    },
  };
}

const EMPRESA_GORRAS_20 = [{ boton: "empresa" }, { texto: "Ana Gómez" }, { texto: "Textiles SAS" }, { boton: "gorras" }, { texto: "20" }];

let m: ReturnType<typeof crearMundo>;
beforeEach(() => {
  m = crearMundo();
});

describe("PB runtime — flujo completo, transferencia y pausa (A, M, N)", () => {
  it("recorrido completo: textos en orden, una sola transferencia, flow finalizado y pausa de 30 días", async () => {
    await m.completar(EMPRESA_GORRAS_20);
    assert.deepEqual(m.textos(), [
      PUBLIBORDADOS_BIENVENIDA,
      PUBLIBORDADOS_TIPO_CLIENTE,
      PUBLIBORDADOS_NOMBRE,
      "¿Cuál es el nombre de tu empresa?",
      PUBLIBORDADOS_PRODUCTO,
      PUBLIBORDADOS_CANTIDAD,
      PUBLIBORDADOS_MAYORISTA,
      PUBLIBORDADOS_TRASPASO,
    ]);
    assert.equal(m.ejecuciones.length, 1);
    assert.equal(m.ejecuciones[0].status, "completed");
    assert.equal(m.ejecuciones[0].current_node_id, "end-transferido");
    assert.equal(m.pausas.length, 1);
    const restante = Date.parse(m.pausas[0].pausado_hasta) - Date.now();
    assert.ok(restante > 719 * HORA && restante <= 720 * HORA);
  });

  it("después del traspaso el bot NO responde (ni 'Hola', ni 'menú', ni botones)", async () => {
    await m.completar(EMPRESA_GORRAS_20);
    const antes = m.enviados.length;
    for (const msg of [{ texto: "Hola" }, { texto: "menú" }, { texto: "reiniciar" }, { boton: "empresa" }, { texto: "¿ya me van a atender?" }]) {
      const r = await m.recibir({ ...msg, wamid: m.w() });
      assert.deepEqual(r, { pausado: true });
    }
    assert.equal(m.enviados.length, antes);
    assert.equal(m.ejecuciones.length, 1, "no se crea ninguna ejecución nueva durante la pausa");
  });
});

describe("PB runtime — respuesta de la asesora (O)", () => {
  it("la asesora responde desde el celular: la pausa de 30 días NO se acorta y el bot sigue callado", async () => {
    await m.completar(EMPRESA_GORRAS_20);
    const hasta = m.pausas[0].pausado_hasta;
    await activarPausaPorRespuestaHumana(m.supabase, PN_PB, CLIENTE, 30 * 60 * 1000); // eco de coexistencia
    assert.equal(m.pausas[0].pausado_hasta, hasta);
    assert.deepEqual(await m.recibir({ texto: "gracias", wamid: m.w() }), { pausado: true });
  });

  it("contraste: con la función anterior del eco, la pausa quedaba en 30 minutos", async () => {
    await m.completar(EMPRESA_GORRAS_20);
    await activarPausaChat(m.supabase, PN_PB, CLIENTE, 30 * 60 * 1000);
    assert.ok(Date.parse(m.pausas[0].pausado_hasta) - Date.now() < 31 * 60 * 1000);
  });
});

describe("PB runtime — duplicados, reintentos de Meta y fallos de envío (P)", () => {
  it("el mismo wamid entregado dos veces (reintento de Meta) no repite mensajes ni avanza dos veces", async () => {
    await m.recibir({ texto: "Hola", wamid: "wamid.A" });
    const r = await m.recibir({ texto: "Hola", wamid: "wamid.A" });
    assert.equal(r.pausado, false);
    assert.equal((r as { outcome: string }).outcome, "duplicate_event");
    assert.deepEqual(m.textos(), [PUBLIBORDADOS_BIENVENIDA, PUBLIBORDADOS_TIPO_CLIENTE]);
  });

  it("reintento de Meta del botón Empresa: se procesa una sola vez", async () => {
    await m.recibir({ texto: "Hola", wamid: m.w() });
    await m.recibir({ boton: "empresa", wamid: "wamid.B" });
    await m.recibir({ boton: "empresa", wamid: "wamid.B" });
    assert.equal(m.textos().filter((t) => t === PUBLIBORDADOS_NOMBRE).length, 1);
  });

  it("reintento de Meta de 'menú' NO reinicia dos veces (una sola bienvenida extra)", async () => {
    await m.recibir({ texto: "Hola", wamid: m.w() });
    await m.recibir({ boton: "empresa", wamid: m.w() });
    await m.recibir({ texto: "menú", wamid: "wamid.MENU" });
    await m.recibir({ texto: "menú", wamid: "wamid.MENU" });
    assert.equal(m.textos().filter((t) => t === PUBLIBORDADOS_BIENVENIDA).length, 2);
  });

  it("reintento de Meta del último mensaje: una sola transferencia y una sola pausa", async () => {
    await m.recibir({ texto: "Hola", wamid: m.w() });
    for (const p of EMPRESA_GORRAS_20.slice(0, -1)) await m.recibir({ ...p, wamid: m.w() });
    await m.recibir({ texto: "20", wamid: "wamid.FIN" });
    // Si el reintento llegara antes de que el webhook viera la pausa, igual no se duplica:
    m.pausas.length = 0;
    await m.recibir({ texto: "20", wamid: "wamid.FIN" });
    assert.equal(m.textos().filter((t) => t === PUBLIBORDADOS_TRASPASO).length, 1);
  });

  it("mensajes seguidos sin esperar respuesta: cada uno avanza una sola vez, sin duplicar textos", async () => {
    await m.recibir({ texto: "Hola", wamid: m.w() });
    await Promise.all([m.recibir({ boton: "persona_natural", wamid: m.w() }), m.recibir({ texto: "hola??", wamid: m.w() })]);
    const t = m.textos();
    assert.equal(t.filter((x) => x === PUBLIBORDADOS_BIENVENIDA).length, 1);
    assert.equal(new Set(t.filter((x) => x !== PUBLIBORDADOS_REINTENTO_OPCION && x !== PUBLIBORDADOS_TIPO_CLIENTE)).size, t.filter((x) => x !== PUBLIBORDADOS_REINTENTO_OPCION && x !== PUBLIBORDADOS_TIPO_CLIENTE).length);
  });

  it("error transitorio al enviar (503): se reintenta y el cliente recibe el mensaje UNA vez", async () => {
    m.fallarEnvios(1);
    await m.recibir({ texto: "Hola", wamid: m.w() });
    assert.deepEqual(m.textos(), [PUBLIBORDADOS_BIENVENIDA, PUBLIBORDADOS_TIPO_CLIENTE]);
  });
});

describe("PB runtime — reinicio y abandono (K, L)", () => {
  for (const palabra of ["reiniciar", "menú", "Menu", "INICIO", "inicio."]) {
    it(`"${palabra}" a mitad del flujo → vuelve a la bienvenida, conserva el contacto`, async () => {
      await m.completar([{ boton: "empresa" }, { texto: "Ana" }]);
      await m.recibir({ texto: palabra, wamid: m.w() });
      assert.deepEqual(m.textos().slice(-2), [PUBLIBORDADOS_BIENVENIDA, PUBLIBORDADOS_TIPO_CLIENTE]);
      assert.equal((await m.activa())?.current_node_id, "btn-tipo-cliente");
      assert.equal(m.contactos.length, 1);
    });
  }

  it("'menú' dentro de una frase NO reinicia (\"quiero ver el menú de gorras\" en la cantidad)", async () => {
    await m.completar([{ boton: "persona_natural" }, { texto: "Luis" }, { boton: "gorras" }]);
    await m.recibir({ texto: "quiero ver el menú de gorras", wamid: m.w() });
    assert.equal(m.textos().at(-1), PUBLIBORDADOS_REINTENTO_CANTIDAD);
    assert.equal((await m.activa())?.current_node_id, "q-cantidad");
  });

  it("vuelve después de 25 h en la pregunta del nombre: 'Hola' reinicia, NO se guarda como nombre", async () => {
    await m.completar([{ boton: "persona_natural" }]);
    m.envejecer(25);
    await m.recibir({ texto: "Hola", wamid: m.w() });
    assert.deepEqual(m.textos().slice(-2), [PUBLIBORDADOS_BIENVENIDA, PUBLIBORDADOS_TIPO_CLIENTE]);
    const activa = await m.activa();
    assert.equal(activa?.current_node_id, "btn-tipo-cliente");
    assert.equal(activa?.variables.nombre, undefined);
  });

  it("vuelve después de 23 h: continúa donde iba (abandono corto)", async () => {
    await m.completar([{ boton: "persona_natural" }]);
    m.envejecer(23);
    await m.recibir({ texto: "Luis", wamid: m.w() });
    assert.equal(m.textos().at(-1), PUBLIBORDADOS_PRODUCTO);
  });

  it("volver a completar el flow crea una SEGUNDA solicitud del MISMO cliente (sin duplicar el cliente)", async () => {
    await m.completar(EMPRESA_GORRAS_20);
    m.pausas.length = 0; // la asesora devolvió el chat al bot / la pausa venció
    await m.completar([{ boton: "persona_natural" }, { texto: "Ana" }, { boton: "mas_opciones" }, { boton: "uniformes" }, { texto: "3" }]);
    assert.equal(m.contactos.length, 1);
    assert.deepEqual(
      m.solicitudes.map((x) => [x.telefono, x.campos.producto, x.campos.cantidad]),
      [
        [CLIENTE, "gorras", "20"],
        [CLIENTE, "uniformes", "3"],
      ],
    );
    assert.notEqual(m.solicitudes[0].flowExecutionId, m.solicitudes[1].flowExecutionId, "cada solicitud sale de su propia ejecución");
  });
});

describe("PB runtime — solicitud registrada (R, 9, 21, 23)", () => {
  it("al completar el flow se registra UNA solicitud con los datos capturados, ligada a la ejecución REAL", async () => {
    await m.completar(EMPRESA_GORRAS_20);
    assert.equal(m.solicitudes.length, 1);
    const [s] = m.solicitudes;
    assert.deepEqual(s.campos, { tipo_cliente: "empresa", nombre: "Ana Gómez", nombre_empresa: "Textiles SAS", producto: "gorras", cantidad: "20" });
    assert.equal(s.tenant, T_PB);
    assert.equal(s.flowExecutionId, m.ejecuciones[0].id, "trazabilidad: el id de la ejecución real del flow");
    // El flow ya no guarda el historial en custom_fields del contacto.
    assert.deepEqual(m.contactos[0].custom_fields, {});
  });

  it("abandono: sin flow completo no hay solicitud", async () => {
    await m.completar([{ boton: "empresa" }, { texto: "Ana" }]);
    assert.equal(m.solicitudes.length, 0);
  });

  it("reintento de Meta del último mensaje: UNA sola solicitud", async () => {
    await m.recibir({ texto: "Hola", wamid: m.w() });
    for (const p of EMPRESA_GORRAS_20.slice(0, -1)) await m.recibir({ ...p, wamid: m.w() });
    await m.recibir({ texto: "20", wamid: "wamid.FINAL" });
    m.pausas.length = 0;
    await m.recibir({ texto: "20", wamid: "wamid.FINAL" });
    assert.equal(m.solicitudes.length, 1);
  });

  it("si el registro falla, el cliente IGUAL pasa a la asesora (traspaso + pausa)", async () => {
    m.fallarRegistro(true);
    await m.completar(EMPRESA_GORRAS_20);
    assert.equal(m.solicitudes.length, 0);
    assert.equal(m.textos().at(-1), PUBLIBORDADOS_TRASPASO);
    assert.equal(m.pausas.length, 1);
    assert.equal(m.ejecuciones[0].status, "completed");
  });
});

describe("PB runtime — aislamiento multi-tenant (Q)", () => {
  it("otro negocio: 'menú' y 25 h de inactividad NO reinician su flow (el reinicio es solo de Publi Bordados)", async () => {
    const otro = { tenant: T_OTRO, numero: PN_OTRO };
    await m.recibir({ ...otro, texto: "Hola", wamid: m.w() });
    await m.recibir({ ...otro, texto: "menú", wamid: m.w() });
    const ex = m.ejecuciones.filter((e) => e.tenant_id === T_OTRO);
    assert.equal(ex.length, 1);
    assert.equal(ex[0].status, "completed");
    assert.equal(ex[0].variables.ciudad, "menú", "el otro flow recibe 'menú' como respuesta normal");
  });

  it("el mismo teléfono en dos negocios: contactos y ejecuciones separados; nada de PB se ve en el otro", async () => {
    await m.completar(EMPRESA_GORRAS_20);
    await m.recibir({ tenant: T_OTRO, numero: PN_OTRO, texto: "Hola", wamid: m.w() });
    const cOtro = m.contactos.find((c) => c.id_tenant === T_OTRO)!;
    assert.deepEqual(cOtro.custom_fields, {});
    assert.equal(m.contactos.filter((c) => c.id_tenant === T_PB).length, 1);
    // La pausa de PB no silencia al otro negocio.
    assert.equal(m.enviados.filter((e) => e.tenantId === T_OTRO).length, 1);
  });

  it("transferir_soporte rechaza un número que no es del tenant: sin pausa sobre el chat de PB", async () => {
    const ajeno = { tenant: T_OTRO, numero: PN_PB, flowId: "flow-pb-copia" };
    await m.recibir({ ...ajeno, texto: "Hola", wamid: m.w() });
    for (const p of EMPRESA_GORRAS_20) await m.recibir({ ...ajeno, ...p, wamid: m.w() });
    assert.equal(m.pausas.length, 0, "el executor real debe negar la pausa (número de otro tenant)");
    const ex = m.ejecuciones.find((e) => e.tenant_id === T_OTRO)!;
    assert.notEqual(ex.status, "completed");
  });
});
