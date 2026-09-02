/**
 * Rediseño de agendamiento (autorizado) — escape hatch determinista,
 * integrado en atenderMensajeConFlowConFallback (lib/flow-runtime-bridge.ts).
 *
 * Mismo patrón que flow-runtime-bridge-fallback.test.ts: integración real
 * contra un tenant/flow/número DESCARTABLES (nunca datos de Daniela),
 * self-skip sin credenciales de Supabase. enviarWhatsApp no lanza sin un
 * token de Meta real -- solo registra el error y no hace nada -- así que
 * esta suite puede verificar la pausa/transferencia sin credenciales de Meta.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { atenderMensajeConFlowConFallback } from "@/lib/flow-runtime-bridge";
import { createFlow, createFlowVersion, publishFlowVersion } from "@/lib/flow/flow-store";
import type { FlowDefinition } from "@/lib/flow/types";
import type { ClienteConfig } from "@/lib/supabase";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "Escape hatch — atenderMensajeConFlowConFallback (integración real, tenant descartable)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_ID = randomUUID();
    const PHONE_NUMBER_ID = `test-escape-hatch-${Date.now()}`;
    let flowPreguntaAbiertaId: string;
    let flowConfirmacionBotonesId: string;

    // Flow mínimo: aterriza en una pregunta de TEXTO libre (equivalente a
    // q-fecha en el flow real de agendar) -- acá es donde el escape hatch
    // DEBE interceptar.
    function flowPreguntaAbierta(): FlowDefinition {
      return {
        name: "Escape hatch -- pregunta abierta",
        nodes: [
          { id: "start", type: "start", config: { triggerType: "first_message" } },
          { id: "q-fecha", type: "question", config: { text: "¿Para qué día?", variableKey: "fecha", required: true, validation: { kind: "text" } } },
          { id: "end", type: "end", config: {} },
        ],
        edges: [
          { id: "e1", source: "start", target: "q-fecha" },
          { id: "e2", source: "q-fecha", target: "end" },
        ],
        variables: [{ key: "fecha", label: "Fecha", type: "string" }],
      };
    }

    // Flow mínimo: aterriza en un nodo BUTTONS de confirmación -- acá el
    // escape hatch NO debe interceptar (esperando "button", no "text"),
    // porque ahí "cancela" es una respuesta de dominio legítima.
    function flowConfirmacionBotones(): FlowDefinition {
      return {
        name: "Escape hatch -- confirmación por botones",
        nodes: [
          { id: "start", type: "start", config: { triggerType: "first_message" } },
          {
            id: "q-confirmar",
            type: "buttons",
            config: {
              text: "¿Deseas cancelar esta cita?",
              variableKey: "respuesta",
              buttons: [
                { id: "cancelar_cita", label: "Cancelar cita" },
                { id: "mantener_cita", label: "Mantener cita" },
              ],
            },
          },
          { id: "end", type: "end", config: {} },
        ],
        edges: [
          { id: "e1", source: "start", target: "q-confirmar" },
          { id: "e2", source: "q-confirmar", target: "end", sourceHandle: "button:cancelar_cita" },
          { id: "e3", source: "q-confirmar", target: "end", sourceHandle: "button:mantener_cita" },
          { id: "e4", source: "q-confirmar", target: "end", sourceHandle: "text" },
        ],
        variables: [{ key: "respuesta", label: "Respuesta", type: "string" }],
      };
    }

    async function crearYPublicar(def: FlowDefinition, slug: string): Promise<string> {
      const flow = await createFlow(supabase, { tenantId: TENANT_ID, slug: `${slug}-${Date.now()}`, name: slug });
      const version = await createFlowVersion(supabase, { tenantId: TENANT_ID, flowId: flow.id, versionNumber: 1, definition: def });
      await publishFlowVersion(supabase, TENANT_ID, flow.id, version.id);
      return flow.id;
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      await supabase.from("dulabs_clientes_config").insert({
        id_tenant: TENANT_ID,
        nombre_negocio: "Escape hatch (borrar)",
        whatsapp_business_account_id: `waba-${PHONE_NUMBER_ID}`,
        phone_number_id: PHONE_NUMBER_ID,
        telefono_negocio: "0000000000",
      });
      flowPreguntaAbiertaId = await crearYPublicar(flowPreguntaAbierta(), "escape-pregunta");
      flowConfirmacionBotonesId = await crearYPublicar(flowConfirmacionBotones(), "escape-botones");
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      await supabase.from("dulabs_pausas_chat").delete().eq("phone_number_id", PHONE_NUMBER_ID);
      await supabase.from("dulabs_flow_executions").delete().eq("phone_number_id", PHONE_NUMBER_ID);
      await supabase.from("dulabs_clientes_config").delete().eq("phone_number_id", PHONE_NUMBER_ID);
    });

    function clienteCon(flowId: string, idSufijo: string) {
      return {
        id: `c-escape-${idSufijo}`,
        id_tenant: TENANT_ID,
        phone_number_id: PHONE_NUMBER_ID,
        nombre_negocio: "Escape hatch (borrar)",
        flow_activo: true as const,
        flow_id: flowId,
      } as ClienteConfig & { flow_activo: true; flow_id: string };
    }

    it("interrumpe una pregunta de TEXTO abierta (q-fecha), transfiere y NO guarda el texto como respuesta", async () => {
      const cliente = clienteCon(flowPreguntaAbiertaId, "texto");
      const telefonoCliente = "573003330001";

      // Mensaje 1: arranca la ejecución, aterriza esperando texto en q-fecha.
      const primero = await atenderMensajeConFlowConFallback({
        supabase,
        cliente,
        telefonoCliente,
        texto: "Hola, quiero una cita",
        wamid: `wamid-escape-a1-${randomUUID()}`,
      });
      assert.equal(primero.motivo, "processed_ok");
      const executionRowId = primero.result!.executionRowId!;
      const { data: filaAntes } = await supabase
        .from("dulabs_flow_executions")
        .select("status, expected_input")
        .eq("id", executionRowId)
        .maybeSingle();
      assert.equal(filaAntes?.status, "waiting_input");
      assert.equal(filaAntes?.expected_input, "text");

      // Mensaje 2: interrupción -- debe escapar, NUNCA guardarse como fecha.
      const segundo = await atenderMensajeConFlowConFallback({
        supabase,
        cliente,
        telefonoCliente,
        texto: "Cancela, quiero hablar con Dani.",
        wamid: `wamid-escape-a2-${randomUUID()}`,
      });
      assert.equal(segundo.handled, true);
      assert.equal(segundo.motivo, "escape_hatch");

      const { data: filaDespues } = await supabase
        .from("dulabs_flow_executions")
        .select("status, variables")
        .eq("id", executionRowId)
        .maybeSingle();
      assert.equal(filaDespues?.status, "transferred");
      assert.notEqual(
        (filaDespues?.variables as Record<string, unknown> | null)?.fecha,
        "Cancela, quiero hablar con Dani.",
        "el texto de interrupción NUNCA debe quedar guardado como si fuera la respuesta a la pregunta",
      );

      const { data: pausa } = await supabase
        .from("dulabs_pausas_chat")
        .select("pausado_hasta")
        .eq("phone_number_id", PHONE_NUMBER_ID)
        .eq("telefono_cliente", telefonoCliente)
        .maybeSingle();
      assert.ok(pausa, "debe haber activado la pausa (transferencia a humano)");
      assert.ok(new Date(pausa!.pausado_hasta).getTime() > Date.now(), "la pausa debe estar vigente hacia adelante");
    });

    it("NO interrumpe una confirmación por BOTONES en curso (ahí 'cancela' es una respuesta de dominio legítima)", async () => {
      const cliente = clienteCon(flowConfirmacionBotonesId, "botones");
      const telefonoCliente = "573003330002";

      const primero = await atenderMensajeConFlowConFallback({
        supabase,
        cliente,
        telefonoCliente,
        texto: "Hola",
        wamid: `wamid-escape-b1-${randomUUID()}`,
      });
      assert.equal(primero.motivo, "processed_ok");
      const { data: filaAntes } = await supabase
        .from("dulabs_flow_executions")
        .select("expected_input")
        .eq("id", primero.result!.executionRowId!)
        .maybeSingle();
      assert.equal(filaAntes?.expected_input, "button");

      // "cancela" respondida como TEXTO libre a una pregunta que espera un
      // botón: NO debe activar el escape hatch (motivo no debe ser
      // escape_hatch) -- debe seguir el camino normal del flow (el edge
      // "text" de fallback), llegando a "end" con éxito.
      const segundo = await atenderMensajeConFlowConFallback({
        supabase,
        cliente,
        telefonoCliente,
        texto: "cancela",
        wamid: `wamid-escape-b2-${randomUUID()}`,
      });
      assert.notEqual(segundo.motivo, "escape_hatch");
    });

    it("un botón tapeado (buttonId presente) nunca activa el escape hatch aunque el texto visible coincida", async () => {
      const cliente = clienteCon(flowConfirmacionBotonesId, "boton-tap");
      const telefonoCliente = "573003330003";

      await atenderMensajeConFlowConFallback({
        supabase,
        cliente,
        telefonoCliente,
        texto: "Hola",
        wamid: `wamid-escape-c1-${randomUUID()}`,
      });

      const resultado = await atenderMensajeConFlowConFallback({
        supabase,
        cliente,
        telefonoCliente,
        texto: "Cancelar cita",
        buttonId: "cancelar_cita",
        wamid: `wamid-escape-c2-${randomUUID()}`,
      });
      assert.notEqual(resultado.motivo, "escape_hatch");
    });
  },
);
