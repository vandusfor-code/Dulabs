/**
 * R3 — E2E de CADENA COMPLETA con datos del cliente (offline, sin red/Supabase):
 *
 *   Spec(customerData) -> compile -> draft validado -> publish -> resolver real
 *     -> atenderMensajeConBusinessAgent (boundary real: blacklist + gate + orquestador)
 *       -> Flow Engine real (cond/question/buttons/save_data reales)
 *       -> propose_action -> InternalActionExecutor REAL -> crearCitaNylasGenerico REAL
 *          -> (Nylas fake) evento con los datos del cliente
 *
 * Solo son fakes: el LLM (stub que propone la acción), Nylas, el store del
 * calendario, la tabla de idempotencia y el store de contactos (mismo contrato
 * que el real). Lo que sí es real: compiler, registry, resolver, boundary,
 * orquestador, motor de flujo, autorización propose->action, executor y booking.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { createExecutionOrchestrator, type NormalizedFlowEvent } from "@/lib/flow/flow-orchestrator";
import { createTestEffectExecutorFramework } from "@/lib/flow/executor-factory";
import { IntegrationResolver } from "@/lib/flow/integration-resolver";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchRequest, type EffectExecutor } from "@/lib/flow/executor-types";
import { InternalActionExecutor } from "@/lib/flow/executors/internal-action-executor";
import type { InternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import type { ClienteConfig } from "@/lib/supabase";
import type { AgentCapabilities, BusinessAgentSpec, CustomerField } from "@/lib/agent-compiler/spec/types";
import { CAPABILITY_KEYS } from "@/lib/agent-compiler/spec/capabilities";
import { compileAndCreateDraftVersion, publishBusinessAgentVersion } from "@/lib/agent-compiler/registry/registry";
import { createInMemoryBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/testing/in-memory-registry-store";
import { createSupabaseBusinessAgentResolver } from "@/lib/agent-compiler/runtime/production/business-agent-resolver";
import { atenderMensajeConBusinessAgent } from "@/lib/agent-compiler/runtime/production/atender-business-agent";
import { createInMemoryOrchestratorStore } from "@/lib/agent-compiler/runtime/testing/in-memory-store";
import type { SemanticClassifier } from "@/lib/agent-compiler/runtime/guardrail-gate";
import { salonSpec } from "@/lib/agent-compiler/runtime/fixtures";
import { createInMemoryCalendarStore } from "@/lib/agent-compiler/calendar/testing/in-memory-calendar-store";
import type { NylasCreateEventParams, NylasEvent, NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const TELEFONO = "573001112233";
const PHONE_NUMBER_ID = "pn1";
const CONV = { phoneNumberId: PHONE_NUMBER_ID, telefonoCliente: TELEFONO };
const stubClassifier: SemanticClassifier = async () => null;
const AUTHORIZER: InternalActionAuthorizer = { assertActivacionOwnedByTenant: async () => true, assertPhoneNumberOwnedByTenant: async () => true };

function caps(p: Partial<AgentCapabilities>): AgentCapabilities {
  const base = Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, false])) as AgentCapabilities;
  return { ...base, ...p };
}
const campo = (over: Partial<CustomerField> & Pick<CustomerField, "key" | "type">): CustomerField => ({ label: over.key, required: false, enabled: true, scope: "customer", ...over });
const NOMBRE = campo({ key: "nombreCliente", type: "text", label: "Nombre", required: true });
const TEL = campo({ key: "telefonoCliente", type: "phone", label: "Teléfono", required: true });
const CORREO = campo({ key: "correoCliente", type: "email", label: "Correo" });
const EDAD = campo({ key: "edad", type: "number", label: "Edad", required: true });
const MOTIVO = campo({ key: "motivo", type: "select", label: "Motivo", required: true, scope: "booking", options: ["Primera vez", "Retoque"] });

const HORARIO = { week: Array.from({ length: 7 }, () => ({ closed: false, intervals: [{ open: "08:00", close: "20:00" }] })), exceptions: [] };
function agenteNylas(fields?: CustomerField[]): BusinessAgentSpec {
  const s = salonSpec();
  return {
    ...s,
    capabilities: caps({ scheduling: true, humanHandoff: true }),
    catalog: { source: "structured", useServices: false, useProducts: false, quoteBeforeQualification: false },
    scheduling: { ...s.scheduling, provider: "nylas", businessHours: HORARIO },
    ...(fields ? { customerData: { fields } } : {}),
  };
}

function cliente(flowId: string, tenantId: string): ClienteConfig {
  return {
    id: "cliente-1", id_tenant: tenantId, nombre_negocio: "Negocio X", whatsapp_business_account_id: "waba1",
    phone_number_id: PHONE_NUMBER_ID, telefono_negocio: "573000000000", prompt_sistema: null, api_key_ia: null,
    meta_permanent_token: null, estado_pausa: false, pausado_hasta: null, plan: null, mensajes_usados_mes: 0,
    mes_actual: "2026-09", base_conocimiento: null, base_conocimiento_nombre_archivo: null, base_conocimiento_actualizado_at: null,
    calidad: null, limite_mensajeria: null, estado_verificacion: null, estado_nombre_visible: null, ultima_sincronizacion_meta: null,
    nombre_agente: null, ia_pausada: false, ia_restringida_a: null, ia_numeros_bloqueados: null, forward_to_dumo: false,
    captura_leads: false, agente_id: null, marketplace_activacion_id: null, flow_activo: true, flow_id: flowId,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  } as ClienteConfig;
}

type Fila = Record<string, unknown>;
function supabaseIdempotencia(): SupabaseClient {
  const filas: Fila[] = [];
  const from = (tabla: string) => {
    if (tabla !== "dulabs_idempotencia_reservas") throw new Error(`tabla inesperada: ${tabla}`);
    const filtros: Array<(f: Fila) => boolean> = [];
    let insert: Fila | undefined;
    let update: Fila | undefined;
    const ejecutar = (): { data: Fila[]; error: { code: string; message: string } | null } => {
      if (insert) {
        const n = insert;
        if (filas.some((f) => f.id_tenant === n.id_tenant && f.idempotency_key === n.idempotency_key)) return { data: [], error: { code: "23505", message: "dup" } };
        const fila = { resultado_json: null, ...n };
        filas.push(fila);
        return { data: [fila], error: null };
      }
      if (update) {
        for (const f of filas) if (filtros.every((fn) => fn(f))) Object.assign(f, update);
        return { data: [], error: null };
      }
      return { data: filas.filter((f) => filtros.every((fn) => fn(f))), error: null };
    };
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), b),
      insert: (f: Fila) => ((insert = f), b),
      update: (c: Fila) => ((update = c), b),
      async maybeSingle() {
        const r = ejecutar();
        return { data: r.data[0] ?? null, error: r.error };
      },
      then: (resolve: (r: { data: Fila[]; error: unknown }) => unknown) => resolve(ejecutar()),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

async function publicar(spec: BusinessAgentSpec, tenantId: string) {
  const registryStore = createInMemoryBusinessAgentRegistryStore();
  const draft = await compileAndCreateDraftVersion({ store: registryStore }, { tenantId, spec });
  assert.ok(draft.ok, `draft: ${JSON.stringify(draft)}`);
  if (!draft.ok) throw new Error("unreachable");
  assert.equal(draft.validationStatus, "validated", JSON.stringify(draft.diagnostics));
  const pub = await publishBusinessAgentVersion({ store: registryStore }, { tenantId, flowId: draft.flowId, flowVersionId: draft.flowVersionId });
  assert.ok(pub.ok, JSON.stringify(pub));
  const version = await registryStore.resolvePublishedVersion(tenantId, draft.flowId);
  assert.ok(version);
  return { registryStore, flowId: draft.flowId, version: version! };
}

/** Un mundo de test: registry + store del orquestador (compartido entre tenants) + calendario/Nylas fake. */
async function mundo() {
  const orchStore = createInMemoryOrchestratorStore();
  const calendarStore = createInMemoryCalendarStore();
  const eventos: NylasCreateEventParams[] = [];
  const recordados: Array<Record<string, unknown>> = [];
  const mensajes: string[] = [];
  const acciones: EffectDispatchRequest[] = [];
  let respuestaIA: (req: EffectDispatchRequest) => Record<string, unknown> = () => ({ responseText: "ok" });

  // Eventos que el calendario REAL ya tiene (ocupan horario). Configurable por test.
  let ocupados: NylasEvent[] = [];
  // Pausas del chat que el runtime REAL pide (transferencia a humano): el webhook las consulta y la IA guarda silencio.
  const pausas: Array<{ phoneNumberId: string; telefonoCliente: string; duracionMs: number }> = [];
  const lector: NylasEventsClient = { async listEvents() { return ocupados; } };
  const escritor: NylasEventsWriteClient = { async createEvent(p) { eventos.push(p); return { id: `evt-${eventos.length}` }; }, async deleteEvent() {} };
  const ejecutorReal = new InternalActionExecutor({
    supabase: supabaseIdempotencia(),
    authorizer: AUTHORIZER,
    guardarLeadEnterprise: async () => ({ ok: false }) as never,
    activarPausaChat: async (_s, phoneNumberId, telefonoCliente, duracionMs) => { pausas.push({ phoneNumberId, telefonoCliente, duracionMs }); return { ok: true } as never; },
    verificarDisponibilidad: async () => ({ disponible: false }) as never,
    sugerirHorariosLibres: async () => [] as never,
    crearCita: async () => ({ ok: false }) as never,
    readPausaUntil: async () => (pausas.length > 0 ? new Date(Date.now() + pausas[pausas.length - 1]!.duracionMs).toISOString() : null),
    consultarDisponibilidadEspecialista: async () => ({ disponible: false }) as never,
    validarServicioEspecialista: async () => ({ ok: false }) as never,
    agendarCitaEspecialista: async () => ({ ok: false }) as never,
    cancelarCitaEspecialista: async () => ({ ok: false }) as never,
    consultarCitasActivasEspecialista: async () => ({ ok: false }) as never,
    moverCitaEspecialista: async () => ({ ok: false }) as never,
    listarHorariosDisponiblesEspecialista: async () => ({ ok: false }) as never,
    listarCatalogoServiciosReal: async () => [],
    resolveNylasApiKeyFromEnv: () => "api-key-fake",
    createNylasEventsClient: () => lector,
    createNylasEventsWriteClient: () => escritor,
    createBusinessAgentCalendarStore: () => calendarStore,
    recordarNombreCliente: async (_s, p) => { recordados.push(p as unknown as Record<string, unknown>); },
    // Reloj fijo: jueves 2030-03-14 (hora Colombia) => "el sábado" = 2030-03-16, sin depender de la fecha real.
    now: () => new Date("2030-03-14T15:00:00Z"),
  });
  // Espía sobre el executor real: registra la acción tal como llega (payload + params estáticos).
  const accionEspiada: EffectExecutor = {
    kind: "action",
    version: "espia",
    capabilities: ejecutorReal.capabilities,
    dispatch: (req, ctx, signal) => {
      acciones.push(req);
      return ejecutorReal.dispatch(req, ctx, signal);
    },
  };
  const ia: EffectExecutor = {
    kind: "ai",
    version: "stub",
    capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
    dispatch: async (req) => {
      // R7: el flujo nylas consulta disponibilidad REAL (solo lectura) antes de reservar; el stub la propone siempre.
      const propia = respuestaIA(req);
      const data = req.nodeId === "ai-avail-propose" && !(propia as { actionProposal?: unknown }).actionProposal ? PROPUESTA_DISPONIBILIDAD : propia;
      return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
    },
  };
  const envio: EffectExecutor = {
    kind: "send_message",
    version: "stub",
    capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
    dispatch: async (req) => {
      const t = (req as { message?: { content?: { text?: string } } }).message?.content?.text;
      if (t) mensajes.push(t);
      return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data: {}, appliedResult: {} };
    },
  };
  const framework = createTestEffectExecutorFramework({
    executors: [ia, accionEspiada, envio],
    integrationResolver: new IntegrationResolver({ getIntegrationById: async () => null, getIntegrationCredentials: async () => [] }),
  });
  const orquestador = createExecutionOrchestrator({ store: orchStore, engine: { createFlowEngineState, runFlowEngine }, effectFramework: framework });

  async function activar(spec: BusinessAgentSpec, tenantId: string) {
    const s = await publicar(spec, tenantId);
    orchStore.publishFlow({ tenantId, flowId: s.flowId, definition: s.version.flow });
    const seen = new Set<string>();
    let llamadasOrquestador = 0;
    const spy = { process: (e: NormalizedFlowEvent) => { llamadasOrquestador += 1; return orquestador.process(e); } };
    return {
      flowId: s.flowId,
      orquestadorLlamado: () => llamadasOrquestador,
      turno: (texto: string, wamid: string) =>
        atenderMensajeConBusinessAgent({
          supabase: {} as never,
          cliente: cliente(s.flowId, tenantId),
          telefonoCliente: TELEFONO,
          texto,
          wamid,
          resolver: createSupabaseBusinessAgentResolver({ store: s.registryStore }),
          classifier: stubClassifier,
          overrides: {
            orchestrator: spy,
            store: orchStore,
            gateSink: { async sendMessage() {}, async transferHuman() {} },
            idempotency: { async claim(_t, w) { return seen.has(w) ? false : (seen.add(w), true); } },
          },
        }),
    };
  }
  return {
    orchStore, calendarStore, eventos, recordados, mensajes, acciones,
    accionesDe: (nodeId: string) => acciones.filter((r) => r.nodeId === nodeId),
    ocupar: (evts: NylasEvent[]) => { ocupados = evts; },
    pausas,
    setIA: (fn: typeof respuestaIA) => { respuestaIA = fn; },
    activar,
    conectarCalendario: (tenantId: string) =>
      calendarStore.saveConnection({
        tenantId, provider: "nylas", grantId: `grant-${tenantId}`, accountEmail: "n@x.com", status: "connected",
        selectedCalendarId: `cal-${tenantId}`, selectedCalendarName: "P", connectedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ejecucion: (tenantId: string) => orchStore.listExecutions(tenantId)[0]!,
  };
}

const PROPUESTA_DISPONIBILIDAD = { actionProposal: { actionType: "buscar_disponibilidad_nylas_generico", arguments: { fecha: "2030-03-16", servicio: "Corte" } } };
const PROPUESTA = { actionProposal: { actionType: "crear_cita_nylas_generico", arguments: { fecha: "2030-03-16", hora: "15:00", servicio: "Corte" } } };
const FIELDS_FULL = [NOMBRE, TEL, CORREO, EDAD, MOTIVO];

describe("R3 — E2E cadena completa: configurar datos -> WhatsApp (offline) -> reserva con datos", () => {
  it("1. faltan datos => el agente PREGUNTA (sin LLM, sin tools); dato inválido => re-pregunta; completos => continúa hasta la reserva real", async () => {
    const m = await mundo();
    await m.conectarCalendario(TENANT_A);
    m.setIA((req) =>
      req.nodeId === "ai-book-propose"
        ? PROPUESTA
        : req.nodeId === "ai-avail-present"
          ? // Respuesta REALISTA: enumera los horarios que devolvió el BACKEND (pasa por el filtro de afirmaciones real).
            { responseText: `Para el sábado tengo disponibilidad a las ${(req.payload.horariosDisponibles as string[]).join(", ")}. ¿Cuál te sirve?` }
          : { responseText: "Listo, tu cita quedó reservada." },
    );
    const a = await m.activar(agenteNylas(FIELDS_FULL), TENANT_A);

    await a.turno("Hola", "w1");
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-need");
    await a.turno("Quiero una cita de uñas para mañana", "w2");
    // Falta el nombre: el AGENTE lo pregunta (determinista), no la IA.
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-data:nombreCliente");
    assert.ok(m.mensajes.includes("¿Cuál es tu nombre?"));
    assert.equal(m.acciones.length, 0, "ninguna tool antes de tener los datos");

    await a.turno("Ana Pérez", "w3");
    // Correo es OPCIONAL: se ofrece con botones (nunca se exige).
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "btn-data:correoCliente");
    await a.turno("no", "w4"); // omitir
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-data:edad");

    await a.turno("veinte", "w5"); // inválido (número)
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-data:edad", "sigue esperando: el motor valida, no la IA");
    assert.ok(m.mensajes.some((t) => /número válido/i.test(t)));
    await a.turno("30", "w6");
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-data:motivo");
    await a.turno("cejas", "w7"); // fuera de la lista
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-data:motivo");
    await a.turno("retoque", "w8");
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-booking-when", "datos completos => continúa");
    assert.equal(m.eventos.length, 0, "aún no hay reserva");

    await a.turno("El sábado", "w9");
    // R7: primero se consulta la disponibilidad REAL (solo lectura) y el cliente elige horario.
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-booking-pick", "ofrece horarios reales y espera la elección");
    assert.equal(m.eventos.length, 0, "consultar disponibilidad NO reserva");
    assert.equal(m.accionesDe("act-avail").length, 1);
    // "tengo disponibilidad ..." solo pasa el filtro de afirmaciones porque la consulta REAL otorgó appointment.available.
    const ofrecidos = m.mensajes.find((t) => /tengo disponibilidad/.test(t));
    assert.ok(ofrecidos && /08:00, 08:30/.test(ofrecidos), "el cliente RECIBE los horarios reales calculados por el backend: " + String(ofrecidos));
    await a.turno("A las 3pm", "w10");
    // La acción REAL corrió: evento creado con los datos validados y normalizados.
    assert.equal(m.eventos.length, 1);
    const ev = m.eventos[0]!;
    assert.equal(ev.title, "Corte -- Ana Pérez");
    assert.equal(ev.description, `Nombre: Ana Pérez\nTeléfono: ${TELEFONO}\nEdad: 30\nMotivo: Retoque`);
    assert.equal(ev.grantId, `grant-${TENANT_A}`);
    assert.equal(ev.calendarId, `cal-${TENANT_A}`);
    // El runtime recibió la configuración ESTÁTICA y los datos capturados.
    const act = m.acciones.find((r) => r.nodeId === "act-book")!;
    assert.ok((act.action as { params?: Record<string, string> }).params?.customerFieldsJson);
    assert.equal(act.payload.nombreCliente, "Ana Pérez");
    assert.equal(act.payload.edad, 30);
    assert.equal(act.payload.motivo, "retoque");
    assert.equal(act.payload.correoCliente, undefined, "el correo se omitió");
    // El nombre real quedó en el contacto (solo lo del cliente).
    assert.equal(m.recordados.length, 1);
    assert.equal(m.recordados[0]!.nombre, "Ana Pérez");
  });

  it("2. persistencia en el contacto: solo los datos del CLIENTE (custom_fields); el motivo de la reserva NO", async () => {
    const m = await mundo();
    await m.conectarCalendario(TENANT_A);
    const a = await m.activar(agenteNylas(FIELDS_FULL), TENANT_A);
    for (const [i, t] of ["Hola", "Quiero cita", "Ana Pérez", "no", "30", "retoque"].entries()) await a.turno(t, `p${i}`);
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-booking-when");
    const cf = m.orchStore.getContactCustomFields(TENANT_A, CONV);
    assert.deepEqual(cf, { nombreCliente: "Ana Pérez", edad: 30 });
    assert.equal("motivo" in (cf ?? {}), false, "dato de la reserva: nunca en el contacto");
  });

  it("3. cliente CONOCIDO: no se le vuelve a preguntar lo que ya se sabe (evita preguntas redundantes)", async () => {
    const m = await mundo();
    await m.conectarCalendario(TENANT_A);
    m.orchStore.seedContact(TENANT_A, CONV, { nombreCliente: "Ana Pérez", edad: 30 });
    const a = await m.activar(agenteNylas(FIELDS_FULL), TENANT_A);
    await a.turno("Hola", "k1");
    await a.turno("Quiero una cita", "k2");
    // nombre y edad ya conocidos: salta directo al correo opcional
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "btn-data:correoCliente");
    assert.equal(m.mensajes.includes("¿Cuál es tu nombre?"), false);
    await a.turno("no", "k3");
    // el motivo es de ESTA reserva: siempre se pregunta
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-data:motivo");
    assert.ok(m.mensajes.some((t) => t.startsWith("¿Hay algo") || /Motivo/.test(t)));
  });

  it("4. opcional aceptado: 'Sí' => pregunta con validación real de correo y lo guarda en el contacto", async () => {
    const m = await mundo();
    const a = await m.activar(agenteNylas([NOMBRE, TEL, CORREO]), TENANT_A);
    for (const [i, t] of ["Hola", "Quiero cita", "Ana"].entries()) await a.turno(t, `o${i}`);
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "btn-data:correoCliente");
    await a.turno("sí", "o3");
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-data:correoCliente");
    await a.turno("basura", "o4");
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-data:correoCliente", "correo inválido: re-pregunta");
    await a.turno("ana@correo.com", "o5");
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-booking-when");
    assert.deepEqual(m.orchStore.getContactCustomFields(TENANT_A, CONV), { nombreCliente: "Ana", correoCliente: "ana@correo.com" });
  });

  it("5. defensa en profundidad: si un requerido llega vacío a la ACCIÓN (p.ej. flujo alterado), el backend NO reserva", async () => {
    const m = await mundo();
    await m.conectarCalendario(TENANT_A);
    m.setIA((req) => (req.nodeId === "ai-book-propose" ? PROPUESTA : { responseText: "no se pudo" }));
    // Contacto sembrado con un nombre EN BLANCO: el motor lo considera "existente"? No ("" no existe) -> lo pregunta.
    // Se fuerza el caso: nombre presente pero edad ausente en el contacto Y saltada por una variable inválida.
    m.orchStore.seedContact(TENANT_A, CONV, { nombreCliente: "Ana", edad: "no-es-numero" });
    const a = await m.activar(agenteNylas([NOMBRE, TEL, EDAD]), TENANT_A);
    await a.turno("Hola", "d1");
    await a.turno("Quiero cita", "d2"); // ambos "existen" => no se preguntan => llega a q-booking-when con edad inválida
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-booking-when");
    await a.turno("sábado", "d3");
    await a.turno("3pm", "d3b");
    assert.equal(m.eventos.length, 0, "el backend rechazó: edad requerida e inválida => NO se toca el calendario");
    const act = m.acciones.find((r) => r.nodeId === "act-book");
    assert.ok(act, "la acción sí se intentó (autorizada) pero el backend la rechazó");
  });

  it("6. tenant isolation: el contacto/datos de un tenant NUNCA se siembran ni se guardan en otro", async () => {
    const m = await mundo();
    m.orchStore.seedContact(TENANT_B, CONV, { nombreCliente: "Persona de B", edad: 55 });
    const a = await m.activar(agenteNylas([NOMBRE, TEL, EDAD]), TENANT_A);
    await a.turno("Hola", "t1");
    await a.turno("Quiero cita", "t2");
    // A no conoce a esta persona: pregunta el nombre (no usa el contacto de B).
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-data:nombreCliente");
    await a.turno("Ana de A", "t3");
    await a.turno("30", "t4");
    assert.deepEqual(m.orchStore.getContactCustomFields(TENANT_A, CONV), { nombreCliente: "Ana de A", edad: 30 });
    assert.deepEqual(m.orchStore.getContactCustomFields(TENANT_B, CONV), { nombreCliente: "Persona de B", edad: 55 }, "el contacto de B no cambió");
  });

  it("7. calendario y datos por tenant: dos tenants reservan cada uno en SU calendario con SUS datos", async () => {
    const m = await mundo();
    await m.conectarCalendario(TENANT_A);
    await m.conectarCalendario(TENANT_B);
    m.setIA((req) => (req.nodeId === "ai-book-propose" ? PROPUESTA : { responseText: "ok" }));
    const a = await m.activar(agenteNylas([NOMBRE, TEL]), TENANT_A);
    const b = await m.activar(agenteNylas([NOMBRE, TEL]), TENANT_B);
    for (const [i, t] of ["Hola", "cita", "Ana A", "sábado", "3pm"].entries()) await a.turno(t, `ta${i}`);
    for (const [i, t] of ["Hola", "cita", "Beto B", "sábado", "3pm"].entries()) await b.turno(t, `tb${i}`);
    assert.equal(m.eventos.length, 2);
    assert.deepEqual(m.eventos.map((e) => [e.grantId, e.title]), [[`grant-${TENANT_A}`, "Corte -- Ana A"], [`grant-${TENANT_B}`, "Corte -- Beto B"]]);
  });

  it("8. agente ANTIGUO (sin datos configurados) sigue funcionando igual: va directo a la reserva y usa nombre del proposal", async () => {
    const m = await mundo();
    await m.conectarCalendario(TENANT_A);
    m.setIA((req) =>
      req.nodeId === "ai-book-propose"
        ? { actionProposal: { actionType: "crear_cita_nylas_generico", arguments: { fecha: "2030-03-16", hora: "15:00", servicio: "Corte", nombreCliente: "Luis" } } }
        : { responseText: "ok" },
    );
    const a = await m.activar(agenteNylas(), TENANT_A);
    await a.turno("Hola", "a1");
    await a.turno("Quiero una cita", "a2");
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-booking-when", "sin datos configurados no hay preguntas de captura");
    await a.turno("sábado", "a3");
    await a.turno("3pm", "a4");
    assert.equal(m.eventos.length, 1);
    assert.equal(m.eventos[0]!.title, "Corte -- Luis");
  });

  it("9. idempotencia end-to-end: el MISMO mensaje de WhatsApp (mismo wamid) reenviado no duplica preguntas ni la reserva", async () => {
    const m = await mundo();
    await m.conectarCalendario(TENANT_A);
    m.setIA((req) => (req.nodeId === "ai-book-propose" ? PROPUESTA : { responseText: "ok" }));
    const a = await m.activar(agenteNylas([NOMBRE, TEL]), TENANT_A);
    await a.turno("Hola", "i1");
    await a.turno("cita", "i2");
    await a.turno("Ana", "i3");
    const antes = a.orquestadorLlamado();
    await a.turno("Ana", "i3"); // reintento de Meta (mismo wamid)
    assert.equal(a.orquestadorLlamado(), antes, "el reintento no llega al orquestador");
    await a.turno("sábado", "i4");
    await a.turno("sábado", "i4"); // reintento de Meta
    await a.turno("3pm", "i5");
    await a.turno("3pm", "i5"); // reintento de Meta
    assert.equal(m.accionesDe("act-avail").length, 1, "una sola consulta de disponibilidad");
    assert.equal(m.eventos.length, 1, "una sola reserva");
  });

  it("10. R7: SIN calendario conectado la consulta FALLA (no concede evidencia): la IA no se invoca para presentar, no se afirma disponibilidad y el cliente no queda en silencio", async () => {
    const m = await mundo();
    // (no se conecta el calendario del tenant)
    m.setIA((req) =>
      req.nodeId === "ai-avail-present"
        ? { responseText: "Para el sábado tengo disponibilidad a las 8:00, 8:30 y 9:00. ¿Cuál te sirve?" } // alucinación: el backend no devolvió nada
        : { responseText: "ok" },
    );
    const a = await m.activar(agenteNylas([NOMBRE, TEL]), TENANT_A);
    for (const [i, t] of ["Hola", "cita", "Ana", "sábado"].entries()) await a.turno(t, `n${i}`);
    assert.equal(m.accionesDe("act-avail").length, 1, "la consulta se intentó");
    assert.equal(m.mensajes.some((t) => /tengo disponibilidad/.test(t)), false, "nadie pudo afirmar disponibilidad que el backend no verificó");
    assert.ok(m.mensajes.some((t) => /No pude mostrarte opciones para ese día/.test(t)), "mensaje seguro en lugar de silencio");
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-booking-pick", "el cliente puede indicar su hora; la creación revalida todo");
    assert.equal(m.eventos.length, 0);
  });

  it("11. R7: agenda LLENA ese día (evento real de día completo) => sin horarios, sin afirmaciones de disponibilidad, y NO se reserva", async () => {
    const m = await mundo();
    await m.conectarCalendario(TENANT_A);
    m.ocupar([{ id: "bloqueo", when: { object: "datespan", start_date: "2030-03-16", end_date: "2030-03-16" } } as NylasEvent]);
    m.setIA((req) =>
      req.nodeId === "ai-avail-present"
        ? { responseText: "Tengo disponibilidad a las 8:00 ese día. ¿Cuál te sirve?" }
        : req.nodeId === "ai-book-propose"
          ? { actionProposal: { actionType: "crear_cita_nylas_generico", arguments: { fecha: "2030-03-16", hora: "10:00", servicio: "Corte" } } }
          : { responseText: "no se pudo" },
    );
    const a = await m.activar(agenteNylas([NOMBRE, TEL]), TENANT_A);
    for (const [i, t] of ["Hola", "cita", "Ana", "sábado"].entries()) await a.turno(t, `f${i}`);
    assert.equal(m.mensajes.some((t) => /tengo disponibilidad/.test(t)), false);
    assert.ok(m.mensajes.some((t) => /No pude mostrarte opciones/.test(t)));
    // Aunque el cliente insista con una hora, la CREACIÓN revalida contra el calendario real: conflicto => NO hay evento.
    await a.turno("a las 10", "f4");
    assert.equal(m.eventos.length, 0, "no se crea evento sobre un bloqueo real");
  });

  it("12. R7: con la agenda parcialmente ocupada, los horarios ofrecidos EXCLUYEN el bloque ocupado y respetan la duración; elegir un horario ocupado NO reserva", async () => {
    const m = await mundo();
    await m.conectarCalendario(TENANT_A);
    // 08:00–10:00 (hora Colombia) ocupado el 2030-03-16.
    const ini = Math.floor(new Date("2030-03-16T08:00:00-05:00").getTime() / 1000);
    m.ocupar([{ id: "ocupado", when: { object: "timespan", start_time: ini, end_time: ini + 2 * 3600 } } as NylasEvent]);
    m.setIA((req) =>
      req.nodeId === "ai-avail-present"
        ? { responseText: `Para el sábado tengo disponibilidad a las ${(req.payload.horariosDisponibles as string[]).join(", ")}. ¿Cuál te sirve?` }
        : req.nodeId === "ai-book-propose"
          ? { actionProposal: { actionType: "crear_cita_nylas_generico", arguments: { fecha: "2030-03-16", hora: "09:00", servicio: "Corte" } } }
          : { responseText: "no se pudo" },
    );
    const a = await m.activar(agenteNylas([NOMBRE, TEL]), TENANT_A);
    for (const [i, t] of ["Hola", "cita", "Ana", "sábado"].entries()) await a.turno(t, `p${i}`);
    const ofrecidos = m.mensajes.find((t) => /tengo disponibilidad/.test(t)) ?? "";
    assert.match(ofrecidos, /10:00/, "ofrece desde que el calendario real queda libre");
    assert.doesNotMatch(ofrecidos, /08:00|08:30|09:00|09:30/, "NO ofrece horarios que se solapan con el evento real: " + ofrecidos);
    // El cliente pide un horario ocupado: el backend lo rechaza (conflicto real) -> no hay evento.
    await a.turno("a las 9", "p4");
    assert.equal(m.eventos.length, 0, "conflicto detectado: nada se reserva sobre un evento real");
  });

  it("13. R5: si la RESERVA falla y el agente tiene 'Transferir a un humano', la transferencia es REAL: avisa, PAUSA el chat (la IA calla) y la ejecución termina — no solo promete", async () => {
    const m = await mundo();
    // Sin calendario conectado: la creación no puede completarse (rama de fallo crítica).
    m.setIA((req) => (req.nodeId === "ai-book-propose" ? PROPUESTA : { responseText: "ok" }));
    const a = await m.activar(agenteNylas([NOMBRE, TEL]), TENANT_A);
    for (const [i, t] of ["Hola", "cita", "Ana", "sábado", "a las 3"].entries()) await a.turno(t, `h${i}`);
    assert.equal(m.eventos.length, 0, "no se reservó nada");
    assert.ok(m.mensajes.some((t) => /Te comunico con una persona del equipo/.test(t)), "el cliente recibe el aviso (pasa el filtro de afirmaciones real)");
    // El efecto REAL: pausa del chat de ESTA conversación, con las horas configuradas (24 = defaultPauseHours del Spec).
    assert.equal(m.pausas.length, 1);
    assert.deepEqual(m.pausas[0], { phoneNumberId: PHONE_NUMBER_ID, telefonoCliente: TELEFONO, duracionMs: 24 * 3600 * 1000 });
    const xfer = m.accionesDe("act-handoff-book");
    assert.equal(xfer.length, 1);
    assert.equal(xfer[0]!.tenantId, TENANT_A, "el tenant sale del contexto confiable");
    assert.equal(m.ejecucion(TENANT_A).status, "completed", "la ejecución terminó: el bot ya no conduce esta conversación");
    // La IA NUNCA pudo proponer la transferencia: la acción es un nodo determinista.
    assert.equal(m.acciones.some((r) => r.nodeId !== "act-handoff-book" && (r.action as { actionType?: string }).actionType === "transferir_soporte"), false);
  });

  it("14. R5: SIN capacidad de transferencia el fallo de reserva NO pausa el chat (agentes existentes intactos)", async () => {
    const m = await mundo();
    m.setIA((req) => (req.nodeId === "ai-book-propose" ? PROPUESTA : { responseText: "ok" }));
    const spec = agenteNylas([NOMBRE, TEL]);
    const a = await m.activar({ ...spec, capabilities: { ...spec.capabilities, humanHandoff: false }, handoff: { rules: [], defaultPauseHours: 24 } }, TENANT_A);
    for (const [i, t] of ["Hola", "cita", "Ana", "sábado", "a las 3"].entries()) await a.turno(t, `s${i}`);
    assert.equal(m.pausas.length, 0);
    assert.equal(m.accionesDe("act-handoff-book").length, 0);
  });

  it("15. R7: la IA propone una fecha ADIVINADA de otro año (no conoce 'hoy'): el backend usa la que dijo el cliente ('el sábado' = 2030-03-16) tanto al consultar como al reservar", async () => {
    const m = await mundo();
    await m.conectarCalendario(TENANT_A);
    // Bloqueo real el 2030-03-16 08:00–10:00: si se usara la fecha adivinada (2024-05-04) NO se vería.
    const ini = Math.floor(new Date("2030-03-16T08:00:00-05:00").getTime() / 1000);
    m.ocupar([{ id: "ocupado", when: { object: "timespan", start_time: ini, end_time: ini + 2 * 3600 } } as NylasEvent]);
    m.setIA((req) =>
      req.nodeId === "ai-avail-propose"
        ? { actionProposal: { actionType: "buscar_disponibilidad_nylas_generico", arguments: { fecha: "2024-05-04", servicio: "Corte" } } }
        : req.nodeId === "ai-avail-present"
          ? { responseText: `Para el sábado tengo disponibilidad a las ${(req.payload.horariosDisponibles as string[]).join(", ")}. ¿Cuál te sirve?` }
          : req.nodeId === "ai-book-propose"
            ? { actionProposal: { actionType: "crear_cita_nylas_generico", arguments: { fecha: "2024-05-04", hora: "10:00", servicio: "Corte" } } }
            : { responseText: "ok" },
    );
    const a = await m.activar(agenteNylas([NOMBRE, TEL]), TENANT_A);
    for (const [i, t] of ["Hola", "cita", "Ana", "sábado"].entries()) await a.turno(t, `r${i}`);
    const ofrecidos = m.mensajes.find((t) => /tengo disponibilidad/.test(t)) ?? "";
    assert.match(ofrecidos, /10:00/, "consultó el 2030-03-16 (la fecha del cliente), no la del modelo: " + ofrecidos);
    assert.doesNotMatch(ofrecidos, /08:00/, "y respeta el evento real de ESE día");
    await a.turno("a las 10", "r4");
    assert.equal(m.eventos.length, 1, "se reservó");
    const fechaEvento = new Date(m.eventos[0]!.startUnix * 1000).toISOString();
    assert.match(fechaEvento, /^2030-03-16T15:00:00/, "en la fecha del CLIENTE (10:00 Colombia = 15:00Z), no en 2024: " + fechaEvento);
  });

  it("16. R7: fecha pasada solo por la IA (el cliente no dijo un día reconocible) => NO se reserva nada", async () => {
    const m = await mundo();
    await m.conectarCalendario(TENANT_A);
    m.setIA((req) => (req.nodeId === "ai-book-propose" ? { actionProposal: { actionType: "crear_cita_nylas_generico", arguments: { fecha: "2024-05-04", hora: "10:00", servicio: "Corte" } } } : { responseText: "ok" }));
    const a = await m.activar(agenteNylas([NOMBRE, TEL]), TENANT_A);
    for (const [i, t] of ["Hola", "cita", "Ana", "cuando puedas", "a las 10"].entries()) await a.turno(t, `q${i}`);
    assert.equal(m.eventos.length, 0, "una fecha pasada nunca llega al calendario");
    assert.ok(m.accionesDe("act-book").length >= 1, "la acción se intentó y el backend la rechazó");
  });
});
