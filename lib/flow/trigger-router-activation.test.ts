/**
 * FASE F8.2 (Trigger Router SaaS — Self-Service Activation, autorizado) —
 * tests de `lib/flow/trigger-router-activation.ts`. Integración real contra
 * Supabase (tenants/flows/números sintéticos y descartables), gateada por
 * HAS_SUPABASE -- mismo patrón exacto que
 * lib/flow-trigger-router-activacion.test.ts (Fase 3B).
 *
 * Nota de arquitectura (por qué "Flow draft"/"Flow archived" NO se prueban
 * acá): `activarTriggerRouterParaNumero` recibe `flowId` y valida
 * EXCLUSIVAMENTE la fila de dulabs_clientes_config (tenant, flow_id,
 * flow_activo) -- nunca consulta el status del Flow en sí (draft/published/
 * archived), exactamente el mismo criterio que ya usa
 * lib/flow/flow-activation.ts::activarFlowParaNumero (F4, sin modificar):
 * el chequeo de `flow.status === "published"` vive en la ruta API
 * (app/api/flows/[id]/trigger-router/activate/route.ts), ANTES de llamar a
 * esta función -- ver trigger-router-api.test.ts para esos casos.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  activarTriggerRouterParaNumero,
  desactivarTriggerRouterParaNumero,
} from "@/lib/flow/trigger-router-activation";
import { createFlow, createFlowVersion, publishFlowVersion, archiveFlow } from "@/lib/flow/flow-store";
import type { FlowDefinition } from "@/lib/flow/types";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function flowMinimo(nombre: string): FlowDefinition {
  return {
    name: nombre,
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg", type: "message", config: { text: "hola" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg" },
      { id: "e2", source: "msg", target: "end" },
    ],
    variables: [],
  };
}

describe(
  "FASE F8.2 — lib/flow/trigger-router-activation.ts (integración real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const sufijo = randomUUID().slice(0, 8);
    const PHONE_A_ACTIVE = `f82-a-active-${sufijo}`;
    const PHONE_A_INACTIVO = `f82-a-inactivo-${sufijo}`;
    const PHONE_A_OTRO_FLOW = `f82-a-otro-flow-${sufijo}`;
    const PHONE_B = `f82-b-${sufijo}`;
    const PHONE_INEXISTENTE = `f82-no-existe-${sufijo}`;

    let flowIdA: string;
    let flowIdAOtro: string;
    let flowIdB: string;
    const clientesConfigCreados: string[] = [];
    const flowIdsCreados: { tenantId: string; flowId: string }[] = [];

    async function crearFlowPublicado(tenantId: string, nombre: string): Promise<string> {
      const flow = await createFlow(admin, { tenantId, slug: `${nombre}-${sufijo}`, name: nombre });
      flowIdsCreados.push({ tenantId, flowId: flow.id });
      const version = await createFlowVersion(admin, {
        tenantId,
        flowId: flow.id,
        versionNumber: 1,
        definition: flowMinimo(nombre),
      });
      await publishFlowVersion(admin, tenantId, flow.id, version.id);
      return flow.id;
    }

    async function insertarClienteConfig(input: {
      phoneNumberId: string;
      tenantId: string;
      flowId: string | null;
      flowActivo: boolean;
    }): Promise<void> {
      const { error } = await admin.from("dulabs_clientes_config").insert({
        nombre_negocio: `F8.2 test ${input.phoneNumberId}`,
        whatsapp_business_account_id: `waba-${input.phoneNumberId}`,
        phone_number_id: input.phoneNumberId,
        telefono_negocio: "0000000000",
        id_tenant: input.tenantId,
        flow_activo: input.flowActivo,
        flow_id: input.flowId,
        trigger_routing_activo: false,
      });
      if (error) throw error;
      clientesConfigCreados.push(input.phoneNumberId);
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      flowIdA = await crearFlowPublicado(TENANT_A, "f82-flow-a");
      flowIdAOtro = await crearFlowPublicado(TENANT_A, "f82-flow-a-otro");
      flowIdB = await crearFlowPublicado(TENANT_B, "f82-flow-b");

      await insertarClienteConfig({ phoneNumberId: PHONE_A_ACTIVE, tenantId: TENANT_A, flowId: flowIdA, flowActivo: true });
      await insertarClienteConfig({ phoneNumberId: PHONE_A_INACTIVO, tenantId: TENANT_A, flowId: null, flowActivo: false });
      // flow_activo=true, pero el Flow REALMENTE activo en este número es
      // flowIdAOtro, no flowIdA -- para el caso "flow_id no coincide".
      await insertarClienteConfig({ phoneNumberId: PHONE_A_OTRO_FLOW, tenantId: TENANT_A, flowId: flowIdAOtro, flowActivo: true });
      await insertarClienteConfig({ phoneNumberId: PHONE_B, tenantId: TENANT_B, flowId: flowIdB, flowActivo: true });
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (clientesConfigCreados.length > 0) {
        await admin.from("dulabs_clientes_config").delete().in("phone_number_id", clientesConfigCreados);
      }
      // dulabs_flow_versions es INMUTABLE una vez publicada (trigger
      // dulabs_flow_versions_guard_immutable bloquea el DELETE con una
      // excepción real de Postgres) -- intentar borrarla aquí fallaría en
      // silencio dentro de este cleanup y dejaría dulabs_flows huérfano (FK
      // ON DELETE RESTRICT desde versions). archiveFlow() es el único
      // camino real de "limpieza" para un Flow ya publicado -- los triggers
      // sí se pueden borrar de verdad.
      for (const { tenantId, flowId } of flowIdsCreados) {
        await admin.from("dulabs_flow_triggers").delete().eq("tenant_id", tenantId).eq("flow_id", flowId);
        await archiveFlow(admin, { tenantId, flowId });
      }
    });

    describe("Activación", () => {
      it("1. tenant correcto + flow_id coincide + flow_activo=true -> PASS, trigger_routing_activo=true", async () => {
        const resultado = await activarTriggerRouterParaNumero(admin, {
          tenantId: TENANT_A,
          flowId: flowIdA,
          phoneNumberId: PHONE_A_ACTIVE,
        });
        assert.deepEqual(resultado, { ok: true, triggerRoutingActivo: true });

        const { data } = await admin
          .from("dulabs_clientes_config")
          .select("trigger_routing_activo")
          .eq("phone_number_id", PHONE_A_ACTIVE)
          .maybeSingle();
        assert.equal(data?.trigger_routing_activo, true);

        // Deja el estado como estaba para el resto de la suite.
        await desactivarTriggerRouterParaNumero(admin, { tenantId: TENANT_A, phoneNumberId: PHONE_A_ACTIVE });
      });

      it("4. flow_activo=false (Flow 'inactivo' en este número) -> reject flow_no_activo_en_este_numero", async () => {
        const resultado = await activarTriggerRouterParaNumero(admin, {
          tenantId: TENANT_A,
          flowId: flowIdA,
          phoneNumberId: PHONE_A_INACTIVO,
        });
        assert.deepEqual(resultado, { ok: false, reason: "flow_no_activo_en_este_numero" });
      });

      it("5. Flow de otro tenant (tenantId no coincide con el dueño real del número) -> reject numero_no_encontrado", async () => {
        // Intento: activar usando el phone_number_id de A pero afirmando ser TENANT_B.
        const resultado = await activarTriggerRouterParaNumero(admin, {
          tenantId: TENANT_B,
          flowId: flowIdA,
          phoneNumberId: PHONE_A_ACTIVE,
        });
        assert.deepEqual(resultado, { ok: false, reason: "numero_no_encontrado" });
      });

      it("6. phone_number_id de otro tenant -> reject numero_no_encontrado (mismo criterio anti-enumeración de F4)", async () => {
        const resultado = await activarTriggerRouterParaNumero(admin, {
          tenantId: TENANT_A,
          flowId: flowIdA,
          phoneNumberId: PHONE_B,
        });
        assert.deepEqual(resultado, { ok: false, reason: "numero_no_encontrado" });
      });

      it("7. phone_number_id inexistente -> reject numero_no_encontrado", async () => {
        const resultado = await activarTriggerRouterParaNumero(admin, {
          tenantId: TENANT_A,
          flowId: flowIdA,
          phoneNumberId: PHONE_INEXISTENTE,
        });
        assert.deepEqual(resultado, { ok: false, reason: "numero_no_encontrado" });
      });

      it("8. flow_id de la fila distinto al Flow solicitado -> reject flow_no_activo_en_este_numero", async () => {
        const resultado = await activarTriggerRouterParaNumero(admin, {
          tenantId: TENANT_A,
          flowId: flowIdA, // el número PHONE_A_OTRO_FLOW en realidad tiene flowIdAOtro activo
          phoneNumberId: PHONE_A_OTRO_FLOW,
        });
        assert.deepEqual(resultado, { ok: false, reason: "flow_no_activo_en_este_numero" });
      });

      it("9. UPDATE condicionado: si el estado cambia justo antes de escribir, no activa sobre un estado inválido", async () => {
        // Simula la carrera: otro admin desactiva el Flow (F4 real --
        // flow_activo=false exige flow_id=null por el CHECK preexistente de
        // F4, así que ambos cambian juntos, exactamente como haría
        // desactivarFlowParaNumero) justo después de que la validación
        // explícita de esta función ya pasó, pero antes/durante su propio
        // UPDATE condicionado.
        const { error: mutError } = await admin
          .from("dulabs_clientes_config")
          .update({ flow_activo: false, flow_id: null })
          .eq("phone_number_id", PHONE_A_OTRO_FLOW);
        assert.equal(mutError, null, "la mutación de prueba debe respetar el CHECK de F4 (flow_activo=false requiere flow_id=null)");

        const resultado = await activarTriggerRouterParaNumero(admin, {
          tenantId: TENANT_A,
          flowId: flowIdAOtro,
          phoneNumberId: PHONE_A_OTRO_FLOW,
        });
        // La revalidación explícita (pasos 2-4, antes del UPDATE) ya rechaza
        // esto como flow_no_activo_en_este_numero -- el UPDATE condicionado
        // (test 9b) es la SEGUNDA barrera para la ventana de carrera real
        // (estrictamente entre la lectura y el UPDATE mismo).
        assert.deepEqual(resultado, { ok: false, reason: "flow_no_activo_en_este_numero" });
        // Restaura el estado para el resto de la suite.
        await admin.from("dulabs_clientes_config").update({ flow_activo: true, flow_id: flowIdAOtro }).eq("phone_number_id", PHONE_A_OTRO_FLOW);
      });

      it("9b. UPDATE condicionado real: si la fila deja de cumplir la condición ENTRE la lectura y el UPDATE, el UPDATE afecta 0 filas", async () => {
        // Prueba directa del UPDATE condicionado en sí (no de la
        // revalidación previa): construye manualmente la misma sentencia que
        // usa activarTriggerRouterParaNumero contra una fila que YA no
        // cumple flow_activo=true (mutación válida según el CHECK de F4:
        // flow_activo=false junto con flow_id=null), y confirma que
        // Postgres no actualiza ninguna fila.
        const { error: mutError } = await admin
          .from("dulabs_clientes_config")
          .update({ flow_activo: false, flow_id: null })
          .eq("phone_number_id", PHONE_A_OTRO_FLOW);
        assert.equal(mutError, null);

        const { data } = await admin
          .from("dulabs_clientes_config")
          .update({ trigger_routing_activo: true })
          .eq("phone_number_id", PHONE_A_OTRO_FLOW)
          .eq("id_tenant", TENANT_A)
          .eq("flow_activo", true)
          .eq("flow_id", flowIdAOtro)
          .select("phone_number_id")
          .maybeSingle();
        assert.equal(data, null);
        await admin.from("dulabs_clientes_config").update({ flow_activo: true, flow_id: flowIdAOtro }).eq("phone_number_id", PHONE_A_OTRO_FLOW);
      });

      it("10. activa correctamente trigger_routing_activo=true (repetición explícita del caso feliz)", async () => {
        const resultado = await activarTriggerRouterParaNumero(admin, {
          tenantId: TENANT_A,
          flowId: flowIdA,
          phoneNumberId: PHONE_A_ACTIVE,
        });
        assert.equal(resultado.ok, true);
        if (resultado.ok) assert.equal(resultado.triggerRoutingActivo, true);
      });
    });

    describe("Desactivación", () => {
      it("11. desactiva correctamente trigger_routing_activo=false", async () => {
        const resultado = await desactivarTriggerRouterParaNumero(admin, {
          tenantId: TENANT_A,
          phoneNumberId: PHONE_A_ACTIVE,
        });
        assert.deepEqual(resultado, { ok: true, triggerRoutingActivo: false });
      });

      it("12/13. conserva flow_activo=true y flow_id sin cambios", async () => {
        const { data } = await admin
          .from("dulabs_clientes_config")
          .select("flow_activo, flow_id, trigger_routing_activo")
          .eq("phone_number_id", PHONE_A_ACTIVE)
          .maybeSingle();
        assert.equal(data?.flow_activo, true);
        assert.equal(data?.flow_id, flowIdA);
        assert.equal(data?.trigger_routing_activo, false);
      });

      it("14. cross-tenant (tenantId incorrecto) -> reject numero_no_encontrado, no desactiva", async () => {
        // Reactiva para probar que el intento cross-tenant NO lo apaga.
        await activarTriggerRouterParaNumero(admin, { tenantId: TENANT_A, flowId: flowIdA, phoneNumberId: PHONE_A_ACTIVE });
        const resultado = await desactivarTriggerRouterParaNumero(admin, {
          tenantId: TENANT_B,
          phoneNumberId: PHONE_A_ACTIVE,
        });
        assert.deepEqual(resultado, { ok: false, reason: "numero_no_encontrado" });
        const { data } = await admin
          .from("dulabs_clientes_config")
          .select("trigger_routing_activo")
          .eq("phone_number_id", PHONE_A_ACTIVE)
          .maybeSingle();
        assert.equal(data?.trigger_routing_activo, true, "el intento cross-tenant nunca debe desactivarlo");
        await desactivarTriggerRouterParaNumero(admin, { tenantId: TENANT_A, phoneNumberId: PHONE_A_ACTIVE });
      });

      it("15. phone_number_id inexistente -> reject numero_no_encontrado", async () => {
        const resultado = await desactivarTriggerRouterParaNumero(admin, {
          tenantId: TENANT_A,
          phoneNumberId: PHONE_INEXISTENTE,
        });
        assert.deepEqual(resultado, { ok: false, reason: "numero_no_encontrado" });
      });
    });

    describe("Seguridad — derivación de tenant (16-18)", () => {
      it("16/17. el tenant SIEMPRE es un parámetro explícito de la función (nunca leído del propio row/config) -- confirmado por firma de tipos + comportamiento cross-tenant ya probado arriba", () => {
        // Prueba estructural: activarTriggerRouterParaNumero/desactivarTriggerRouterParaNumero
        // reciben `tenantId` como argumento obligatorio (ver tipos exportados)
        // -- quien llama (la ruta API, vía requireFlowAccess) es quien
        // decide ese valor a partir del JWT, nunca esta función. El
        // comportamiento real (rechazo cross-tenant) ya se probó en los
        // tests 5, 6 y 14.
        assert.equal(activarTriggerRouterParaNumero.length, 2);
        assert.equal(desactivarTriggerRouterParaNumero.length, 2);
      });

      it("18. no acepta phone_number_id de otro tenant (repetición explícita, activar y desactivar)", async () => {
        const activar = await activarTriggerRouterParaNumero(admin, { tenantId: TENANT_A, flowId: flowIdB, phoneNumberId: PHONE_B });
        assert.deepEqual(activar, { ok: false, reason: "numero_no_encontrado" });
        const desactivar = await desactivarTriggerRouterParaNumero(admin, { tenantId: TENANT_A, phoneNumberId: PHONE_B });
        assert.deepEqual(desactivar, { ok: false, reason: "numero_no_encontrado" });
      });
    });
  },
);
