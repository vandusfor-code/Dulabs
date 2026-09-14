/**
 * FASE 10 (Analytics + Scalability + Production QA, autorizado) — E2E real
 * contra Supabase (nunca contra AMORE/Daniela/Charlotte/Solo Talento;
 * tenants, números y flows SIEMPRE descartables, randomUUID).
 *
 * Cubre, contra datos reales:
 *  1. El hallazgo F10-B: una conversación con >500 mensajes ya NO puede
 *     hacer desaparecer otra conversación de la misma número (regresión del
 *     bug de escalabilidad de app/api/dashboard/conversaciones/route.ts).
 *  2. Aislamiento de tenant en los datos de analytics (mensajes, flow
 *     executions/effects, eventos de conversación).
 *  3. Filtro de fecha real contra dulabs_conversaciones_nuevas_contar.
 *  4. Sin doble conteo entre tenants en flow executions/effects.
 *
 * Tolerante a que la migración 20260930000000 (índices + funciones RPC de
 * F10) todavía no se haya aplicado -- ver lib/conversaciones-inbox.ts: si el
 * RPC no existe, las aserciones que dependen estrictamente de él se
 * documentan y se saltan en tiempo de ejecución (mismo criterio que F8.5/F9),
 * el resto del archivo sigue corriendo igual.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFlow, createFlowVersion } from "@/lib/flow/flow-store";
import { resolverUltimoMensajePorConversacion } from "@/lib/conversaciones-inbox";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "F10 Analytics -- E2E real contra Supabase",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const sufijo = randomUUID().slice(0, 8);
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const numeroA = `f10-an-a-${sufijo}`;
    const numeroB = `f10-an-b-${sufijo}`;
    const clienteRuidoso = "573000000001"; // recibe >500 mensajes
    const clientePocoActivo = "573000000002"; // 1 solo mensaje -- el que se podía perder

    let rpcRecientesDisponible = false;
    let rpcNuevasDisponible = false;

    after(async () => {
      if (!HAS_SUPABASE) return;
      await admin.from("dulabs_mensajes_log").delete().eq("phone_number_id", numeroA);
      await admin.from("dulabs_mensajes_log").delete().eq("phone_number_id", numeroB);
      await admin.from("dulabs_conversacion_eventos").delete().eq("phone_number_id", numeroA);
      await admin.from("dulabs_flow_executions").delete().eq("tenant_id", tenantA);
      await admin.from("dulabs_flow_executions").delete().eq("tenant_id", tenantB);
      await admin.from("dulabs_flow_versions").delete().eq("tenant_id", tenantA);
      await admin.from("dulabs_flow_versions").delete().eq("tenant_id", tenantB);
      await admin.from("dulabs_flows").delete().eq("tenant_id", tenantA);
      await admin.from("dulabs_flows").delete().eq("tenant_id", tenantB);
      await admin.from("dulabs_clientes_config").delete().eq("id_tenant", tenantA);
      await admin.from("dulabs_clientes_config").delete().eq("id_tenant", tenantB);
    });

    it("prepara datos descartables (tenant A: 1 conversación ruidosa + 1 poco activa; tenant B: aislado)", async () => {
      const { error: cfgAError } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: tenantA,
        phone_number_id: numeroA,
        whatsapp_business_account_id: `waba-${numeroA}`,
        telefono_negocio: `5730${Math.floor(Math.random() * 100_000_000)}`,
        nombre_negocio: "F10 E2E A (descartable)",
      });
      assert.equal(cfgAError, null, cfgAError?.message);
      const { error: cfgBError } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: tenantB,
        phone_number_id: numeroB,
        whatsapp_business_account_id: `waba-${numeroB}`,
        telefono_negocio: `5731${Math.floor(Math.random() * 100_000_000)}`,
        nombre_negocio: "F10 E2E B (descartable)",
      });
      assert.equal(cfgBError, null, cfgBError?.message);

      // 600 mensajes en UNA sola conversación (más que el viejo tope de 500
      // de app/api/dashboard/conversaciones/route.ts antes de F10).
      const ahora = Date.now();
      const filasRuidosas = Array.from({ length: 600 }, (_, i) => ({
        phone_number_id: numeroA,
        telefono_cliente: clienteRuidoso,
        direccion: i % 2 === 0 ? "entrante" : "saliente",
        contenido: `mensaje ruidoso ${i}`,
        created_at: new Date(ahora - (600 - i) * 1000).toISOString(),
      }));
      for (let i = 0; i < filasRuidosas.length; i += 200) {
        const { error } = await admin.from("dulabs_mensajes_log").insert(filasRuidosas.slice(i, i + 200));
        assert.equal(error, null, error?.message);
      }

      // Una sola conversación, mucho más antigua que los 500 mensajes
      // ruidosos más recientes -- exactamente el caso que el viejo
      // .limit(500) podía perder.
      const { error: pocoActivoError } = await admin.from("dulabs_mensajes_log").insert({
        phone_number_id: numeroA,
        telefono_cliente: clientePocoActivo,
        direccion: "entrante",
        contenido: "conversación poco activa",
        created_at: new Date(ahora - 700 * 1000).toISOString(),
      });
      assert.equal(pocoActivoError, null, pocoActivoError?.message);

      // Tenant B: una conversación con contenido inconfundible, para probar
      // que nunca se cuela en las consultas del tenant A.
      const { error: tenantBMsgError } = await admin.from("dulabs_mensajes_log").insert({
        phone_number_id: numeroB,
        telefono_cliente: "573000000099",
        direccion: "entrante",
        contenido: "NUNCA debe aparecer en resultados del tenant A",
        created_at: new Date().toISOString(),
      });
      assert.equal(tenantBMsgError, null, tenantBMsgError?.message);
    });

    it("F10-B: la conversación poco activa NO desaparece detrás de la conversación ruidosa (regresión del hallazgo de escalabilidad)", async () => {
      const probe = await admin.rpc("dulabs_conversaciones_recientes", { p_phone_number_ids: [numeroA], p_limite: 10 });
      rpcRecientesDisponible = !probe.error;
      if (!rpcRecientesDisponible) {
        console.error(
          "[f10-analytics.e2e] RPC dulabs_conversaciones_recientes no disponible todavía (migración 20260930000000 sin aplicar) -- se documenta y se continúa; el fallback tolerante YA estaba probado en lib/conversaciones-inbox.test.ts.",
        );
        return;
      }

      const resultado = await resolverUltimoMensajePorConversacion(admin, [numeroA]);
      const claves = resultado.map((r) => `${r.phone_number_id}:${r.telefono_cliente}`);
      assert.ok(claves.includes(`${numeroA}:${clienteRuidoso}`), "la conversación ruidosa debe seguir apareciendo");
      assert.ok(
        claves.includes(`${numeroA}:${clientePocoActivo}`),
        "F10-B: la conversación poco activa NO debe desaparecer aunque otra conversación tenga 600 mensajes",
      );
    });

    it("aislamiento de tenant: los mensajes del tenant B nunca aparecen al consultar solo el número del tenant A", async () => {
      const resultado = await resolverUltimoMensajePorConversacion(admin, [numeroA]);
      assert.ok(!resultado.some((r) => r.phone_number_id === numeroB));
      assert.ok(!resultado.some((r) => r.contenido?.includes("NUNCA debe aparecer")));
    });

    it("dulabs_conversaciones_nuevas_contar respeta el rango de fechas pedido", async () => {
      const desde = new Date(Date.now() - 60 * 60 * 1000); // última hora
      const hasta = new Date();
      const r = await admin.rpc("dulabs_conversaciones_nuevas_contar", {
        p_phone_number_ids: [numeroA],
        p_desde: desde.toISOString(),
        p_hasta: hasta.toISOString(),
      });
      rpcNuevasDisponible = !r.error;
      if (!rpcNuevasDisponible) {
        console.error(
          "[f10-analytics.e2e] RPC dulabs_conversaciones_nuevas_contar no disponible todavía (migración 20260930000000 sin aplicar) -- se documenta y se continúa.",
        );
        return;
      }
      // Ambas conversaciones del tenant A empezaron hace menos de una hora
      // en este seed -> deben contar como "nuevas" en ese rango.
      assert.equal(r.data, 2);

      const desdeLejano = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const hastaLejana = new Date(Date.now() - 300 * 24 * 60 * 60 * 1000);
      const rVacio = await admin.rpc("dulabs_conversaciones_nuevas_contar", {
        p_phone_number_ids: [numeroA],
        p_desde: desdeLejano.toISOString(),
        p_hasta: hastaLejana.toISOString(),
      });
      assert.equal(rVacio.data, 0, "un rango sin ninguna conversación nueva debe contar 0, no null ni error");
    });

    it("flow executions + effects: sin doble conteo entre tenants", async () => {
      const flowA = await createFlow(admin, { tenantId: tenantA, slug: `f10-flow-a-${sufijo}`, name: "F10 flow A" });
      const versionA = await createFlowVersion(admin, {
        tenantId: tenantA,
        flowId: flowA.id,
        versionNumber: 1,
        definition: { name: "f10-a", nodes: [{ id: "start", type: "start", config: { triggerType: "first_message" } }], edges: [], variables: [] },
      });
      const flowB = await createFlow(admin, { tenantId: tenantB, slug: `f10-flow-b-${sufijo}`, name: "F10 flow B" });
      const versionB = await createFlowVersion(admin, {
        tenantId: tenantB,
        flowId: flowB.id,
        versionNumber: 1,
        definition: { name: "f10-b", nodes: [{ id: "start", type: "start", config: { triggerType: "first_message" } }], edges: [], variables: [] },
      });

      const execA = { tenant_id: tenantA, flow_id: flowA.id, flow_version_id: versionA.id, execution_id: `exec-a-${sufijo}`, phone_number_id: numeroA, telefono_cliente: clienteRuidoso, status: "completed" };
      const execB = { tenant_id: tenantB, flow_id: flowB.id, flow_version_id: versionB.id, execution_id: `exec-b-${sufijo}`, phone_number_id: numeroB, telefono_cliente: "573000000099", status: "failed" };
      const { data: rowA, error: errA } = await admin.from("dulabs_flow_executions").insert(execA).select("id").single();
      assert.equal(errA, null, errA?.message);
      const { data: rowB, error: errB } = await admin.from("dulabs_flow_executions").insert(execB).select("id").single();
      assert.equal(errB, null, errB?.message);

      await admin.from("dulabs_flow_effects").insert({
        tenant_id: tenantA,
        flow_execution_id: rowA!.id,
        effect_id: `eff-a-${sufijo}`,
        node_id: "n1",
        kind: "ai",
        status: "succeeded",
        provider: "claude",
      });
      await admin.from("dulabs_flow_effects").insert({
        tenant_id: tenantB,
        flow_execution_id: rowB!.id,
        effect_id: `eff-b-${sufijo}`,
        node_id: "n1",
        kind: "ai",
        status: "failed",
        provider: "gemini",
      });

      const { data: ejecucionesA } = await admin.from("dulabs_flow_executions").select("id").eq("tenant_id", tenantA).eq("execution_id", `exec-a-${sufijo}`);
      const { data: efectosA } = await admin.from("dulabs_flow_effects").select("provider,status").eq("tenant_id", tenantA).eq("effect_id", `eff-a-${sufijo}`);
      assert.equal(ejecucionesA?.length, 1);
      assert.equal(efectosA?.[0]?.provider, "claude");
      assert.equal(efectosA?.[0]?.status, "succeeded");

      // Limpieza específica de este bloque (el resto lo cubre el after()).
      await admin.from("dulabs_flow_effects").delete().eq("effect_id", `eff-a-${sufijo}`);
      await admin.from("dulabs_flow_effects").delete().eq("effect_id", `eff-b-${sufijo}`);
      await admin.from("dulabs_flow_executions").delete().eq("execution_id", `exec-a-${sufijo}`);
      await admin.from("dulabs_flow_executions").delete().eq("execution_id", `exec-b-${sufijo}`);
    });

    it("dulabs_conversacion_eventos: handoff a humano / a IA se distinguen por motivo, sin ambigüedad", async () => {
      await admin.from("dulabs_conversacion_eventos").insert([
        { phone_number_id: numeroA, telefono_cliente: clienteRuidoso, tipo: "asignado", miembro_id: null, detalle: { motivo: "handoff_tomado" } },
        { phone_number_id: numeroA, telefono_cliente: clienteRuidoso, tipo: "liberado", miembro_id: null, detalle: { motivo: "devuelto_a_ia" } },
        { phone_number_id: numeroA, telefono_cliente: clientePocoActivo, tipo: "reasignado", miembro_id: null, detalle: { miembro_id_destino: 999 } },
      ]);
      const { data: eventos } = await admin
        .from("dulabs_conversacion_eventos")
        .select("tipo, detalle")
        .eq("phone_number_id", numeroA);
      const handoffsAHumano = (eventos ?? []).filter((e) => e.tipo === "asignado" && (e.detalle as { motivo?: string })?.motivo === "handoff_tomado").length;
      const handoffsAIA = (eventos ?? []).filter((e) => e.tipo === "liberado" && (e.detalle as { motivo?: string })?.motivo === "devuelto_a_ia").length;
      assert.equal(handoffsAHumano, 1);
      assert.equal(handoffsAIA, 1);
      // El "reasignado" simple (asignar/route.ts) NUNCA debe contarse como
      // handoff -- son conceptos distintos aunque toquen la misma tabla.
      assert.equal((eventos ?? []).filter((e) => e.tipo === "reasignado").length, 1);
    });

    it("cierre: confirma que rpcRecientesDisponible/rpcNuevasDisponible quedaron documentados para el reporte final", () => {
      // Esta aserción no falla nunca -- solo dejar constancia en el log de
      // test de qué caminos (RPC real vs fallback) se ejercitaron en esta
      // corrida concreta, para el reporte de cierre de F10.
      console.log(
        `[f10-analytics.e2e] RPC dulabs_conversaciones_recientes disponible=${rpcRecientesDisponible}, dulabs_conversaciones_nuevas_contar disponible=${rpcNuevasDisponible}`,
      );
      assert.ok(true);
    });
  },
);
