/**
 * Fase 1 (Blocker #5, autorizado) — reagendamiento de citas.
 *
 * Dos capas, mismo criterio que Blocker #4:
 * 1. Adaptador (real, Supabase, tenant descartable): garantías reales de
 *    datos/concurrencia sobre moverCitaEspecialista().
 * 2. Motor puro (sin DB, sin IA real): estructura del grafo, simulando los
 *    effect_result que ClaudeExecutor produciría en producción.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  moverCitaEspecialista,
  cancelarCitaEspecialista,
  agendarCitaEspecialista,
} from "@/lib/especialistas-flow-adaptador";
import { citasDeEspecialista } from "@/lib/especialistas";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { danielaReagendarCitaFlow } from "@/lib/flows/daniela-reagendar-cita.flow";
import { applyAiResponseClaimSecurity } from "@/lib/flow/ai-runtime/ai-response-security";
import { EFFECT_RESULT_CLASSIFICATIONS } from "@/lib/flow/executor-types";
import type { FlowEngineState } from "@/lib/flow/engine-types";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// dulabs_citas_especialista guarda "inicio" en UTC -- parseFechaHora (mismo
// criterio del adaptador) interpreta fecha/hora en America/Bogota (-05:00),
// así que "10:00" queda como "T15:00:00.000Z" en la fila real. Se compara
// por timestamp, nunca por prefijo de string, para no depender de a mano
// calcular el offset en cada aserción.
function timestampEsperado(fecha: string, hora: string): number {
  return new Date(`${fecha}T${hora}:00-05:00`).getTime();
}

// ============================================================================
// CAPA 1 — adaptador real (Supabase, tenant descartable)
// ============================================================================

describe(
  "Fase 1 — Blocker #5: adaptador de reagendamiento (integración real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const PHONE_A = `test-blocker5-a-${Date.now()}`;
    const PHONE_B = `test-blocker5-b-${Date.now()}`;
    let especialistaA: number;
    let especialistaB: number;

    async function crearCitaDePrueba(phoneNumberId: string, telefonoCliente: string, fecha: string, hora: string) {
      // confirmado:true -- Fase 2b agregó el candado real; este helper crea
      // fixtures de prueba, no prueba el candado en sí.
      const r = await agendarCitaEspecialista(supabase, { phoneNumberId, telefonoCliente, servicio: "manos", fecha, hora, nombreCliente: "Cliente Blocker5", confirmado: true });
      if (!r.ok) throw new Error(`no se pudo crear cita de prueba: ${JSON.stringify(r)}`);
      return r.cita;
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const insertEsp = async (tenantId: string, phoneNumberId: string, numero: string) => {
        const { data, error } = await supabase
          .from("dulabs_especialistas")
          .insert({ id_tenant: tenantId, phone_number_id: phoneNumberId, nombre: "Carla", numero_whatsapp: numero, servicio: "manos", duracion_min: 60, requiere_aprobacion: false, bloquea_horario: true, es_general: false, activo: true })
          .select("id").single();
        if (error) throw error;
        return data!.id as number;
      };
      especialistaA = await insertEsp(TENANT_A, PHONE_A, "573000000701");
      especialistaB = await insertEsp(TENANT_B, PHONE_B, "573000000702");
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      await supabase.from("dulabs_citas_especialista").delete().in("phone_number_id", [PHONE_A, PHONE_B]);
      if (especialistaA) await supabase.from("dulabs_especialistas").delete().eq("id", especialistaA);
      if (especialistaB) await supabase.from("dulabs_especialistas").delete().eq("id", especialistaB);
    });

    it("A. citaId que no pertenece a nadie → sin_cita_activa (nunca modifica nada)", async () => {
      const r = await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001110501", citaId: 999999999, nuevaFecha: "2027-07-01", nuevaHora: "10:00", confirmado: true });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "sin_cita_activa");
    });

    it("confirmación inexistente (confirmado=false) → NO ejecuta el cambio, cita original intacta", async () => {
      const cita = await crearCitaDePrueba(PHONE_A, "573001110502", "2027-07-02", "10:00");
      const r = await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001110502", citaId: cita.id, nuevaFecha: "2027-07-03", nuevaHora: "11:00", confirmado: false });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "no_confirmado");
      const { data: sigue } = await supabase.from("dulabs_citas_especialista").select("inicio").eq("id", cita.id).single();
      assert.ok(sigue!.inicio.startsWith("2027-07-02"), "la fecha original NUNCA debe cambiar sin confirmado=true");
    });

    it("C. una cita, nueva fecha/hora disponible, confirmado=true → reagenda de verdad (MISMO id, nueva hora, mismo especialista/servicio)", async () => {
      const cita = await crearCitaDePrueba(PHONE_A, "573001110503", "2027-07-04", "10:00");
      const r = await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001110503", citaId: cita.id, nuevaFecha: "2027-07-05", nuevaHora: "14:00", confirmado: true });
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.cita.id, cita.id, "N/P: debe ser la MISMA fila, nunca una nueva");
        assert.equal(new Date(r.cita.inicio).getTime(), timestampEsperado("2027-07-05", "14:00"), "debe reflejar la nueva fecha/hora real");
        assert.equal(r.cita.especialista_id, cita.especialista_id, "P: mismo especialista");
        assert.equal(r.cita.servicio, cita.servicio, "P: mismo servicio");
      }
    });

    it("D/L. nueva fecha/hora OCUPADA → NO modifica la cita original, sin duplicar nada", async () => {
      const telefonoCliente1 = "573001110504";
      const telefonoCliente2 = "573001110505";
      const citaOcupante = await crearCitaDePrueba(PHONE_A, telefonoCliente2, "2027-07-06", "15:00");
      const citaAMover = await crearCitaDePrueba(PHONE_A, telefonoCliente1, "2027-07-06", "10:00");

      const r = await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: telefonoCliente1, citaId: citaAMover.id, nuevaFecha: "2027-07-06", nuevaHora: "15:00", confirmado: true });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "ocupado");

      const { data: original } = await supabase.from("dulabs_citas_especialista").select("inicio, estado").eq("id", citaAMover.id).single();
      assert.equal(new Date(original!.inicio).getTime(), timestampEsperado("2027-07-06", "10:00"), "la cita original NUNCA debe moverse si el destino está ocupado");
      assert.equal(original!.estado, "confirmada");

      const { data: ocupante } = await supabase.from("dulabs_citas_especialista").select("inicio").eq("id", citaOcupante.id).single();
      assert.equal(new Date(ocupante!.inicio).getTime(), timestampEsperado("2027-07-06", "15:00"), "la cita que ya tenía el horario tampoco se toca");
    });

    it("I. intentar reagendar la cita de OTRO cliente → rechazado, sin modificar nada", async () => {
      const citaDeAlicia = await crearCitaDePrueba(PHONE_A, "573001110506", "2027-07-07", "10:00");
      const intentoDeBeto = await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001110599-beto", citaId: citaDeAlicia.id, nuevaFecha: "2027-07-08", nuevaHora: "10:00", confirmado: true });
      assert.equal(intentoDeBeto.ok, false);
      if (!intentoDeBeto.ok) assert.equal(intentoDeBeto.motivo, "sin_cita_activa");
      const { data: sigue } = await supabase.from("dulabs_citas_especialista").select("inicio").eq("id", citaDeAlicia.id).single();
      assert.ok(sigue!.inicio.startsWith("2027-07-07"));
    });

    it("J. intentar reagendar una cita de OTRO tenant/número → rechazado", async () => {
      const citaTenantB = await crearCitaDePrueba(PHONE_B, "573001110507", "2027-07-09", "10:00");
      const intentoCrossTenant = await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001110507", citaId: citaTenantB.id, nuevaFecha: "2027-07-10", nuevaHora: "10:00", confirmado: true });
      assert.equal(intentoCrossTenant.ok, false);
      if (!intentoCrossTenant.ok) assert.equal(intentoCrossTenant.motivo, "sin_cita_activa");
      const { data: sigue } = await supabase.from("dulabs_citas_especialista").select("inicio").eq("id", citaTenantB.id).single();
      assert.ok(sigue!.inicio.startsWith("2027-07-09"));
    });

    it("K. cita ya cancelada → sin_cita_activa (no reagenda algo cancelado)", async () => {
      const cita = await crearCitaDePrueba(PHONE_A, "573001110508", "2027-07-11", "10:00");
      const cancelacion = await cancelarCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001110508", confirmado: true, citaId: cita.id });
      assert.equal(cancelacion.ok, true);
      const r = await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001110508", citaId: cita.id, nuevaFecha: "2027-07-12", nuevaHora: "10:00", confirmado: true });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "sin_cita_activa");
    });

    it("M. concurrencia real — dos citas DISTINTAS intentando moverse al MISMO horario nuevo, exactamente al mismo tiempo: solo una gana", async () => {
      const cita1 = await crearCitaDePrueba(PHONE_A, "573001110509", "2027-07-13", "09:00");
      const cita2 = await crearCitaDePrueba(PHONE_A, "573001110510", "2027-07-13", "11:00");
      const [r1, r2] = await Promise.all([
        moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001110509", citaId: cita1.id, nuevaFecha: "2027-07-13", nuevaHora: "16:00", confirmado: true }),
        moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001110510", citaId: cita2.id, nuevaFecha: "2027-07-13", nuevaHora: "16:00", confirmado: true }),
      ]);
      const exitosos = [r1, r2].filter((r) => r.ok).length;
      const ocupados = [r1, r2].filter((r) => !r.ok && r.motivo === "ocupado").length;
      assert.equal(exitosos, 1, "exactamente una de las dos debe reportar éxito real para el mismo horario nuevo");
      assert.equal(ocupados, 1, "la otra debe reportar ocupado, nunca ambas éxito");
    });

    it("N. reagendar no crea ninguna fila nueva (misma cantidad de citas antes y después)", async () => {
      const telefonoCliente = "573001110511";
      const cita = await crearCitaDePrueba(PHONE_A, telefonoCliente, "2027-07-14", "10:00");
      const { count: antes } = await supabase.from("dulabs_citas_especialista").select("id", { count: "exact", head: true }).eq("telefono_cliente", telefonoCliente);
      await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente, citaId: cita.id, nuevaFecha: "2027-07-15", nuevaHora: "10:00", confirmado: true });
      const { count: despues } = await supabase.from("dulabs_citas_especialista").select("id", { count: "exact", head: true }).eq("telefono_cliente", telefonoCliente);
      assert.equal(despues, antes, "reagendar no debe insertar ninguna fila nueva");
      assert.equal(antes, 1);
    });

    it("O. después de reagendar, el dashboard (misma función citasDeEspecialista) ve la NUEVA fecha/hora", async () => {
      const cita = await crearCitaDePrueba(PHONE_A, "573001110512", "2027-07-16", "10:00");
      await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001110512", citaId: cita.id, nuevaFecha: "2027-07-17", nuevaHora: "12:00", confirmado: true });
      const citasDashboard = await citasDeEspecialista(supabase, especialistaA);
      const vista = citasDashboard.find((c) => c.id === cita.id);
      assert.ok(vista, "el dashboard debe poder ver esta cita");
      assert.equal(new Date(vista!.inicio).getTime(), timestampEsperado("2027-07-17", "12:00"), "el dashboard debe ver la nueva fecha/hora, no la vieja");
    });
  },
);

// ============================================================================
// CAPA 2 — motor puro (sin DB, sin IA real): estructura del Flow de Daniela
// ============================================================================

function avanzar(flow: ReturnType<typeof danielaReagendarCitaFlow>, state: FlowEngineState, event: Parameters<typeof runFlowEngine>[2]) {
  const r = runFlowEngine(flow, state, event);
  assert.equal(r.error, undefined, `no debe haber engineError: ${JSON.stringify(r.error)}`);
  return r.state;
}

describe("Fase 1 — Blocker #5: motor del Flow de reagendamiento (simulado, sin IA real)", () => {
  const flow = danielaReagendarCitaFlow();

  function consultarCitas(cantidadCitas: number, citasActivas: unknown[]) {
    let state = createFlowEngineState(flow, { executionId: randomUUID() });
    state = avanzar(flow, state, { type: "start" });
    assert.equal(state.pendingEffect?.nodeId, "act-consultar-citas");
    return avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { cantidadCitas, citasActivas } });
  }

  it("A (motor). sin citas activas → informa y termina, nunca pasa por act-mover-cita", () => {
    const r = runFlowEngine(flow, createFlowEngineState(flow, { executionId: randomUUID() }), { type: "start" });
    const estado = avanzar(flow, r.state, { type: "effect_result", success: true, effectId: r.state.pendingEffect!.effectId, data: { cantidadCitas: 0, citasActivas: [] } });
    assert.equal(estado.currentNodeId, "end-sin-cita");
    assert.equal(estado.status, "completed");
  });

  it("B/E. una cita → identifica → NUNCA salta a confirmar sin haber pedido fecha y hora primero", () => {
    let state = consultarCitas(1, [{ id: 801, servicio: "manos", inicio: "2027-07-01T10:00:00" }]);
    assert.equal(state.pendingEffect?.nodeId, "ai-identificar-unica", "Caso B: debe identificar la única cita");
    state = avanzar(flow, state, {
      type: "effect_result", success: true, effectId: state.pendingEffect!.effectId,
      data: { responseText: "Tienes una cita de manos.", citaObjetivoId: 801, citaObjetivoDescripcion: "manos", citaObjetivoServicio: "manos" },
    });
    // Caso E: el SIGUIENTE nodo es la pregunta de nueva fecha, NUNCA la
    // confirmación -- estructuralmente no existe forma de responder "sí"
    // antes de haber dado fecha y hora.
    assert.equal(state.currentNodeId, "q-nueva-fecha");
    assert.equal(state.status, "waiting_input");

    state = avanzar(flow, state, { type: "text", text: "2027-08-01" });
    assert.equal(state.currentNodeId, "q-nueva-hora", "debe pedir la hora antes de seguir");
    assert.notEqual(state.currentNodeId, "q-confirmar-reagendar");
  });

  it("F. una cita → disponible → confirma 'No' → NO llega a act-mover-cita", () => {
    let state = consultarCitas(1, [{ id: 802, servicio: "pies", inicio: "2027-07-02T11:00:00" }]);
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { responseText: "Tienes una cita de pies.", citaObjetivoId: 802, citaObjetivoDescripcion: "pies", citaObjetivoServicio: "pies" } });
    state = avanzar(flow, state, { type: "text", text: "2027-08-02" });
    state = avanzar(flow, state, { type: "text", text: "10:00" });
    assert.equal(state.pendingEffect?.nodeId, "ai-proponer-consultar");
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { actionProposal: {} } });
    assert.equal(state.currentNodeId, "act-consultar-disponibilidad");
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { disponible: true } });
    assert.equal(state.currentNodeId, "q-confirmar-reagendar");
    state = avanzar(flow, state, { type: "text", text: "No" });
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { classification: "no_confirma" } });
    assert.equal(state.currentNodeId, "end-abandonado");
    assert.equal(state.status, "completed");
  });

  it("C (motor). disponible → confirma 'Sí' → SOLO ENTONCES llega a act-mover-cita → éxito real → confirmación", () => {
    let state = consultarCitas(1, [{ id: 803, servicio: "manos", inicio: "2027-07-03T09:00:00" }]);
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { responseText: "Tienes una cita de manos.", citaObjetivoId: 803, citaObjetivoDescripcion: "manos", citaObjetivoServicio: "manos" } });
    state = avanzar(flow, state, { type: "text", text: "2027-08-03" });
    state = avanzar(flow, state, { type: "text", text: "15:00" });
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { actionProposal: {} } });
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { disponible: true } });
    state = avanzar(flow, state, { type: "text", text: "Sí, confirmo" });
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { classification: "confirma" } });
    assert.equal(state.currentNodeId, "ai-proponer-mover", "solo tras confirmar explícitamente se llega a proponer el cambio");
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { actionProposal: {} } });
    assert.equal(state.currentNodeId, "act-mover-cita");
    assert.equal(state.status, "waiting_effect");

    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { citaId: 803, movida: true, inicio: "2027-08-03T15:00:00", fin: "2027-08-03T16:00:00" } });
    assert.equal(state.currentNodeId, "ai-confirmar-reagendamiento");
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { responseText: "Listo, la dejé en el nuevo horario por acá 💛" } });
    assert.equal(state.currentNodeId, "end-reagendado");
    assert.equal(state.status, "completed");
  });

  it("D (motor). nuevo horario sin disponibilidad → informa, NUNCA llega a act-mover-cita", () => {
    let state = consultarCitas(1, [{ id: 804, servicio: "manos", inicio: "2027-07-04T09:00:00" }]);
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { responseText: "Tienes una cita.", citaObjetivoId: 804, citaObjetivoDescripcion: "manos", citaObjetivoServicio: "manos" } });
    state = avanzar(flow, state, { type: "text", text: "2027-08-04" });
    state = avanzar(flow, state, { type: "text", text: "09:00" });
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { actionProposal: {} } });
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { disponible: false } });
    assert.equal(state.currentNodeId, "end-sin-disponibilidad");
    assert.equal(state.status, "completed");
  });

  it("G/H. dos citas → lista, pregunta cuál; identificación clara pasa a fecha, identificación ambigua NUNCA continúa", () => {
    const citas = [
      { id: 901, servicio: "manos", inicio: "2027-07-05T10:00:00" },
      { id: 902, servicio: "pies", inicio: "2027-07-05T14:00:00" },
    ];
    let state = consultarCitas(2, citas);
    assert.equal(state.pendingEffect?.nodeId, "ai-listar-citas", "con 2+ citas, debe listar, nunca elegir directo");
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { responseText: "Tienes dos citas." } });
    assert.equal(state.currentNodeId, "q-cual-cita");

    // Estado compartido e inmutable: bifurca en dos ramas independientes
    // (G: identificación clara, H: identificación ambigua) desde el MISMO
    // punto (justo después de responder "la de pies", esperando el
    // effect_result de ai-identificar-seleccionada).
    const estadoTrasResponder = avanzar(flow, state, { type: "text", text: "la de pies" });
    assert.equal(estadoTrasResponder.pendingEffect?.nodeId, "ai-identificar-seleccionada");

    const stateClara = avanzar(flow, estadoTrasResponder, {
      type: "effect_result", success: true, effectId: estadoTrasResponder.pendingEffect!.effectId,
      data: { responseText: "Listo, la de pies.", citaObjetivoId: 902, citaObjetivoDescripcion: "pies", citaObjetivoServicio: "pies" },
    });
    assert.equal(stateClara.currentNodeId, "q-nueva-fecha", "G: selección clara pasa a pedir la nueva fecha");

    // H: identificación ambigua (sin citaObjetivoId) -- misma rama de origen, resultado distinto.
    const stateAmbigua = avanzar(flow, estadoTrasResponder, {
      type: "effect_result", success: true, effectId: estadoTrasResponder.pendingEffect!.effectId,
      data: { responseText: "No me quedó claro cuál es." },
    });
    assert.equal(stateAmbigua.currentNodeId, "end-seleccion-no-clara");
    assert.equal(stateAmbigua.status, "completed");
  });

  it("motor: si el guard rechaza la redacción de ai-confirmar-reagendamiento (simulado), cae al respaldo estático -- nunca crashea", () => {
    let state = consultarCitas(1, [{ id: 905, servicio: "manos", inicio: "2027-07-06T09:00:00" }]);
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { responseText: "Tienes una cita.", citaObjetivoId: 905, citaObjetivoDescripcion: "manos", citaObjetivoServicio: "manos" } });
    state = avanzar(flow, state, { type: "text", text: "2027-08-06" });
    state = avanzar(flow, state, { type: "text", text: "09:00" });
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { actionProposal: {} } });
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { disponible: true } });
    state = avanzar(flow, state, { type: "text", text: "Sí" });
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { classification: "confirma" } });
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { actionProposal: {} } });
    assert.equal(state.currentNodeId, "act-mover-cita");
    state = avanzar(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { citaId: 905, movida: true, inicio: "2027-08-06T09:00:00", fin: "2027-08-06T10:00:00" } });
    assert.equal(state.currentNodeId, "ai-confirmar-reagendamiento");
    state = avanzar(flow, state, { type: "effect_result", success: false, effectId: state.pendingEffect!.effectId, error: "unverified_external_claim:appointment.reserved" });
    assert.equal(state.currentNodeId, "end-reagendado-respaldo", "debe caer al respaldo estático, NUNCA a un engineError");
    assert.equal(state.status, "completed");
  });

  it("PROVENANCE: sin evidencia real, frases de reagendamiento -- resultado real verificado explícitamente", () => {
    // "Tu cita quedó cambiada" y "Tu nueva cita está confirmada" SÍ quedan
    // bloqueadas (mismo patrón coincidental de appointment.reserved que ya
    // documentó el Blocker #4 para cancelación). "Listo, te agendé para
    // mañana" -- GAP CERRADO (Blocker #7): el bug de límite de palabra ASCII
    // en DOMAIN_CAPABILITY_RULES ("agend\w+" no matchea "agendé") se corrigió
    // con lookbehind/lookahead sobre el alfabeto español -- ahora sí se
    // detecta y se bloquea sin evidencia, igual que las otras dos.
    const frasesBloqueadas = ["Tu cita quedó cambiada", "Tu nueva cita está confirmada", "Listo, te agendé para mañana"];
    for (const texto of frasesBloqueadas) {
      const r = applyAiResponseClaimSecurity({
        dispatchResult: { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data: { mode: "respond", responseText: texto } },
        variables: {},
      });
      const bloqueado = r.success === false && r.classification === EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED;
      assert.equal(bloqueado, true, `"${texto}" debe seguir bloqueada sin evidencia`);
    }

    // La redacción de respaldo real del grafo (la que efectivamente usa
    // daniela-reagendar-cita.flow.ts) SÍ pasa limpio, sin depender de este gap.
    const fraseSegura = applyAiResponseClaimSecurity({
      dispatchResult: { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data: { mode: "respond", responseText: "Listo, la dejé en el nuevo horario por acá 💛" } },
      variables: {},
    });
    assert.equal(fraseSegura.success, true);
  });
});
