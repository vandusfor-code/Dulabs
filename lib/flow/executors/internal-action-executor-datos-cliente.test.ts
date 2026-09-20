/**
 * R3 — cableado real InternalActionExecutor <-> crear_cita_nylas_generico con
 * DATOS DEL CLIENTE. Prueba SOLO esta capa (el adaptador): que lea la
 * definición ESTÁTICA (customerFieldsJson) y los valores del payload, que
 * falle CERRADO si la definición está corrupta, que clasifique los rechazos y
 * que persista el nombre/correo REALES del contacto solo para datos "customer".
 * La orquestación (validación, idempotencia, calendario) se prueba a fondo en
 * lib/agent-compiler/calendar/nylas-generic-booking*.test.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalActionExecutor } from "@/lib/flow/executors/internal-action-executor";
import type { InternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchRequest } from "@/lib/flow/executor-types";
import { createInMemoryCalendarStore } from "@/lib/agent-compiler/calendar/testing/in-memory-calendar-store";
import type { NylasCreateEventParams, NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";
import type { CustomerField } from "@/lib/agent-compiler/spec/types";
import { toCompiledFields } from "@/lib/customer-data";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CONV = { phoneNumberId: "pn-1", telefonoCliente: "573001112233" };
const AUTHORIZER: InternalActionAuthorizer = { assertActivacionOwnedByTenant: async () => true, assertPhoneNumberOwnedByTenant: async () => true };

type Fila = Record<string, unknown>;
/** Fake Supabase: solo dulabs_idempotencia_reservas. */
function supabaseFalso(): SupabaseClient {
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

const campo = (over: Partial<CustomerField> & Pick<CustomerField, "key" | "type">): CustomerField => ({ label: over.key, required: false, enabled: true, scope: "customer", ...over });
const NOMBRE = campo({ key: "nombreCliente", type: "text", label: "Nombre", required: true });
const CORREO = campo({ key: "correoCliente", type: "email", label: "Correo" });
const MOTIVO = campo({ key: "motivo", type: "text", label: "Motivo", required: true, scope: "booking" });

async function armar(over: { conectado?: boolean } = {}) {
  const store = createInMemoryCalendarStore();
  if (over.conectado !== false) {
    await store.saveConnection({
      tenantId: TENANT, provider: "nylas", grantId: "grant-t", accountEmail: "n@x.com", status: "connected",
      selectedCalendarId: "cal-t", selectedCalendarName: "P", connectedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }
  const creados: NylasCreateEventParams[] = [];
  let lecturas = 0;
  const lector: NylasEventsClient = { async listEvents() { lecturas++; return []; } };
  const escritor: NylasEventsWriteClient = { async createEvent(p) { creados.push(p); return { id: `evt-${creados.length}` }; }, async deleteEvent() {} };
  const recordados: Array<Record<string, unknown>> = [];

  const executor = new InternalActionExecutor({
    supabase: supabaseFalso(),
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
    listarCatalogoServiciosReal: async () => [],
    resolveNylasApiKeyFromEnv: () => "api-key-fake",
    createNylasEventsClient: () => lector,
    createNylasEventsWriteClient: () => escritor,
    createBusinessAgentCalendarStore: () => store,
    recordarNombreCliente: async (_s, p) => { recordados.push(p as unknown as Record<string, unknown>); },
    // Reloj fijo ANTERIOR a FECHA_HORA: una fecha pasada nunca se reserva (R7), y la fecha real de hoy no debe afectar al test.
    now: () => new Date("2026-03-09T15:00:00Z"),
  });
  return { executor, creados, recordados, lecturas: () => lecturas };
}

function request(params: Record<string, string> | undefined, payload: Record<string, unknown>, over: Partial<EffectDispatchRequest> = {}): EffectDispatchRequest {
  return {
    effectId: "eff-1", executionRowId: "exec-1", tenantId: TENANT, nodeId: "act-book", attempt: 1, kind: "action",
    action: { actionType: "crear_cita_nylas_generico", ...(params ? { params } : {}) },
    payload, conversation: CONV, ...over,
  } as EffectDispatchRequest;
}
const CTX = { tenantId: TENANT, internal: true };
// `appointment_pick` = lo que ESCRIBIÓ el cliente al elegir la hora (variable del flow real): la hora "propuesta" por la IA solo se
// acepta si el cliente la respalda (backend = autoridad, ver calendar/hora-solicitada.ts).
const FECHA_HORA = { fecha: "2026-03-10", hora: "14:00", servicio: "Corte", appointment_pick: "a las 2 de la tarde" };

describe("InternalActionExecutor — crear_cita_nylas_generico con datos del cliente (R3)", () => {
  it("1. datos completos: reserva OK, descripción con los datos, y guarda nombre/correo REALES del contacto (solo scope customer)", async () => {
    const { executor, creados, recordados } = await armar();
    const customerFieldsJson = JSON.stringify(toCompiledFields([NOMBRE, CORREO, MOTIVO]));
    const r = await executor.dispatch(
      request({ customerFieldsJson }, { ...FECHA_HORA, nombreCliente: "Ana Pérez", correoCliente: "ana@correo.com", motivo: "Retoque" }),
      CTX,
    );
    assert.equal(r.success, true, JSON.stringify(r));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.SUCCESS);
    assert.equal(creados.length, 1);
    assert.equal(creados[0]!.description, "Nombre: Ana Pérez\nCorreo: ana@correo.com\nMotivo: Retoque");
    assert.equal((r.data as Record<string, unknown>).status, "confirmada");
    // contacto: nombre y correo del cliente; el motivo (de la reserva) NUNCA
    assert.equal(recordados.length, 1);
    assert.deepEqual(recordados[0], { idTenant: TENANT, phoneNumberId: "pn-1", telefonoCliente: "573001112233", nombre: "Ana Pérez", correo: "ana@correo.com" });
  });

  it("2. requerido faltante: NON_RETRYABLE datos_incompletos con las etiquetas faltantes; no toca el calendario ni el contacto", async () => {
    const { executor, creados, recordados, lecturas } = await armar();
    const customerFieldsJson = JSON.stringify(toCompiledFields([NOMBRE, MOTIVO]));
    const r = await executor.dispatch(request({ customerFieldsJson }, { ...FECHA_HORA, nombreCliente: "Ana" }), CTX);
    assert.equal(r.success, false);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
    assert.equal(r.error, "datos_incompletos");
    assert.deepEqual((r.data as { faltantes: string[] }).faltantes, ["Motivo"]);
    assert.equal(creados.length + lecturas() + recordados.length, 0);
  });

  it("3. definición CORRUPTA (customerFieldsJson inválido): falla CERRADO (configuracion_invalida), sin reservar", async () => {
    const { executor, creados, lecturas } = await armar();
    for (const malo of ["{no es json", JSON.stringify({ a: 1 }), JSON.stringify([{ key: "fecha", label: "x", type: "text", required: true, enabled: true, scope: "customer" }])]) {
      const r = await executor.dispatch(request({ customerFieldsJson: malo }, { ...FECHA_HORA, nombreCliente: "Ana" }, { effectId: `e-${malo.length}` }), CTX);
      assert.equal(r.success, false, malo);
      assert.equal(r.error, "configuracion_invalida");
      assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
    }
    assert.equal(creados.length + lecturas(), 0);
  });

  it("4. la IA NO puede alterar la definición: un customerFieldsJson en el payload pierde contra la estática del nodo", async () => {
    const { executor } = await armar();
    const estatica = JSON.stringify(toCompiledFields([NOMBRE, MOTIVO]));
    const engañoIA = JSON.stringify(toCompiledFields([{ ...NOMBRE, required: false }]));
    const r = await executor.dispatch(request({ customerFieldsJson: estatica }, { ...FECHA_HORA, nombreCliente: "Ana", customerFieldsJson: engañoIA }), CTX);
    assert.equal(r.success, false, "el motivo sigue siendo obligatorio: la definición estática ganó");
    assert.equal(r.error, "datos_incompletos");
  });

  it("5. la IA NO puede fijar el teléfono: el del payload se ignora, viaja el del canal", async () => {
    const { executor, creados } = await armar();
    const tel = campo({ key: "telefonoCliente", type: "phone", label: "Teléfono", required: true });
    const r = await executor.dispatch(request({ customerFieldsJson: JSON.stringify(toCompiledFields([NOMBRE, tel])) }, { ...FECHA_HORA, nombreCliente: "Ana", telefonoCliente: "999999999" }), CTX);
    assert.equal(r.success, true, JSON.stringify(r));
    assert.match(creados[0]!.description ?? "", /Teléfono: 573001112233/);
    assert.doesNotMatch(creados[0]!.description ?? "", /999999999/);
  });

  it("6. datos de la RESERVA nunca se guardan en el contacto (nombre en scope booking => no se recuerda)", async () => {
    const { executor, recordados } = await armar();
    const nombreReserva = { ...NOMBRE, scope: "booking" as const };
    const r = await executor.dispatch(request({ customerFieldsJson: JSON.stringify(toCompiledFields([nombreReserva])) }, { ...FECHA_HORA, nombreCliente: "Ana" }), CTX);
    assert.equal(r.success, true);
    assert.equal(recordados.length, 0);
  });

  it("7. sin customerFieldsJson (agente previo a R3): mismo contrato de siempre, sin tocar el contacto", async () => {
    const { executor, creados, recordados } = await armar();
    const r = await executor.dispatch(request(undefined, { ...FECHA_HORA, nombreCliente: "Luis", notas: "trae ref" }), CTX);
    assert.equal(r.success, true);
    assert.equal(creados[0]!.description, "trae ref");
    assert.equal(recordados.length, 0);
  });

  it("8. replay del mismo efecto: NO duplica el evento (idempotencia real) y devuelve el mismo citaId", async () => {
    const { executor, creados } = await armar();
    const customerFieldsJson = JSON.stringify(toCompiledFields([NOMBRE]));
    const req = request({ customerFieldsJson }, { ...FECHA_HORA, nombreCliente: "Ana" });
    const a = await executor.dispatch(req, CTX);
    const b = await executor.dispatch(req, CTX);
    assert.ok(a.success && b.success);
    assert.equal((a.data as { citaId: string }).citaId, (b.data as { citaId: string }).citaId);
    assert.equal(creados.length, 1);
  });

  it("9. calendario no conectado => rechazo NON_RETRYABLE y no se guarda nada del contacto", async () => {
    const { executor, recordados } = await armar({ conectado: false });
    const r = await executor.dispatch(request({ customerFieldsJson: JSON.stringify(toCompiledFields([NOMBRE])) }, { ...FECHA_HORA, nombreCliente: "Ana" }), CTX);
    assert.equal(r.success, false);
    assert.equal(r.error, "calendario_no_conectado");
    assert.equal(recordados.length, 0);
  });
});
