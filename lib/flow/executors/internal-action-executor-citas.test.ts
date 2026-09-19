/**
 * R7 — contrato del InternalActionExecutor para listar/cancelar/reprogramar citas del cliente. Solo esta capa
 * (el adaptador): la identidad sale de request.conversation (NUNCA del payload), el tenant de la solicitud, la política
 * es un param ESTÁTICO que el payload no puede alterar, la lista de citas del payload no es una autoridad (se re-verifica),
 * y el éxito de las acciones críticas solo ocurre cuando el hecho es real (el orquestador concede la evidencia a todo success).
 * La lógica de negocio se prueba a fondo en calendar/nylas-appointments.test.ts y la cadena en e2e/appointments-e2e.test.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalActionExecutor } from "@/lib/flow/executors/internal-action-executor";
import type { InternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchRequest } from "@/lib/flow/executor-types";
import { createInMemoryAppointmentStore } from "@/lib/agent-compiler/calendar/appointment-store";
import { createInMemoryCalendarStore } from "@/lib/agent-compiler/calendar/testing/in-memory-calendar-store";
import type { NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const CONV = { phoneNumberId: "pn-1", telefonoCliente: "573001112233" };
const OTRO = "573009998877";
const AUTHORIZER: InternalActionAuthorizer = { assertActivacionOwnedByTenant: async () => true, assertPhoneNumberOwnedByTenant: async () => true };
const AHORA = new Date("2030-03-14T15:00:00Z");

async function armar() {
  const calendar = createInMemoryCalendarStore();
  await calendar.saveConnection({ tenantId: TENANT_A, provider: "nylas", grantId: "g", accountEmail: "a@x.com", status: "connected", selectedCalendarId: "cal", selectedCalendarName: "P", connectedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  const appts = createInMemoryAppointmentStore();
  await appts.record({ tenantId: TENANT_A, telefonoCliente: CONV.telefonoCliente, calendarId: "cal", eventId: "evt-1", servicio: "Corte", inicioIso: "2030-03-16T15:00:00.000Z", finIso: "2030-03-16T15:45:00.000Z" });
  const borrados: string[] = [];
  const lector: NylasEventsClient = { async listEvents() { return []; } };
  const escritor: NylasEventsWriteClient = { async createEvent() { return { id: "x" }; }, async deleteEvent(p) { borrados.push(p.eventId); } };
  const executor = new InternalActionExecutor({
    supabase: {} as SupabaseClient,
    authorizer: AUTHORIZER,
    guardarLeadEnterprise: async () => ({ ok: false }) as never,
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
    resolveNylasApiKeyFromEnv: () => "api-key-fake",
    createNylasEventsClient: () => lector,
    createNylasEventsWriteClient: () => escritor,
    createBusinessAgentCalendarStore: () => calendar,
    createAppointmentStore: () => appts,
    now: () => AHORA,
  });
  return { executor, appts, borrados };
}

function request(actionType: string, params: Record<string, string> | undefined, payload: Record<string, unknown>, over: Partial<EffectDispatchRequest> = {}): EffectDispatchRequest {
  return {
    effectId: "eff-1", executionRowId: "exec-1", tenantId: TENANT_A, nodeId: "ap-c-act", attempt: 1, kind: "action",
    action: { actionType, ...(params ? { params } : {}) },
    payload, conversation: CONV, ...over,
  } as EffectDispatchRequest;
}
const CTX = { tenantId: TENANT_A, internal: true };
const POLITICA = { cancelAllowed: "true", cancelMinNoticeHours: "24" };

async function listar(x: Awaited<ReturnType<typeof armar>>) {
  const r = await x.executor.dispatch(request("listar_citas_cliente", POLITICA, {}), CTX);
  return { r, citas: ((r.data as { citasCliente?: Array<{ id: string }> } | undefined)?.citasCliente ?? []) };
}

describe("listar_citas_cliente (executor)", () => {
  it("1. lista SOLO las citas del teléfono de la conversación; éxito con >=1 cita (READ)", async () => {
    const x = await armar();
    const { r, citas } = await listar(x);
    assert.equal(r.success, true, JSON.stringify(r));
    assert.equal(citas.length, 1);
    assert.equal((r.data as Record<string, unknown>).cantidadCitas, 1);
    assert.equal((r.metadata as { operationClass: string }).operationClass, "READ");
  });

  it("2. SEGURIDAD: 'telefonoCliente'/'tenantId' en el payload se IGNORAN (identidad = conversación, tenant = solicitud)", async () => {
    const x = await armar();
    // Un atacante intenta ver las citas de otro número / de otro tenant desde variables del flow.
    const r = await x.executor.dispatch(request("listar_citas_cliente", POLITICA, { telefonoCliente: "573000000000", tenantId: TENANT_B }, { conversation: { phoneNumberId: "pn-1", telefonoCliente: OTRO } }), CTX);
    assert.equal(r.success, false, "OTRO no tiene citas: nunca ve las de CONV pese al payload");
    assert.equal(r.error, "citas_no_disponibles:sin_citas");
  });

  it("3. sin citas => success:false (el orquestador concede evidencia a todo success:true: NUNCA se afirma una cita que no existe)", async () => {
    const x = await armar();
    const r = await x.executor.dispatch(request("listar_citas_cliente", POLITICA, {}, { tenantId: TENANT_B }), { tenantId: TENANT_B, internal: true });
    assert.equal(r.success, false);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
  });

  it("4. sin conversación => VALIDATION_ERROR (no hay identidad de canal)", async () => {
    const x = await armar();
    const r = await x.executor.dispatch(request("listar_citas_cliente", POLITICA, {}, { conversation: undefined }), CTX);
    assert.equal(r.success, false);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR);
  });
});

describe("cancelar_cita_cliente (executor)", () => {
  it("5. cancela la cita elegida: éxito con cancelada:true (evidencia real) y borra el evento", async () => {
    const x = await armar();
    const { citas } = await listar(x);
    const r = await x.executor.dispatch(request("cancelar_cita_cliente", POLITICA, { citasCliente: citas, cita_pick: "1" }), CTX);
    assert.equal(r.success, true, JSON.stringify(r));
    assert.equal((r.data as Record<string, unknown>).cancelada, true);
    assert.deepEqual(x.borrados, ["evt-1"]);
    assert.equal((r.metadata as { operationClass: string }).operationClass, "CRITICAL");
  });

  it("6. SEGURIDAD: una lista FORJADA con la cita de otra persona NO cancela nada (se re-verifica por teléfono del canal)", async () => {
    const x = await armar();
    const { citas } = await listar(x); // ids reales de CONV
    const r = await x.executor.dispatch(request("cancelar_cita_cliente", POLITICA, { citasCliente: citas, cita_pick: "1" }, { conversation: { phoneNumberId: "pn-1", telefonoCliente: OTRO } }), CTX);
    assert.equal(r.success, false);
    assert.equal(r.error, "cancelacion_rechazada:cita_no_encontrada");
    assert.deepEqual(x.borrados, [], "el calendario NO se tocó");
  });

  it("7. la POLÍTICA es estática: cancelAllowed=false del nodo gana sobre un payload que diga 'true'", async () => {
    const x = await armar();
    const { citas } = await listar(x);
    const r = await x.executor.dispatch(request("cancelar_cita_cliente", { cancelAllowed: "false", cancelMinNoticeHours: "0" }, { citasCliente: citas, cita_pick: "1", cancelAllowed: "true" }), CTX);
    assert.equal(r.success, false);
    assert.equal(r.error, "cancelacion_rechazada:no_permitido");
    assert.deepEqual(x.borrados, []);
  });

  it("8. otro TENANT no puede cancelar (aunque conozca el id)", async () => {
    const x = await armar();
    const { citas } = await listar(x);
    const r = await x.executor.dispatch(request("cancelar_cita_cliente", POLITICA, { citasCliente: citas, cita_pick: "1" }, { tenantId: TENANT_B }), { tenantId: TENANT_B, internal: true });
    assert.equal(r.success, false);
    assert.deepEqual(x.borrados, []);
  });

  it("9. un payload sin lista o con selección inválida => NON_RETRYABLE, sin tocar nada", async () => {
    const x = await armar();
    const { citas } = await listar(x);
    for (const payload of [{ cita_pick: "1" }, { citasCliente: citas, cita_pick: "no" }, { citasCliente: "no-es-lista", cita_pick: "1" }]) {
      const r = await x.executor.dispatch(request("cancelar_cita_cliente", POLITICA, payload), CTX);
      assert.equal(r.success, false, JSON.stringify(payload));
      assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
    }
    assert.deepEqual(x.borrados, []);
  });
});

describe("reprogramar_cita_cliente (executor)", () => {
  it("10. sin fecha/hora reconocible => rechazo NON_RETRYABLE (nunca se adivina)", async () => {
    const x = await armar();
    const { citas } = await listar(x);
    const r = await x.executor.dispatch(request("reprogramar_cita_cliente", POLITICA, { citasCliente: citas, cita_pick: "1", appointment_request: "cuando puedas" }), CTX);
    assert.equal(r.success, false);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
  });

  it("11. la fecha pasada del cliente se rechaza (la IA no puede 'corregirla' con otra)", async () => {
    const x = await armar();
    const { citas } = await listar(x);
    const r = await x.executor.dispatch(request("reprogramar_cita_cliente", POLITICA, { citasCliente: citas, cita_pick: "1", appointment_request: "13 de marzo", appointment_pick: "10 am", fecha: "2030-03-20", hora: "10:00" }), CTX);
    assert.equal(r.success, false);
    assert.equal(r.error, "reprogramacion_rechazada:fecha_pasada");
  });

  // (el proveedor sin soporte de mover y la idempotencia se prueban en calendar/nylas-appointments.test.ts, que trae el fake de la tabla de idempotencia)
});
