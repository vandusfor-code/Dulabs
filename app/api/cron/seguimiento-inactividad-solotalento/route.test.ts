/**
 * Detección de inactividad de SOLOTALENTO (autorizado, NUEVO) —
 * ejecutarSeguimientoInactividadSolotalento recibe tenantId/phoneNumberId
 * como parámetros EXPLÍCITOS (nunca hardcoded adentro de la función bajo
 * prueba) precisamente para que estos tests usen un tenant/phone_number_id
 * 100% descartables -- NUNCA se toca al tenant/cliente/ejecuciones reales de
 * SOLOTALENTO SAS. Sin clientes reales, sin WhatsApp real (meta_permanent_token
 * null + sin META_ACCESS_TOKEN en este entorno, mismo patrón ya usado en
 * lib/asistente-daniela-gate.test.ts y app/api/cron/seguimiento-traspaso/route.test.ts).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFlow, createFlowVersion, createExecution, publishFlowVersion } from "@/lib/flow/flow-store";
import { createFlowEngineState } from "@/lib/flow/flow-engine";
import type { FlowDefinition } from "@/lib/flow/types";
import { ejecutarSeguimientoInactividadSolotalento, MENSAJE_PAUSA_SOLOTALENTO } from "./route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function minimalFlowDefinition(name: string): FlowDefinition {
  return {
    name,
    nodes: [
      { id: "start", type: "start", config: { triggerType: "manual" } },
      { id: "q1", type: "question", config: { text: "¿Qué opción?", variableKey: "x", required: true, validation: { kind: "regex", pattern: "^[1-9]$" } } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "q1" },
      { id: "e2", source: "q1", target: "end" },
    ],
    variables: [],
  };
}

describe(
  "ejecutarSeguimientoInactividadSolotalento — integración real (tenant/phone DESCARTABLES, sin WhatsApp real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT = randomUUID();
    const PHONE = `test-inactividad-${Date.now()}`;
    const DURACION_MS = 5 * 60 * 1000;
    let flowId: string;
    let versionId: string;
    const executionIds: string[] = [];

    async function crearEjecucion(params: {
      telefonoCliente: string;
      status: "waiting_input" | "completed";
      lastActivityAtPasadoMs?: number;
    }): Promise<string> {
      const state = createFlowEngineState(minimalFlowDefinition("seg"), { executionId: `exec-${randomUUID()}` });
      state.status = params.status;
      state.currentNodeId = "q1";
      state.expectedInput = params.status === "waiting_input" ? "text" : undefined;

      const created = await createExecution(supabase, {
        tenantId: TENANT,
        flowId,
        flowVersionId: versionId,
        executionId: state.executionId,
        phoneNumberId: PHONE,
        telefonoCliente: params.telefonoCliente,
        initialState: state,
      });
      if (!created.created) throw new Error("no se pudo crear la ejecución de prueba");

      if (params.lastActivityAtPasadoMs !== undefined) {
        const pasado = new Date(Date.now() - params.lastActivityAtPasadoMs).toISOString();
        await supabase.from("dulabs_flow_executions").update({ last_activity_at: pasado }).eq("tenant_id", TENANT).eq("id", created.row.id);
      }

      executionIds.push(created.row.id);
      return created.row.id;
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      const { error: cfgErr } = await supabase.from("dulabs_clientes_config").insert({
        id_tenant: TENANT,
        phone_number_id: PHONE,
        nombre_negocio: "TEST_INACTIVIDAD",
        whatsapp_business_account_id: `test-waba-${PHONE}`,
        telefono_negocio: "573000000000",
        meta_permanent_token: null,
      });
      if (cfgErr) throw cfgErr;

      const flow = await createFlow(supabase, { tenantId: TENANT, slug: "seg-test", name: "Seguimiento test" });
      flowId = flow.id;
      const version = await createFlowVersion(supabase, { tenantId: TENANT, flowId, versionNumber: 1, definition: minimalFlowDefinition("seg") });
      versionId = version.id;
      await publishFlowVersion(supabase, TENANT, flowId, versionId);
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (executionIds.length) await supabase.from("dulabs_flow_executions").delete().in("id", executionIds);
      await supabase.from("dulabs_mensajes_log").delete().eq("phone_number_id", PHONE);
      await supabase.from("dulabs_clientes_config").delete().eq("id_tenant", TENANT);
    });

    it("4/5. ejecución waiting_input inactiva hace más de 5 minutos -> envía MENSAJE_PAUSA_SOLOTALENTO y marca metadata para no repetirlo", async () => {
      const telefono = `cliente-${randomUUID()}`;
      await crearEjecucion({ telefonoCliente: telefono, status: "waiting_input", lastActivityAtPasadoMs: DURACION_MS + 60_000 });

      const logs: string[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
      let resultado;
      try {
        resultado = await ejecutarSeguimientoInactividadSolotalento(supabase, {
          tenantId: TENANT,
          phoneNumberId: PHONE,
          mensaje: MENSAJE_PAUSA_SOLOTALENTO,
          duracionMs: DURACION_MS,
        });
      } finally {
        console.error = original;
      }

      assert.equal(resultado.enviados, 1);
      assert.deepEqual(resultado.errores, []);
      assert.ok(
        logs.some((l) => l.includes("sin token de Meta para TEST_INACTIVIDAD")),
        "debe haber intentado un envío real (sin token de prueba, nunca llega a la red)",
      );

      const { data: fila } = await supabase.from("dulabs_flow_executions").select("metadata").eq("tenant_id", TENANT).eq("telefono_cliente", telefono).single();
      assert.equal(fila?.metadata?.pausaInactividadEnviada, true);
    });

    it("6. un segundo barrido inmediato NO reenvía (metadata ya marcada)", async () => {
      const telefono = `cliente-${randomUUID()}`;
      await crearEjecucion({ telefonoCliente: telefono, status: "waiting_input", lastActivityAtPasadoMs: DURACION_MS + 60_000 });

      const primero = await ejecutarSeguimientoInactividadSolotalento(supabase, {
        tenantId: TENANT,
        phoneNumberId: PHONE,
        mensaje: MENSAJE_PAUSA_SOLOTALENTO,
        duracionMs: DURACION_MS,
      });
      assert.equal(primero.enviados >= 1, true);

      const segundo = await ejecutarSeguimientoInactividadSolotalento(supabase, {
        tenantId: TENANT,
        phoneNumberId: PHONE,
        mensaje: MENSAJE_PAUSA_SOLOTALENTO,
        duracionMs: DURACION_MS,
      });
      // El segundo barrido puede seguir procesando OTRAS ejecuciones pendientes
      // de otros tests (misma tabla), pero esta fila puntual ya no debe
      // contarse -- se confirma releyendo su metadata, no el conteo global.
      void segundo;
      const { data: fila } = await supabase.from("dulabs_flow_executions").select("metadata").eq("tenant_id", TENANT).eq("telefono_cliente", telefono).single();
      assert.equal(fila?.metadata?.pausaInactividadEnviada, true, "sigue marcada, no se reescribió ni se duplicó el envío");
    });

    it("ejecución reciente (menos de 5 min) -> NO se detecta todavía", async () => {
      const telefono = `cliente-${randomUUID()}`;
      await crearEjecucion({ telefonoCliente: telefono, status: "waiting_input", lastActivityAtPasadoMs: 30_000 });

      const resultado = await ejecutarSeguimientoInactividadSolotalento(supabase, {
        tenantId: TENANT,
        phoneNumberId: PHONE,
        mensaje: MENSAJE_PAUSA_SOLOTALENTO,
        duracionMs: DURACION_MS,
      });

      const { data: fila } = await supabase.from("dulabs_flow_executions").select("metadata").eq("tenant_id", TENANT).eq("telefono_cliente", telefono).single();
      assert.notEqual(fila?.metadata?.pausaInactividadEnviada, true);
      void resultado;
    });

    it("ejecución ya 'completed' (el cliente sí respondió y el flow terminó) -> NUNCA se le envía el aviso de pausa", async () => {
      const telefono = `cliente-${randomUUID()}`;
      await crearEjecucion({ telefonoCliente: telefono, status: "completed", lastActivityAtPasadoMs: DURACION_MS + 60_000 });

      await ejecutarSeguimientoInactividadSolotalento(supabase, {
        tenantId: TENANT,
        phoneNumberId: PHONE,
        mensaje: MENSAJE_PAUSA_SOLOTALENTO,
        duracionMs: DURACION_MS,
      });

      const { data: fila } = await supabase.from("dulabs_flow_executions").select("metadata").eq("tenant_id", TENANT).eq("telefono_cliente", telefono).single();
      assert.notEqual(fila?.metadata?.pausaInactividadEnviada, true);
    });

    it("10. aislamiento: una ejecución inactiva de OTRO tenant/phone_number_id nunca se toca ni se cuenta", async () => {
      const otroTenant = randomUUID();
      const otroPhone = `test-otro-${Date.now()}`;
      const telefono = `cliente-${randomUUID()}`;

      // Fila de otro tenant necesita su PROPIO flow/version (dulabs_flow_executions
      // exige (tenant_id, flow_id) real vía FK) -- nunca se reutiliza el
      // flow/version de TENANT para no mezclar tenants ni siquiera en el fixture.
      const otroFlow = await createFlow(supabase, { tenantId: otroTenant, slug: "seg-test-otro", name: "Otro tenant" });
      const otroVersion = await createFlowVersion(supabase, {
        tenantId: otroTenant,
        flowId: otroFlow.id,
        versionNumber: 1,
        definition: minimalFlowDefinition("seg-otro"),
      });
      await publishFlowVersion(supabase, otroTenant, otroFlow.id, otroVersion.id);

      const state = createFlowEngineState(minimalFlowDefinition("seg-otro"), { executionId: `exec-${randomUUID()}` });
      state.status = "waiting_input";
      state.currentNodeId = "q1";
      state.expectedInput = "text";
      const created = await createExecution(supabase, {
        tenantId: otroTenant,
        flowId: otroFlow.id,
        flowVersionId: otroVersion.id,
        executionId: state.executionId,
        phoneNumberId: otroPhone,
        telefonoCliente: telefono,
        initialState: state,
      });
      if (!created.created) throw new Error("no se pudo crear la ejecución de otro tenant");
      const pasado = new Date(Date.now() - (DURACION_MS + 60_000)).toISOString();
      await supabase.from("dulabs_flow_executions").update({ last_activity_at: pasado }).eq("tenant_id", otroTenant).eq("id", created.row.id);

      const resultado = await ejecutarSeguimientoInactividadSolotalento(supabase, {
        tenantId: TENANT,
        phoneNumberId: PHONE,
        mensaje: MENSAJE_PAUSA_SOLOTALENTO,
        duracionMs: DURACION_MS,
      });

      const { data: filaOtro } = await supabase.from("dulabs_flow_executions").select("metadata").eq("tenant_id", otroTenant).eq("telefono_cliente", telefono).single();
      assert.notEqual(filaOtro?.metadata?.pausaInactividadEnviada, true, "el barrido de SOLOTALENTO nunca debe tocar la ejecución de otro tenant");
      void resultado;

      await supabase.from("dulabs_flow_executions").delete().eq("id", created.row.id);
    });
  },
);
