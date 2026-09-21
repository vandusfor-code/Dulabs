/**
 * Un modelo REAL no devuelve solo la propuesta de acción: en un nodo `propose_action` suele añadir una frase
 * ("Voy a consultar la disponibilidad y a reservar tu cita..."). Esa frase NUNCA se envía al cliente (el motor solo envía el texto
 * de los nodos `respond`), pero antes pasaba por el filtro de afirmaciones: al mencionar "disponibilidad"/"reservar" sin evidencia
 * el filtro rechazaba TODO el resultado, la consulta de disponibilidad no se ejecutaba y la reserva terminaba transfiriendo el chat a
 * una persona. Bug hallado en la primera prueba real por WhatsApp (los tests con un modelo simulado que solo devolvía la propuesta no
 * lo veían). Esta prueba usa un modelo con la forma de uno real.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EffectDispatchRequest } from "@/lib/flow/executor-types";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { salonSpec } from "@/lib/agent-compiler/runtime/fixtures";
import { createInMemoryAppointmentStore } from "@/lib/agent-compiler/calendar/appointment-store";
import { TENANT_A, caps, mundo } from "@/lib/agent-compiler/e2e/testing/knowledge-harness";

const HORARIO = { week: Array.from({ length: 7 }, () => ({ closed: false, intervals: [{ open: "08:00", close: "20:00" }] })), exceptions: [] };
const NOMBRE = { key: "nombreCliente", label: "Nombre", type: "text" as const, required: true, enabled: true, scope: "customer" as const };

function agenteCitas(): BusinessAgentSpec {
  const s = salonSpec();
  return {
    ...s,
    capabilities: caps({ scheduling: true, humanHandoff: true }),
    catalog: { source: "structured", useServices: false, useProducts: false, quoteBeforeQualification: false },
    handoff: { rules: [], defaultPauseHours: 6 },
    scheduling: { ...s.scheduling, provider: "nylas", businessHours: HORARIO, minNoticeMinutes: 60, cancellation: { allowed: true, minNoticeHours: 24 } },
    customerData: { fields: [NOMBRE] },
  };
}

/** Modelo con la forma de uno real: propuesta LEGÍTIMA + una frase que el filtro de afirmaciones clasifica como una afirmación ("Ya consulté...", "Reservando..."). */
function iaComoUnModeloReal(req: EffectDispatchRequest): Record<string, unknown> {
  switch (req.nodeId) {
    case "ai-avail-propose":
      return {
        responseText: "Ya consulté la disponibilidad para ese día.",
        actionProposal: { actionType: "buscar_disponibilidad_nylas_generico", arguments: { fecha: "2030-03-16", servicio: "Corte" } },
      };
    case "ai-book-propose":
      return {
        responseText: "Reservando tu cita para ese horario ahora mismo.",
        actionProposal: { actionType: "crear_cita_nylas_generico", arguments: { fecha: "2030-03-16", hora: "10:00", servicio: "Corte" } },
      };
    case "ap-r-ai-avail":
      return {
        responseText: "Ya consulté la disponibilidad del nuevo día.",
        actionProposal: { actionType: "buscar_disponibilidad_nylas_generico", arguments: { fecha: "2030-03-18", servicio: "Corte" } },
      };
    default:
      return { responseText: "ok" };
  }
}

async function armar() {
  const appts = createInMemoryAppointmentStore();
  const m = await mundo(undefined, { createAppointmentStore: () => appts });
  await m.conectarCalendario(TENANT_A);
  m.setIA(iaComoUnModeloReal);
  const a = await m.activar(agenteCitas(), TENANT_A);
  let w = 0;
  const turno = async (t: string): Promise<string[]> => {
    const antes = m.mensajes.length;
    await a.turno(t, `r${++w}`);
    return m.mensajes.slice(antes);
  };
  return { m, turno, appts };
}

describe("IA con la forma de un modelo real (propuesta + frase): el flujo de citas funciona de punta a punta", () => {
  it("1. la consulta de disponibilidad SE EJECUTA y el cliente ve los horarios reales (la frase del modelo no la tumba)", async () => {
    const { m, turno } = await armar();
    await turno("Hola");
    await turno("Quiero una cita");
    await turno("Ana Pérez");
    const r = await turno("El sábado");
    assert.equal(m.accionesDe("act-avail").length, 1, "la acción de disponibilidad corrió");
    assert.match(r.join("\n"), /horarios disponibles para el sábado, 16 de marzo:\n1️⃣ 8:00 a\. m\./, JSON.stringify(r));
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-booking-pick");
  });

  it("2. la reserva se crea y se confirma (no termina transfiriendo el chat a una persona)", async () => {
    const { m, turno, appts } = await armar();
    for (const t of ["Hola", "Quiero una cita", "Ana Pérez", "El sábado"]) await turno(t);
    const r = await turno("A las 10 de la mañana");
    assert.equal(m.eventos.length, 1, JSON.stringify(r));
    assert.equal(appts.all().length, 1);
    assert.match(r.join("\n"), /Listo, tu cita de Corte quedó agendada para el sábado, 16 de marzo, 10:00 a\. m\./);
    assert.equal(m.pausas.length, 0, "el chat NO se pausó (no hubo transferencia)");
    assert.equal(m.mensajes.some((t) => /Te comunico con una persona/.test(t)), false);
  });

  it("3. la frase del modelo nunca llega al cliente (solo texto del backend o del agente)", async () => {
    const { m, turno } = await armar();
    for (const t of ["Hola", "Quiero una cita", "Ana Pérez", "El sábado", "A las 10 de la mañana"]) await turno(t);
    assert.equal(m.mensajes.some((t) => /ya consulté|reservando tu cita/i.test(t)), false);
  });

  it("4. reprogramar: la consulta del nuevo día también corre con un modelo que escribe una frase", async () => {
    const { m, turno } = await armar();
    for (const t of ["Hola", "Quiero una cita", "Ana Pérez", "El sábado", "A las 10 de la mañana"]) await turno(t);
    await turno("Quiero reprogramar mi cita");
    await turno("1");
    const r = await turno("El lunes");
    assert.equal(m.accionesDe("ap-r-act-avail").length, 1, JSON.stringify(r));
    assert.match(r.join("\n"), /horarios disponibles para el lunes/);
  });
});
