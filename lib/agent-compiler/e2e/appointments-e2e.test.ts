/**
 * R7 — E2E de CADENA COMPLETA: reservar -> (la cita queda registrada) -> cancelar / reprogramar por WhatsApp.
 * Offline (sin red/Supabase):
 *
 *   Spec(scheduling nylas + cancelación) -> compile -> draft validado -> publish -> resolver
 *     -> atenderMensajeConBusinessAgent (boundary real) -> Flow Engine real (router de intención + subgrafos)
 *       -> InternalActionExecutor REAL -> listar/cancelar/reprogramar REALES (nylas-appointments)
 *
 * Fakes: el LLM (solo redacta lo que el BACKEND devolvió), el calendario Nylas (en memoria: crea/borra/mueve eventos
 * de verdad dentro del fake) y el store de citas (en memoria, mismo contrato que el real). Lo demás es código de producción.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EffectDispatchRequest } from "@/lib/flow/executor-types";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { salonSpec } from "@/lib/agent-compiler/runtime/fixtures";
import { createInMemoryAppointmentStore } from "@/lib/agent-compiler/calendar/appointment-store";
import type { NylasEvent, NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";
import { CONV, TELEFONO, TENANT_A, caps, mundo } from "@/lib/agent-compiler/e2e/testing/knowledge-harness";

const HORARIO = { week: Array.from({ length: 7 }, () => ({ closed: false, intervals: [{ open: "08:00", close: "20:00" }] })), exceptions: [] };
const NOMBRE = { key: "nombreCliente", label: "Nombre", type: "text" as const, required: true, enabled: true, scope: "customer" as const };

function agenteCitas(over: Partial<BusinessAgentSpec> = {}, cancelacion = { allowed: true, minNoticeHours: 24 }): BusinessAgentSpec {
  const s = salonSpec();
  return {
    ...s,
    capabilities: caps({ scheduling: true, humanHandoff: true }),
    catalog: { source: "structured", useServices: false, useProducts: false, quoteBeforeQualification: false },
    handoff: { rules: [], defaultPauseHours: 6 },
    scheduling: { ...s.scheduling, provider: "nylas", businessHours: HORARIO, minNoticeMinutes: 60, cancellation: cancelacion },
    customerData: { fields: [NOMBRE] },
    ...over,
  };
}

/** Calendario Nylas FAKE con estado: crear/borrar/mover eventos de verdad dentro del fake. */
function calendarioFake() {
  const eventos = new Map<string, { id: string; startUnix: number; endUnix: number; title: string }>();
  let n = 0;
  const lector: NylasEventsClient = {
    async listEvents() {
      return [...eventos.values()].map((e): NylasEvent => ({ id: e.id, when: { object: "timespan", start_time: e.startUnix, end_time: e.endUnix } }));
    },
  };
  const escritor: NylasEventsWriteClient = {
    async createEvent(p) {
      const id = `evt-${++n}`;
      eventos.set(id, { id, startUnix: p.startUnix, endUnix: p.endUnix, title: p.title });
      return { id };
    },
    async deleteEvent(p) {
      eventos.delete(p.eventId);
    },
    async updateEventTime(p) {
      const e = eventos.get(p.eventId);
      if (e) Object.assign(e, { startUnix: p.startUnix, endUnix: p.endUnix });
    },
  };
  return { eventos, lector, escritor };
}

function ia(req: EffectDispatchRequest): Record<string, unknown> {
  const p = req.payload;
  switch (req.nodeId) {
    case "ai-avail-propose":
    case "ap-r-ai-avail":
      return { actionProposal: { actionType: "buscar_disponibilidad_nylas_generico", arguments: { fecha: "2024-05-04", servicio: "Corte" } } }; // fecha "adivinada": el backend usa la del cliente
    case "ai-avail-present":
    case "ap-r-ai-avail-present":
      return { responseText: `Para ese día tengo disponibilidad a las ${((p.horariosDisponibles as string[]) ?? []).join(", ")}. ¿Cuál te sirve?` };
    case "ai-book-propose":
      return { actionProposal: { actionType: "crear_cita_nylas_generico", arguments: { fecha: "2024-05-04", hora: "10:00", servicio: "Corte" } } };
    case "ai-book-present":
      return { responseText: "Tu cita quedó reservada." };
    case "ap-c-present":
    case "ap-r-present":
      return { responseText: String(p.citasTexto ?? "") };
    default:
      return { responseText: "ok" };
  }
}

async function armar(opts: { spec?: BusinessAgentSpec; ahora?: Date } = {}) {
  const cal = calendarioFake();
  const appts = createInMemoryAppointmentStore();
  let ahora = opts.ahora ?? new Date("2030-03-14T15:00:00Z"); // jueves 10:00 Colombia
  const m = await mundo(undefined, {
    createNylasEventsClient: () => cal.lector,
    createNylasEventsWriteClient: () => cal.escritor,
    createAppointmentStore: () => appts,
    now: () => ahora,
  });
  await m.conectarCalendario(TENANT_A);
  m.setIA(ia);
  const a = await m.activar(opts.spec ?? agenteCitas(), TENANT_A);
  let w = 0;
  const turno = (t: string) => a.turno(t, `w${++w}`);
  const ultima = () => m.orchStore.listExecutions(TENANT_A).at(-1)!;
  return { m, a, cal, appts, turno, ultima, setAhora: (d: Date) => { ahora = d; } };
}

/** Reserva REAL del sábado 2030-03-16 a las 10:00 (Corte, 45 min): "hola -> quiero una cita -> nombre -> sábado -> a las 10". */
async function reservar(x: Awaited<ReturnType<typeof armar>>) {
  await x.turno("Hola");
  await x.turno("Quiero una cita");
  await x.turno("Ana Pérez");
  await x.turno("El sábado");
  await x.turno("A las 10 de la mañana");
}

describe("R7 — E2E: reservar -> cancelar / reprogramar por el runtime REAL", () => {
  it("1. la reserva REGISTRA la cita del agente (tenant + teléfono del canal) y respeta el aviso mínimo", async () => {
    const x = await armar();
    await reservar(x);
    assert.equal(x.cal.eventos.size, 1, "el evento existe en el calendario");
    const filas = x.appts.all();
    assert.equal(filas.length, 1);
    assert.equal(filas[0]!.tenantId, TENANT_A);
    assert.equal(filas[0]!.telefonoCliente, CONV.telefonoCliente, "identidad = la del CANAL");
    assert.equal(filas[0]!.servicio, "Corte");
    assert.equal(filas[0]!.inicioIso, "2030-03-16T15:00:00.000Z", "el sábado dicho por el cliente (no la fecha adivinada por la IA), 10:00 Colombia");
    assert.equal(filas[0]!.estado, "confirmada");
  });

  it("2. 'Quiero cancelar mi cita' => lista SUS citas, pide número, confirma y cancela en el calendario REAL", async () => {
    const x = await armar();
    await reservar(x);
    await x.turno("Quiero cancelar mi cita");
    assert.ok(x.m.mensajes.some((t) => /1️⃣ Corte — .*16 de marzo/i.test(t)), "el cliente ve su cita (texto del backend)");
    assert.equal(x.ultima().current_node_id, "ap-c-q-pick");
    await x.turno("1");
    assert.equal(x.ultima().current_node_id, "ap-c-btn", "pide CONFIRMAR antes de cancelar");
    assert.equal(x.cal.eventos.size, 1, "todavía no se canceló nada");
    await x.turno("Sí, cancelar");
    assert.equal(x.cal.eventos.size, 0, "el evento se borró del calendario REAL");
    assert.equal(x.appts.all()[0]!.estado, "cancelada");
    assert.ok(x.m.mensajes.includes("Listo, tu cita fue cancelada."), "el aviso pasa el filtro porque la cancelación es REAL (evidencia verificada)");
    assert.equal(x.ultima().status, "completed");
  });

  it("3. 'No, mantenerla' NO cancela nada", async () => {
    const x = await armar();
    await reservar(x);
    for (const t of ["Quiero cancelar mi cita", "1", "No, mantenerla"]) await x.turno(t);
    assert.equal(x.cal.eventos.size, 1);
    assert.equal(x.appts.all()[0]!.estado, "confirmada");
    assert.ok(x.m.mensajes.includes("Perfecto, no se hizo ningún cambio."));
  });

  it("4. SIN citas: no se inventa nada ('No encontré nada próximo') y no se toca el calendario", async () => {
    const x = await armar();
    await x.turno("Quiero cancelar mi cita");
    assert.ok(x.m.mensajes.some((t) => /No encontré nada próximo a tu nombre/.test(t)));
    assert.equal(x.cal.eventos.size, 0);
  });

  it("5. 'Quiero reprogramar mi cita' => elige, día nuevo, horarios REALES (duración de la cita), mueve el MISMO evento", async () => {
    const x = await armar();
    await reservar(x);
    // Un evento de OTRA persona el lunes 08:00–10:00: los horarios ofrecidos deben empezar a las 10:00.
    x.cal.eventos.set("evt-otra", { id: "evt-otra", startUnix: Date.parse("2030-03-18T13:00:00Z") / 1000, endUnix: Date.parse("2030-03-18T15:00:00Z") / 1000, title: "otra persona" });
    await x.turno("Quiero reprogramar mi cita");
    assert.equal(x.ultima().current_node_id, "ap-r-q-pick");
    await x.turno("1");
    assert.equal(x.ultima().current_node_id, "ap-r-q-when");
    await x.turno("El lunes");
    // Texto redactado por el BACKEND (no por la IA): "Estos son los horarios disponibles para el ...".
    const ofrecidos = x.m.mensajes.filter((t) => /horarios disponibles para el/.test(t)).at(-1) ?? "";
    assert.match(ofrecidos, /10:00/, "ofrece desde que el calendario real queda libre: " + ofrecidos);
    assert.doesNotMatch(ofrecidos, /08:00|08:30|09:00|09:30/, "no ofrece horarios que se solapan con el evento de otra persona");
    assert.equal(x.ultima().current_node_id, "ap-r-q-hour");
    await x.turno("A las 3 de la tarde");
    const idOriginal = x.appts.all()[0]!.eventId;
    const ev = x.cal.eventos.get(idOriginal)!;
    assert.equal(new Date(ev.startUnix * 1000).toISOString(), "2030-03-18T20:00:00.000Z", "lunes 15:00 Colombia");
    assert.equal(ev.endUnix - ev.startUnix, 45 * 60, "misma duración que la cita original");
    assert.equal(x.appts.all()[0]!.reprogramaciones, 1);
    assert.equal(x.cal.eventos.size, 2, "se MOVIÓ el evento (no se duplicó)");
    assert.ok(x.m.mensajes.includes("Listo, tu cita fue cambiada al nuevo horario."));
  });

  it("6. reprogramar a un horario OCUPADO se rechaza y el cliente puede probar otro día (no se cuelga)", async () => {
    const x = await armar();
    await reservar(x);
    x.cal.eventos.set("evt-otra", { id: "evt-otra", startUnix: Date.parse("2030-03-18T20:00:00Z") / 1000, endUnix: Date.parse("2030-03-18T21:00:00Z") / 1000, title: "otra persona" });
    for (const t of ["Quiero reprogramar mi cita", "1", "El lunes", "A las 3 de la tarde"]) await x.turno(t);
    const id = x.appts.all()[0]!.eventId;
    assert.equal(new Date(x.cal.eventos.get(id)!.startUnix * 1000).toISOString(), "2030-03-16T15:00:00.000Z", "la cita NO se movió");
    assert.ok(x.m.mensajes.some((t) => /No pude hacer ese cambio/.test(t)));
    assert.equal(x.ultima().current_node_id, "ap-r-q-when", "vuelve a pedir el día");
  });

  it("7. POLÍTICA: a menos de 24 h el listado lo advierte y cancelar se rechaza => transferencia REAL a una persona (nunca silencio)", async () => {
    const x = await armar();
    await reservar(x);
    x.setAhora(new Date("2030-03-16T02:00:00Z")); // viernes 21:00: faltan 13 h
    for (const t of ["Quiero cancelar mi cita", "1", "Sí, cancelar"]) await x.turno(t);
    assert.ok(x.m.mensajes.some((t) => /quedan menos de 24 h/.test(t)), "el cliente ve por qué no se puede");
    assert.equal(x.cal.eventos.size, 1, "el calendario NO se tocó");
    assert.equal(x.appts.all()[0]!.estado, "confirmada");
    assert.ok(x.m.mensajes.some((t) => /persona del equipo/.test(t)));
    assert.equal(x.m.pausas.length, 1, "transferencia REAL: chat pausado");
  });

  it("8. SIN permiso de cancelar en el Wizard: el agente NO compila la gestión y 'quiero cancelar' sigue el flujo normal", async () => {
    const x = await armar({ spec: agenteCitas({}, { allowed: false, minNoticeHours: 24 }) });
    await reservar(x);
    assert.equal(x.m.accionesDe("ap-c-list").length, 0);
    await x.turno("Quiero cancelar mi cita");
    assert.equal(x.m.accionesDe("ap-c-act").length, 0);
    assert.equal(x.cal.eventos.size, 1);
  });

  it("9. una pregunta de POLÍTICA ('¿puedo cancelar mi cita?') NO dispara la cancelación", async () => {
    const x = await armar();
    await reservar(x);
    await x.turno("¿Puedo cancelar mi cita si estoy enferma?");
    assert.equal(x.m.accionesDe("ap-c-list").length, 0);
    assert.equal(x.cal.eventos.size, 1);
  });

  it("10. el aviso mínimo (Wizard) rechaza reservar con menos de 60 min de antelación (antes era solo UI)", async () => {
    const x = await armar({ ahora: new Date("2030-03-16T14:30:00Z") }); // sábado 09:30 Colombia
    await x.turno("Hola");
    await x.turno("Quiero una cita");
    await x.turno("Ana Pérez");
    await x.turno("Hoy");
    await x.turno("A las 10 de la mañana"); // faltan 30 min < 60
    assert.equal(x.cal.eventos.size, 0, "no se reservó por debajo del aviso mínimo");
    assert.equal(x.appts.all().length, 0);
  });

  void TELEFONO;
});
