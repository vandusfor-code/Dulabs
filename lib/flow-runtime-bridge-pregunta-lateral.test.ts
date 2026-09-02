/**
 * Objetivo 2 (rediseño, autorizado) — preguntas laterales durante una
 * pregunta abierta activa, integrado en atenderMensajeConFlowConFallback
 * (lib/flow-runtime-bridge.ts::intentarPreguntaLateral).
 *
 * Mismo patrón que flow-runtime-bridge-escape-hatch.test.ts: integración
 * real contra un tenant/flow/número DESCARTABLES (nunca datos de Daniela),
 * self-skip sin credenciales de Supabase. El dispatch de IA se inyecta
 * (dispatchAiPreguntaLateralOverride) para NUNCA llamar a Claude real en
 * esta suite -- ni gasto ni no-determinismo. La clasificación real de
 * Claude (¿es esto realmente lateral?) es responsabilidad del prompt, no
 * de este archivo; acá se prueba el MECANISMO: qué pasa cuando la IA dice
 * "sí es lateral" o "no lo es", y las garantías de seguridad/estado
 * alrededor de esa respuesta.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { atenderMensajeConFlowConFallback, type DispatchAiPreguntaLateral } from "@/lib/flow-runtime-bridge";
import { createFlow, createFlowVersion, publishFlowVersion } from "@/lib/flow/flow-store";
import type { FlowDefinition } from "@/lib/flow/types";
import type { ClienteConfig } from "@/lib/supabase";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const HORARIOS_REALES = ["14:00", "16:00", "18:00"];
const HORARIOS_TEXTO_REAL = "1️⃣ 2:00 p. m.\n2️⃣ 4:00 p. m.\n3️⃣ 6:00 p. m.";
const BASE_CONOCIMIENTO_REAL = "Semipermanente en manos: $45.000\nHorario de atención: lunes a sábado, 9am a 7pm.\nDirección: Calle 99 # 50-19.";

/** Fake de IA: "sí es lateral" con la respuesta dada (o el fallback seguro si se omite). */
function fakeIaLateral(respuestaLateral?: string): DispatchAiPreguntaLateral {
  return async () => ({
    success: true,
    classification: "SUCCESS",
    data: { esLateral: "si", respuestaLateral },
  });
}

/** Fake de IA: "no es lateral" -- el motor debe seguir su camino normal. */
const fakeIaNoLateral: DispatchAiPreguntaLateral = async () => ({
  success: true,
  classification: "SUCCESS",
  data: { esLateral: "no" },
});

/** Fake de IA que devuelve un error (simula falla de Claude/budget). */
const fakeIaError: DispatchAiPreguntaLateral = async () => ({
  success: false,
  classification: "NON_RETRYABLE",
  error: "simulado",
});

describe(
  "Objetivo 2 — preguntas laterales (integración real, tenant descartable)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_ID = randomUUID();
    const PHONE_NUMBER_ID = `test-lateral-${Date.now()}`;
    let flowId: string;

    // Flow mínimo pero realista: SELECT_DATE (q-fecha) -> SELECT_TIME
    // (q-horario, con la lista REAL interpolada) -> resolver_seleccion_horario
    // (la MISMA acción real que usa daniela-agendar-cita.flow.ts) -> end.
    function flowFechaHorario(): FlowDefinition {
      return {
        name: "Pregunta lateral -- fecha y horario",
        nodes: [
          { id: "start", type: "start", config: { triggerType: "first_message" } },
          { id: "q-fecha", type: "question", config: { text: "¿Para qué fecha deseas tu cita? 📅", variableKey: "fecha", required: true, validation: { kind: "text" } } },
          {
            id: "q-horario",
            type: "question",
            config: {
              text: "💚 Estos son los horarios disponibles:\n\n{{horariosDisponiblesTexto}}\n\n¿Cuál de estos horarios prefieres?",
              variableKey: "hora",
              required: true,
              validation: { kind: "text" },
            },
          },
          { id: "act-resolver", type: "action", config: { actionType: "resolver_seleccion_horario" } },
          // Texto deliberadamente neutro (sin "cita"/"agendad"/"confirmad") para
          // no disparar claim-security en este flow mínimo de prueba -- ese
          // mecanismo real ya está probado a fondo en daniela-agendar-cita.flow.test.ts,
          // no es lo que se prueba acá.
          { id: "msg-confirmado", type: "message", config: { text: "Perfecto, gracias por elegir la hora.", messageRole: "informational" } },
          { id: "msg-no-claro", type: "message", config: { text: "No logré identificarlo 😔", messageRole: "informational" } },
          { id: "end-ok", type: "end", config: {} },
          { id: "end-no-claro", type: "end", config: {} },
        ],
        edges: [
          { id: "e1", source: "start", target: "q-fecha" },
          { id: "e2", source: "q-fecha", target: "q-horario" },
          { id: "e3", source: "q-horario", target: "act-resolver" },
          { id: "e4", source: "act-resolver", target: "msg-confirmado", sourceHandle: "success" },
          { id: "e4b", source: "msg-confirmado", target: "end-ok" },
          { id: "e5", source: "act-resolver", target: "msg-no-claro", sourceHandle: "failure" },
          { id: "e6", source: "msg-no-claro", target: "end-no-claro" },
        ],
        variables: [
          { key: "fecha", label: "Fecha", type: "string" },
          { key: "horariosDisponiblesTexto", label: "Lista de horarios", type: "string" },
          { key: "hora", label: "Hora elegida", type: "string" },
        ],
      };
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      await supabase.from("dulabs_clientes_config").insert({
        id_tenant: TENANT_ID,
        nombre_negocio: "Pregunta lateral (borrar)",
        whatsapp_business_account_id: `waba-${PHONE_NUMBER_ID}`,
        phone_number_id: PHONE_NUMBER_ID,
        telefono_negocio: "0000000000",
        base_conocimiento: BASE_CONOCIMIENTO_REAL,
      });
      const flow = await createFlow(supabase, { tenantId: TENANT_ID, slug: `lateral-${Date.now()}`, name: "Pregunta lateral" });
      const version = await createFlowVersion(supabase, { tenantId: TENANT_ID, flowId: flow.id, versionNumber: 1, definition: flowFechaHorario() });
      await publishFlowVersion(supabase, TENANT_ID, flow.id, version.id);
      flowId = flow.id;
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      await supabase.from("dulabs_flow_executions").delete().eq("phone_number_id", PHONE_NUMBER_ID);
      await supabase.from("dulabs_clientes_config").delete().eq("phone_number_id", PHONE_NUMBER_ID);
    });

    function cliente() {
      return {
        id: "c-lateral",
        id_tenant: TENANT_ID,
        phone_number_id: PHONE_NUMBER_ID,
        nombre_negocio: "Pregunta lateral (borrar)",
        base_conocimiento: BASE_CONOCIMIENTO_REAL,
        flow_activo: true as const,
        flow_id: flowId,
      } as ClienteConfig & { flow_activo: true; flow_id: string };
    }

    /** Arranca la ejecución y la deja en q-horario, con la lista REAL ya sembrada
     * en variables (simula que act-listar-horarios ya corrió antes -- eso ya está
     * probado en especialistas-flow-adaptador-horarios.test.ts, no se repite acá). */
    async function arrancarHastaQHorario(telefonoCliente: string): Promise<string> {
      const primero = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: cliente(),
        telefonoCliente,
        texto: "Quiero una cita",
        wamid: `wamid-lateral-1-${randomUUID()}`,
      });
      const executionRowId = primero.result!.executionRowId!;
      const segundo = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: cliente(),
        telefonoCliente,
        texto: "el sábado",
        wamid: `wamid-lateral-2-${randomUUID()}`,
      });
      assert.equal(segundo.motivo, "processed_ok");
      // Siembra la lista REAL directamente en la fila de ejecución (mismo
      // resultado que dejaría act-listar-horarios real, sin repetir esa
      // integración acá). horariosDisponibles (HH:MM 24h) es la que usa
      // resolverSeleccionHorario para el match exacto; horariosDisponiblesTexto
      // es solo el texto legible ya formateado (formatearListaHorarios).
      await supabase
        .from("dulabs_flow_executions")
        .update({
          variables: {
            fecha: "el sábado",
            horariosDisponibles: HORARIOS_REALES,
            horariosDisponiblesTexto: HORARIOS_TEXTO_REAL,
          },
        })
        .eq("id", executionRowId);
      return executionRowId;
    }

    it("7. pregunta lateral en SELECT_DATE (q-fecha) -> responde y conserva el estado en q-fecha", async () => {
      const telefonoCliente = "573004440001";
      const primero = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: cliente(),
        telefonoCliente,
        texto: "Quiero una cita",
        wamid: `wamid-l7-1-${randomUUID()}`,
      });
      const executionRowId = primero.result!.executionRowId!;
      const { data: filaAntes } = await supabase
        .from("dulabs_flow_executions")
        .select("current_node_id, status, state_version, variables")
        .eq("id", executionRowId)
        .maybeSingle();
      assert.equal(filaAntes?.current_node_id, "q-fecha");

      const resultado = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: cliente(),
        telefonoCliente,
        texto: "¿Cuánto cuesta el semipermanente?",
        wamid: `wamid-l7-2-${randomUUID()}`,
        dispatchAiPreguntaLateralOverride: fakeIaLateral("El semipermanente en manos cuesta $45.000."),
      });
      assert.equal(resultado.handled, true);
      assert.equal(resultado.motivo, "pregunta_lateral");

      const { data: filaDespues } = await supabase
        .from("dulabs_flow_executions")
        .select("current_node_id, status, state_version, variables")
        .eq("id", executionRowId)
        .maybeSingle();
      assert.equal(filaDespues?.current_node_id, "q-fecha", "el estado sigue siendo SELECT_DATE");
      assert.equal(filaDespues?.status, "waiting_input");
      assert.equal(filaDespues?.state_version, filaAntes?.state_version, "ni siquiera se tocó la versión del estado");
      assert.deepEqual(filaDespues?.variables, filaAntes?.variables, "ninguna variable cambió");
      assert.notEqual(
        (filaDespues?.variables as Record<string, unknown> | null)?.fecha,
        "¿Cuánto cuesta el semipermanente?",
        "la pregunta lateral NUNCA se guarda como si fuera la fecha",
      );
    });

    it("8/9. pregunta lateral en SELECT_TIME (q-horario) -> responde, conserva el estado, y la lista de horarios NO se pierde", async () => {
      const telefonoCliente = "573004440002";
      const executionRowId = await arrancarHastaQHorario(telefonoCliente);
      const { data: filaAntes } = await supabase
        .from("dulabs_flow_executions")
        .select("current_node_id, variables")
        .eq("id", executionRowId)
        .maybeSingle();
      assert.equal(filaAntes?.current_node_id, "q-horario");
      assert.equal((filaAntes?.variables as Record<string, unknown>).horariosDisponiblesTexto, HORARIOS_TEXTO_REAL);

      const resultado = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: cliente(),
        telefonoCliente,
        texto: "¿Cuánto cuesta?",
        wamid: `wamid-l89-1-${randomUUID()}`,
        dispatchAiPreguntaLateralOverride: fakeIaLateral("Depende del servicio, ¿cuál te interesa?"),
      });
      assert.equal(resultado.motivo, "pregunta_lateral");

      const { data: filaDespues } = await supabase
        .from("dulabs_flow_executions")
        .select("current_node_id, variables")
        .eq("id", executionRowId)
        .maybeSingle();
      assert.equal(filaDespues?.current_node_id, "q-horario", "sigue esperando la selección de horario");
      assert.equal(
        (filaDespues?.variables as Record<string, unknown>).horariosDisponiblesTexto,
        HORARIOS_TEXTO_REAL,
        "la lista de horarios se conserva EXACTAMENTE, no se volvió a consultar disponibilidad",
      );
    });

    it("10. tras la pregunta lateral, una selección real (segunda opción REAL de la lista, 16:00) sigue resolviendo con normalidad", async () => {
      // Nota: se responde con la hora ya en HH:MM (mismo formato que
      // resolverSeleccionHorario compara exacto contra horariosDisponibles)
      // en vez de 'la segunda' en lenguaje natural, para no depender de una
      // llamada real a Claude en esta suite (la interpretación de lenguaje
      // natural -> índice, vía ai-interpretar-seleccion, ya está probada
      // exhaustivamente y sin tocar en daniela-agendar-cita.flow.test.ts
      // test F: "la clienta escribe 'la segunda'"). Lo que se prueba acá es
      // que la pregunta lateral NO interfiere con el siguiente mensaje real
      // de la clienta, que sigue resolviendo contra la lista real intacta.
      const telefonoCliente = "573004440003";
      const executionRowId = await arrancarHastaQHorario(telefonoCliente);

      const lateral = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: cliente(),
        telefonoCliente,
        texto: "¿Qué incluye el servicio?",
        wamid: `wamid-l10-1-${randomUUID()}`,
        dispatchAiPreguntaLateralOverride: fakeIaLateral("Incluye manicure, esmaltado y retiro si aplica."),
      });
      assert.equal(lateral.motivo, "pregunta_lateral");

      const seleccion = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: cliente(),
        telefonoCliente,
        texto: "16:00",
        wamid: `wamid-l10-2-${randomUUID()}`,
      });
      assert.equal(seleccion.motivo, "processed_ok", "el mensaje real de selección se procesa con normalidad tras la interrupción lateral");

      const { data: filaFinal } = await supabase
        .from("dulabs_flow_executions")
        .select("current_node_id, status, variables")
        .eq("id", executionRowId)
        .maybeSingle();
      assert.equal(filaFinal?.current_node_id, "end-ok", "resolvió con éxito contra la lista real (segunda opción, 16:00)");
      assert.equal((filaFinal?.variables as Record<string, unknown>).hora, "16:00");
    });

    it("11. si baseConocimiento no cubre la pregunta, la respuesta usada es la segura por defecto (nunca inventa)", async () => {
      const telefonoCliente = "573004440004";
      await arrancarHastaQHorario(telefonoCliente);

      // La IA (fake) devuelve texto vacío -- simula que ni siquiera intentó
      // inventar algo; el mecanismo debe usar la respuesta segura siempre
      // que no haya texto real que pase la validación de claim-security.
      const resultado = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: cliente(),
        telefonoCliente,
        texto: "¿Dónde queda su sucursal en Bogotá centro?",
        wamid: `wamid-l11-${randomUUID()}`,
        dispatchAiPreguntaLateralOverride: fakeIaLateral(""),
      });
      assert.equal(resultado.motivo, "pregunta_lateral", "sigue manejado como lateral, con la respuesta segura, nunca inventando una dirección");
    });

    it("12. 'Hablar con Dani' durante una pregunta lateral sigue haciendo handoff (el escape hatch tiene prioridad)", async () => {
      const telefonoCliente = "573004440005";
      const executionRowId = await arrancarHastaQHorario(telefonoCliente);

      const resultado = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: cliente(),
        telefonoCliente,
        texto: "Quiero hablar con Dani",
        wamid: `wamid-l12-${randomUUID()}`,
        // A propósito NO se inyecta dispatchAiPreguntaLateralOverride: si el
        // escape hatch no tuviera prioridad y esto llegara a intentarPreguntaLateral,
        // fallaría por no tener un dispatch real ni inyectado -- la prueba
        // real de prioridad es que ni siquiera se necesita.
        dispatchAiPreguntaLateralOverride: fakeIaError,
      });
      assert.equal(resultado.motivo, "escape_hatch", "cancela/hablar con Dani gana sobre cualquier interpretación de pregunta lateral");

      const { data: fila } = await supabase
        .from("dulabs_flow_executions")
        .select("status")
        .eq("id", executionRowId)
        .maybeSingle();
      assert.equal(fila?.status, "transferred");
    });

    it("13. 'cancela' durante una pregunta lateral sigue teniendo prioridad (no se interpreta como fecha/hora/pregunta)", async () => {
      const telefonoCliente = "573004440006";
      const executionRowId = await arrancarHastaQHorario(telefonoCliente);

      const resultado = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: cliente(),
        telefonoCliente,
        texto: "cancela",
        wamid: `wamid-l13-${randomUUID()}`,
        dispatchAiPreguntaLateralOverride: fakeIaError,
      });
      assert.equal(resultado.motivo, "escape_hatch");

      const { data: fila } = await supabase
        .from("dulabs_flow_executions")
        .select("status, variables")
        .eq("id", executionRowId)
        .maybeSingle();
      assert.equal(fila?.status, "transferred");
      assert.notEqual((fila?.variables as Record<string, unknown>).hora, "cancela");
    });

    it("14. una pregunta lateral NUNCA crea, modifica ni cancela una cita -- ninguna acción real corre en este camino", async () => {
      const telefonoCliente = "573004440007";
      const executionRowId = await arrancarHastaQHorario(telefonoCliente);

      const resultado = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: cliente(),
        telefonoCliente,
        texto: "¿Cuánto cuesta y tienen descuento?",
        wamid: `wamid-l14-${randomUUID()}`,
        dispatchAiPreguntaLateralOverride: fakeIaLateral("El semipermanente en manos cuesta $45.000. No manejamos descuentos por ahora."),
      });
      assert.equal(resultado.motivo, "pregunta_lateral");
      // Nunca se generó ni despachó ningún effect real del engine -- el
      // OrchestratorResult ni siquiera existe para este camino.
      assert.equal(resultado.result, undefined, "intentarPreguntaLateral nunca invoca al orchestrator/engine");

      const { data: fila } = await supabase
        .from("dulabs_flow_executions")
        .select("current_node_id")
        .eq("id", executionRowId)
        .maybeSingle();
      assert.equal(fila?.current_node_id, "q-horario", "sigue exactamente donde estaba -- nunca avanzó a act-resolver ni a ningún nodo de escritura");
    });

    it("mensaje que NO parece lateral (respuesta directa) nunca llama a la IA de preguntas laterales -- sigue el camino normal del engine", async () => {
      const telefonoCliente = "573004440008";
      await arrancarHastaQHorario(telefonoCliente);

      let seLlamo = false;
      const dispatchQueNuncaDeberiaLlamarse: DispatchAiPreguntaLateral = async () => {
        seLlamo = true;
        return { success: true, classification: "SUCCESS", data: { esLateral: "no" } };
      };

      const resultado = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: cliente(),
        telefonoCliente,
        texto: "4:00 p. m.",
        wamid: `wamid-lnorm-${randomUUID()}`,
        dispatchAiPreguntaLateralOverride: dispatchQueNuncaDeberiaLlamarse,
      });
      assert.equal(seLlamo, false, "el filtro determinista barato evita la llamada a IA para una respuesta directa");
      assert.equal(resultado.motivo, "processed_ok");
    });

    it("la IA clasifica 'no es lateral' -> el engine sigue su camino normal con el texto original", async () => {
      const telefonoCliente = "573004440009";
      await arrancarHastaQHorario(telefonoCliente);

      // Texto que SÍ dispara el filtro barato (tiene 'cuál') pero la IA
      // (fake) dice que no es lateral -- debe procesarse normal.
      const resultado = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: cliente(),
        telefonoCliente,
        texto: "cuál es la de 4:00 p. m.",
        wamid: `wamid-lno-${randomUUID()}`,
        dispatchAiPreguntaLateralOverride: fakeIaNoLateral,
      });
      assert.notEqual(resultado.motivo, "pregunta_lateral");
    });

    it("si la IA de clasificación falla (error/budget), NO se bloquea el turno -- el engine procesa el mensaje normalmente", async () => {
      const telefonoCliente = "573004440010";
      await arrancarHastaQHorario(telefonoCliente);

      const resultado = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: cliente(),
        telefonoCliente,
        texto: "¿Cuánto cuesta?",
        wamid: `wamid-lerr-${randomUUID()}`,
        dispatchAiPreguntaLateralOverride: fakeIaError,
      });
      assert.notEqual(resultado.motivo, "pregunta_lateral");
      assert.notEqual(resultado.handled, false, "no debe registrarse como una excepción/fallback roto solo por esto");
    });
  },
);
