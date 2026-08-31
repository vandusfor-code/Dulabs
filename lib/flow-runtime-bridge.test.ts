/**
 * Fase 0 (autorizado) — prueba end-to-end REAL del pipeline completo:
 * webhook (simulado) → orchestrator real → store real (Supabase) →
 * InternalActionExecutor real (agendar_cita_especialista sobre
 * dulabs_especialistas/dulabs_citas_especialista reales) →
 * SendMessageExecutor (WhatsApp inyectado, sin red real) → respuesta.
 *
 * Tenant/flow/especialista TODOS descartables y aislados. NO usa el tenant
 * ni el número de Daniela. Se salta sin credenciales de Supabase.
 *
 * NOTA DE LIMPIEZA (documentado en el reporte de Fase 0): publicar un
 * dulabs_flow_versions es NECESARIO para que el orchestrator cree la
 * primera ejecución (resolveExecution exige flow.published_version_id).
 * Existe un bug preexistente en la función de guarda de inmutabilidad de
 * ese trigger (dulabs_flow_versions_guard_immutable): para DELETE, hace
 * `return new` en vez de `return old` -- en Postgres, un trigger BEFORE
 * DELETE que retorna NULL cancela la operación, así que NINGÚN
 * dulabs_flow_versions se puede borrar hoy vía la API, publicado o no. Este
 * test por lo tanto deja un flow+versión de prueba huérfanos pero inertes
 * (tenant aleatorio, sin relación con ningún negocio real) -- no se intentó
 * arreglar esa migración en esta fase (no está en la lista de archivos
 * autorizados a tocar).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { atenderMensajeConFlow, debeAtenderConFlow } from "@/lib/flow-runtime-bridge";
import { FIRST_MESSAGE_TEXT_VARIABLE_KEY } from "@/lib/flow/constants";
import { createFlow, createFlowVersion, publishFlowVersion } from "@/lib/flow/flow-store";
import { ORCHESTRATOR_OUTCOMES } from "@/lib/flow/flow-orchestrator";
import type { FlowDefinition } from "@/lib/flow/types";
import type { ClienteConfig } from "@/lib/supabase";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const PHONE_DANIELA = "1282448611609227";
const REMITENTE_314_AUTORIZADO = "573148127388";
const OTRO_REMITENTE_REAL = "573001112233";

describe("Fase 0 — debeAtenderConFlow (delega en debeUsarFlowParaRemitente, sin DB)", () => {
  it("phone_number_id sin lista de prueba → se comporta igual que el gate original (flow_activo/flow_id)", () => {
    assert.equal(
      debeAtenderConFlow({ flow_activo: false, flow_id: null, phone_number_id: "otro-numero" }, "cualquiera"),
      false,
    );
    assert.equal(
      debeAtenderConFlow({ flow_activo: true, flow_id: "x", phone_number_id: "otro-numero" }, "cualquiera"),
      true,
    );
  });

  it("2. Daniela + 314 autorizado + flow_activo=true → Flow", () => {
    assert.equal(
      debeAtenderConFlow(
        { flow_activo: true, flow_id: "flow-x", phone_number_id: PHONE_DANIELA },
        REMITENTE_314_AUTORIZADO,
      ),
      true,
    );
  });

  it("3. Daniela + remitente NO autorizado + flow_activo=true → LEGACY", () => {
    assert.equal(
      debeAtenderConFlow(
        { flow_activo: true, flow_id: "flow-x", phone_number_id: PHONE_DANIELA },
        OTRO_REMITENTE_REAL,
      ),
      false,
    );
  });

  it("4. Daniela + flow_activo=false → LEGACY, incluso para el remitente autorizado", () => {
    assert.equal(
      debeAtenderConFlow(
        { flow_activo: false, flow_id: null, phone_number_id: PHONE_DANIELA },
        REMITENTE_314_AUTORIZADO,
      ),
      false,
    );
  });
});

describe(
  "Fase 0 — pipeline end-to-end REAL (webhook → orchestrator → agenda real → envío inyectado)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_ID = randomUUID();
    const PHONE_NUMBER_ID = `test-e2e-flow-${Date.now()}`;
    const TELEFONO_CLIENTE = "573007776666";
    let especialistaId: number;
    let flowId: string;

    // Flow mínimo SIN nodos "ai" a propósito: prueba el pipeline real
    // (orchestrator + store + acción + envío) sin depender de una llamada
    // real a Claude, que sería costosa y no determinista para este test.
    function flowMinimoSinIA(): FlowDefinition {
      return {
        name: "E2E smoke — agendar directo",
        nodes: [
          { id: "start", type: "start", config: { triggerType: "first_message" } },
          {
            id: "act-agendar",
            type: "action",
            config: {
              actionType: "agendar_cita_especialista",
              // confirmado:"true" -- Fase 2b agregó el candado real en
              // agendarCitaEspecialista (especialistas-flow-adaptador.ts): sin
              // este flag la acción falla con no_confirmado. Este smoke E2E
              // prueba el pipeline de agendar, no el gate de confirmación, así
              // que declara confirmado igual que el nodo real act-agendar del
              // flow de Daniela.
              params: { servicio: "manos", fecha: "2027-01-05", hora: "16:00", nombreCliente: "Cliente E2E", confirmado: "true" },
            },
          },
          { id: "msg-ok", type: "message", config: { text: "Listo por aquí." } },
          { id: "msg-fail", type: "message", config: { text: "No se pudo por aquí." } },
          { id: "end-ok", type: "end", config: {} },
          { id: "end-fail", type: "end", config: {} },
        ],
        edges: [
          { id: "e1", source: "start", target: "act-agendar" },
          { id: "e2", source: "act-agendar", target: "msg-ok", sourceHandle: "success" },
          { id: "e3", source: "act-agendar", target: "msg-fail", sourceHandle: "failure" },
          { id: "e4", source: "msg-ok", target: "end-ok" },
          { id: "e5", source: "msg-fail", target: "end-fail" },
        ],
        variables: [],
      };
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      // internal-action-authorizer.ts (assertPhoneNumberOwnedByTenant) valida
      // contra dulabs_clientes_config REAL, no contra el objeto `cliente` que
      // se le pasa a atenderMensajeConFlow -- sin esta fila, agendar_cita_especialista
      // se rechaza con tenant_resource_mismatch antes de tocar la agenda.
      const { error: errCfg } = await supabase.from("dulabs_clientes_config").insert({
        id_tenant: TENANT_ID,
        nombre_negocio: "E2E Flow (borrar)",
        whatsapp_business_account_id: `waba-${PHONE_NUMBER_ID}`,
        phone_number_id: PHONE_NUMBER_ID,
        telefono_negocio: "0000000000",
      });
      if (errCfg) throw errCfg;

      const { data: esp, error } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_ID,
          phone_number_id: PHONE_NUMBER_ID,
          nombre: "Carla",
          numero_whatsapp: "573000000201",
          servicio: "manos",
          duracion_min: 60,
          requiere_aprobacion: false,
          bloquea_horario: true,
          es_general: false,
          activo: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      especialistaId = esp!.id as number;

      const flow = await createFlow(supabase, { tenantId: TENANT_ID, slug: `e2e-${Date.now()}`, name: "E2E" });
      flowId = flow.id;
      const version = await createFlowVersion(supabase, {
        tenantId: TENANT_ID,
        flowId,
        versionNumber: 1,
        definition: flowMinimoSinIA(),
      });
      // Necesario para que el orchestrator acepte crear la primera ejecución
      // -- ver nota de cabecera sobre el bug de inmutabilidad descubierto.
      await publishFlowVersion(supabase, TENANT_ID, flowId, version.id);
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      await supabase.from("dulabs_clientes_config").delete().eq("phone_number_id", PHONE_NUMBER_ID);
      await supabase.from("dulabs_citas_especialista").delete().eq("phone_number_id", PHONE_NUMBER_ID);
      if (especialistaId) await supabase.from("dulabs_especialistas").delete().eq("id", especialistaId);
      // dulabs_flow_executions/events/effects si el flow_id de arriba no
      // logra borrarse -- best effort, no crítico para el objetivo del test.
      if (flowId) {
        await supabase.from("dulabs_flow_executions").delete().eq("flow_id", flowId);
      }
    });

    it("primer mensaje crea la ejecución, agenda una cita REAL, y produce un envío (inyectado) con la evidencia correcta", async () => {
      const cliente = {
        id: "c-e2e",
        id_tenant: TENANT_ID,
        phone_number_id: PHONE_NUMBER_ID,
        flow_activo: true as const,
        flow_id: flowId,
      } as ClienteConfig & { flow_activo: true; flow_id: string };

      const enviosCapturados: { texto: string }[] = [];
      // resolverTokenMeta exige un token (real o de env) antes de intentar
      // enviar -- se fuerza vía env para este tenant de prueba sin token
      // real de Meta; enviarTexto en sí queda igual interceptado abajo.
      const prevToken = process.env.META_ACCESS_TOKEN;
      process.env.META_ACCESS_TOKEN = "token-fake-e2e";
      let result;
      try {
        result = await atenderMensajeConFlow({
          supabase,
          cliente,
          telefonoCliente: TELEFONO_CLIENTE,
          texto: "Hola, quiero una cita",
          wamid: `wamid-e2e-${randomUUID()}`,
          // Sin esto, el envío real intentaría llamar a la Graph API de Meta
          // de verdad -- se inyecta para probar el pipeline sin red real.
          sendMessageDepsOverride: {
            resolverCliente: async () =>
              ({ id: "c-e2e", id_tenant: TENANT_ID, phone_number_id: PHONE_NUMBER_ID } as ClienteConfig),
            enviarTexto: async ({ texto }) => {
              enviosCapturados.push({ texto });
              return { wamid: "wamid-enviado-fake" };
            },
          },
        });
      } finally {
        if (prevToken === undefined) delete process.env.META_ACCESS_TOKEN;
        else process.env.META_ACCESS_TOKEN = prevToken;
      }

      assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
      assert.equal(result.engineError, undefined);
      assert.equal(enviosCapturados.length, 1, "debe haberse enviado exactamente un mensaje real (interceptado)");
      assert.equal(enviosCapturados[0]?.texto, "Listo por aquí.");

      // La cita debe existir REALMENTE en dulabs_citas_especialista.
      const { data: citas } = await supabase
        .from("dulabs_citas_especialista")
        .select("id, especialista_id, estado, servicio")
        .eq("phone_number_id", PHONE_NUMBER_ID);
      assert.equal(citas?.length, 1);
      assert.equal(citas?.[0]?.especialista_id, especialistaId);
      assert.equal(citas?.[0]?.estado, "confirmada");

      // Fase 1 (Blocker #1) — el texto del PRIMER mensaje real llegó al
      // engine y quedó persistido en la ejecución real, sin haberse usado
      // como respuesta a ningún nodo (este flow mínimo no lo lee, y aun así
      // se agendó y confirmó con normalidad -- cero regresión).
      const { data: execRow } = await supabase
        .from("dulabs_flow_executions")
        .select("variables")
        .eq("id", result.executionRowId)
        .maybeSingle();
      assert.equal(execRow?.variables?.[FIRST_MESSAGE_TEXT_VARIABLE_KEY], "Hola, quiero una cita");
    });
  },
);
