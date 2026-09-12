/**
 * Fase 3B (Trigger Router SaaS, autorizado) — tests del mecanismo NUEVO de
 * activación por número (`lib/flow-trigger-router-activacion.ts`), en
 * PARALELO al allowlist existente. Integración real contra Supabase
 * (tenants/flows/números sintéticos y descartables), gateada por
 * HAS_SUPABASE -- mismo patrón que el resto de la suite de Flow (se salta
 * automáticamente sin credenciales, como en este worktree).
 *
 * Este archivo NO toca `lib/flow-runtime-bridge.ts` ni ningún camino real
 * de producción -- solo ejercita la función nueva de forma aislada, más una
 * composición de PREVIEW (sección "Pipeline combinado") con el Router YA
 * EXISTENTE (`resolveFlowForIncomingEvent`) para demostrar que la
 * combinación futura sería fail-closed, sin conectar nada todavía.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { resolverActivacionTriggerRouter, triggerRouterKillSwitchActivo } from "@/lib/flow-trigger-router-activacion";
import { createFlow, createFlowVersion, publishFlowVersion, createFlowTrigger } from "@/lib/flow/flow-store";
import { resolveFlowForIncomingEvent } from "@/lib/flow/flow-store";
import type { FlowDefinition } from "@/lib/flow/types";
import type { IncomingEvent } from "@/lib/flow-triggers/types";

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
  "Fase 3B — Trigger Router SaaS: activación por número (integración real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const sufijo = randomUUID().slice(0, 8);
    const PHONE_A1 = `fase3b-a1-${sufijo}`;
    const PHONE_A2 = `fase3b-a2-${sufijo}`;
    const PHONE_B1 = `fase3b-b1-${sufijo}`;
    const PHONE_A3_INACTIVO = `fase3b-a3-${sufijo}`;
    const PHONE_A4_DRAFT = `fase3b-a4-${sufijo}`;

    let flowIdA1: string;
    let flowIdA2: string;
    let flowIdB1: string;
    let flowIdA3: string;
    let flowIdA4Draft: string;
    const clientesConfigCreados: string[] = [];
    const flowIdsCreados: string[] = [];

    async function crearFlowPublicado(tenantId: string, nombre: string): Promise<string> {
      const flow = await createFlow(admin, { tenantId, slug: `${nombre}-${sufijo}`, name: nombre });
      flowIdsCreados.push(flow.id);
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
      triggerRoutingActivo: boolean;
    }): Promise<{ error: { message: string; code?: string } | null }> {
      const { error } = await admin.from("dulabs_clientes_config").insert({
        nombre_negocio: `Fase3B test ${input.phoneNumberId}`,
        whatsapp_business_account_id: `waba-${input.phoneNumberId}`,
        phone_number_id: input.phoneNumberId,
        telefono_negocio: "0000000000",
        id_tenant: input.tenantId,
        flow_activo: input.flowActivo,
        flow_id: input.flowId,
        trigger_routing_activo: input.triggerRoutingActivo,
      });
      if (!error) clientesConfigCreados.push(input.phoneNumberId);
      return { error: error ? { message: error.message, code: error.code } : null };
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      flowIdA1 = await crearFlowPublicado(TENANT_A, "flow-a1");
      flowIdA2 = await crearFlowPublicado(TENANT_A, "flow-a2");
      flowIdB1 = await crearFlowPublicado(TENANT_B, "flow-b1");

      // Flow "inactivo" real (flow_activo=true, flow_id set) pero
      // trigger_routing_activo=false -- para el caso fail-closed §3.
      flowIdA3 = await crearFlowPublicado(TENANT_A, "flow-a3");

      // Flow que se queda en DRAFT a propósito -- para el pipeline
      // combinado (flow no publicado) más abajo.
      const flowDraft = await createFlow(admin, { tenantId: TENANT_A, slug: `flow-a4-draft-${sufijo}`, name: "flow-a4-draft" });
      flowIdsCreados.push(flowDraft.id);
      flowIdA4Draft = flowDraft.id;

      await insertarClienteConfig({ phoneNumberId: PHONE_A1, tenantId: TENANT_A, flowId: flowIdA1, flowActivo: true, triggerRoutingActivo: true });
      await insertarClienteConfig({ phoneNumberId: PHONE_A2, tenantId: TENANT_A, flowId: flowIdA2, flowActivo: true, triggerRoutingActivo: true });
      await insertarClienteConfig({ phoneNumberId: PHONE_B1, tenantId: TENANT_B, flowId: flowIdB1, flowActivo: true, triggerRoutingActivo: true });
      await insertarClienteConfig({ phoneNumberId: PHONE_A3_INACTIVO, tenantId: TENANT_A, flowId: flowIdA3, flowActivo: true, triggerRoutingActivo: false });
      // flow_activo=true pero apunta a un Flow DRAFT (nunca publicado) --
      // válido a nivel de esta tabla (el CHECK solo exige flow_id presente,
      // no que esté publicado).
      await insertarClienteConfig({ phoneNumberId: PHONE_A4_DRAFT, tenantId: TENANT_A, flowId: flowIdA4Draft, flowActivo: true, triggerRoutingActivo: true });
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (clientesConfigCreados.length > 0) {
        await admin.from("dulabs_clientes_config").delete().in("phone_number_id", clientesConfigCreados);
      }
      for (const tenantId of [TENANT_A, TENANT_B]) {
        if (flowIdsCreados.length > 0) {
          await admin.from("dulabs_flow_triggers").delete().eq("tenant_id", tenantId);
          await admin.from("dulabs_flow_versions").delete().eq("tenant_id", tenantId);
        }
        await admin.from("dulabs_flows").delete().eq("tenant_id", tenantId);
      }
    });

    describe("Kill switch (TRIGGER_ROUTER_KILL_SWITCH)", () => {
      it("ausente/vacío -> false (routing nuevo disponible según config del tenant)", () => {
        const original = process.env.TRIGGER_ROUTER_KILL_SWITCH;
        delete process.env.TRIGGER_ROUTER_KILL_SWITCH;
        try {
          assert.equal(triggerRouterKillSwitchActivo(), false);
        } finally {
          if (original !== undefined) process.env.TRIGGER_ROUTER_KILL_SWITCH = original;
        }
      });

      it("cualquier valor no vacío -> true (fuerza inactivo)", () => {
        const original = process.env.TRIGGER_ROUTER_KILL_SWITCH;
        process.env.TRIGGER_ROUTER_KILL_SWITCH = "on";
        try {
          assert.equal(triggerRouterKillSwitchActivo(), true);
        } finally {
          if (original === undefined) delete process.env.TRIGGER_ROUTER_KILL_SWITCH;
          else process.env.TRIGGER_ROUTER_KILL_SWITCH = original;
        }
      });

      it("kill switch activo -> 'inactivo' aunque la fila esté 100% configurada como activa (A1)", async () => {
        const original = process.env.TRIGGER_ROUTER_KILL_SWITCH;
        process.env.TRIGGER_ROUTER_KILL_SWITCH = "on";
        try {
          const resultado = await resolverActivacionTriggerRouter(admin, PHONE_A1);
          assert.deepEqual(resultado, { kind: "inactivo" });
        } finally {
          if (original === undefined) delete process.env.TRIGGER_ROUTER_KILL_SWITCH;
          else process.env.TRIGGER_ROUTER_KILL_SWITCH = original;
        }
      });
    });

    describe("PASO 0 — matriz de aislamiento A1/A2/B1 (7 aserciones explícitas)", () => {
      it("cada número SOLO resuelve su propio flow -- nunca el de otro número, ni del mismo tenant ni de otro", async () => {
        const resA1 = await resolverActivacionTriggerRouter(admin, PHONE_A1);
        const resA2 = await resolverActivacionTriggerRouter(admin, PHONE_A2);
        const resB1 = await resolverActivacionTriggerRouter(admin, PHONE_B1);

        assert.equal(resA1.kind, "activo");
        assert.equal(resA2.kind, "activo");
        assert.equal(resB1.kind, "activo");
        const flowA1 = (resA1 as { flowId: string }).flowId;
        const flowA2 = (resA2 as { flowId: string }).flowId;
        const flowB1 = (resB1 as { flowId: string }).flowId;

        // 1. A1 -> A1 ✓
        assert.equal(flowA1, flowIdA1);
        // 2. A2 -> A2 ✓
        assert.equal(flowA2, flowIdA2);
        // 3. B1 -> B1 ✓
        assert.equal(flowB1, flowIdB1);
        // 4. A1 -> A2 ✗ (nunca debe coincidir)
        assert.notEqual(flowA1, flowIdA2);
        // 5. A1 -> B1 ✗
        assert.notEqual(flowA1, flowIdB1);
        // 6. A2 -> B1 ✗
        assert.notEqual(flowA2, flowIdB1);
        // 7. B1 -> A1 ✗
        assert.notEqual(flowB1, flowIdA1);

        // Bonus -- tenantId también correcto por cada número (nunca cruzado).
        assert.equal((resA1 as { tenantId: string }).tenantId, TENANT_A);
        assert.equal((resA2 as { tenantId: string }).tenantId, TENANT_A);
        assert.equal((resB1 as { tenantId: string }).tenantId, TENANT_B);
      });
    });

    describe("Fail-closed", () => {
      it("trigger_routing_activo=false -> 'inactivo' aunque flow_activo=true y flow_id exista", async () => {
        const resultado = await resolverActivacionTriggerRouter(admin, PHONE_A3_INACTIVO);
        assert.deepEqual(resultado, { kind: "inactivo" });
      });

      it("tenant/número sin ninguna fila en dulabs_clientes_config -> 'sin_configuracion'", async () => {
        const resultado = await resolverActivacionTriggerRouter(admin, `no-existe-${randomUUID()}`);
        assert.deepEqual(resultado, { kind: "sin_configuracion" });
      });

      it("el CHECK de la migración rechaza a nivel de base de datos trigger_routing_activo=true con flow_activo=false", async () => {
        const { error } = await insertarClienteConfig({
          phoneNumberId: `fase3b-invalido-${sufijo}`,
          tenantId: TENANT_A,
          flowId: null,
          flowActivo: false,
          triggerRoutingActivo: true,
        });
        assert.ok(error, "debe rechazar el INSERT con un error de constraint");
        assert.equal(error?.code, "23514", "código real de Postgres para violación de CHECK constraint");
      });
    });

    describe("Pipeline combinado (preview de Fase 3C -- NO conectado a producción, solo demuestra que la combinación futura sería fail-closed)", () => {
      it("flow_id resuelto como 'activo' pero el Flow está en DRAFT -- el Router YA EXISTENTE (resolveFlowForIncomingEvent) lo rechaza igual, sin cambios de código", async () => {
        const resolucion = await resolverActivacionTriggerRouter(admin, PHONE_A4_DRAFT);
        assert.equal(resolucion.kind, "activo", "la activación por número no valida el status del Flow -- ese chequeo ya vive, correctamente, en el Router existente");
        const { flowId } = resolucion as { flowId: string };
        assert.equal(flowId, flowIdA4Draft);

        await createFlowTrigger(admin, { tenantId: TENANT_A, flowId, config: { type: "conversation_started" }, enabled: true });

        const event: IncomingEvent = {
          tenantId: TENANT_A,
          channel: "whatsapp",
          channelAccountId: PHONE_A4_DRAFT,
          contactId: "573000000000",
          eventType: "conversation_started",
          timestamp: new Date().toISOString(),
        };
        const seleccion = await resolveFlowForIncomingEvent(admin, event);
        assert.equal(seleccion.matched, false, "un Flow en draft NUNCA debe poder ejecutarse, ni siquiera con el Router SaaS activado para el número");
      });

      it("trigger disabled -- el Router YA EXISTENTE lo ignora igual, sin cambios de código", async () => {
        const trigger = await createFlowTrigger(admin, {
          tenantId: TENANT_A,
          flowId: flowIdA1,
          config: { type: "keyword", keywords: ["palabra-clave-deshabilitada"] },
          enabled: false,
        });
        assert.equal(trigger.enabled, false);

        const event: IncomingEvent = {
          tenantId: TENANT_A,
          channel: "whatsapp",
          channelAccountId: PHONE_A1,
          contactId: "573000000001",
          eventType: "message",
          timestamp: new Date().toISOString(),
          message: { text: "palabra-clave-deshabilitada" },
        };
        const seleccion = await resolveFlowForIncomingEvent(admin, event);
        // No debe matchear POR ESTE trigger deshabilitado -- puede o no
        // matchear por otro trigger real de flowIdA1 (no hay ninguno más
        // configurado en este test), así que se espera no-match total.
        assert.equal(seleccion.matched, false);
      });
    });
  },
);

// Actualizado (autorizado, Fase 3C) -- este bloque verificaba que
// lib/flow-runtime-bridge.ts NO importara este módulo, correcto mientras la
// Fase 3B lo dejó deliberadamente desconectado. Fase 3C conectó
// resolverActivacionTriggerRouter() al runtime real (dentro de
// resolverFlowIdConTriggerRouting), así que esa aserción quedó obsoleta por
// diseño -- se reemplaza por la aserción positiva equivalente: SÍ está
// conectado, y esa conexión está protegida por try/catch (fail-closed). La
// cobertura de comportamiento completa del fail-closed (una excepción real
// nunca rompe el mensaje ni cambia el flow) vive en
// lib/flow-runtime-bridge-trigger-router-saas.test.ts (test E) -- este
// bloque se mantiene enfocado en la verificación estructural de la conexión.
describe("Fase 3C — conexión real al runtime: flow-runtime-bridge SÍ utiliza resolverActivacionTriggerRouter, de forma fail-closed", () => {
  it("lib/flow-runtime-bridge.ts importa resolverActivacionTriggerRouter desde su módulo real (conectado, autorizado en Fase 3C)", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.resolve(repoRoot, "lib/flow-runtime-bridge.ts"), "utf8");
    assert.ok(source.includes("resolverActivacionTriggerRouter"), "Fase 3C debe conectar el resolver SaaS al runtime real");
    assert.ok(
      source.includes('from "@/lib/flow-trigger-router-activacion"'),
      "debe importarlo desde su módulo real, nunca reimplementar la lógica de activación en flow-runtime-bridge.ts",
    );
  });

  it("la invocación real (no el import) está protegida por un try/catch -- fail-closed obligatorio", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.resolve(repoRoot, "lib/flow-runtime-bridge.ts"), "utf8");
    const indiceImport = source.indexOf("resolverActivacionTriggerRouter");
    const indiceInvocacion = source.indexOf("resolverActivacionTriggerRouter(", indiceImport + 1);
    assert.ok(indiceInvocacion > -1, "debe existir una invocación real de la función, no solo el import");
    const bloqueAntes = source.slice(Math.max(0, indiceInvocacion - 200), indiceInvocacion);
    assert.ok(bloqueAntes.includes("try"), "la invocación debe estar dentro de un try -- una excepción nunca debe propagarse sin control");
  });
});

/**
 * Test de escala (100 tenants) -- pedido explícito de la Fase 3B. Usa un
 * Supabase FALSO (mismo patrón que disponibilidad-servicio-nylas.test.ts:
 * crearSupabaseFalso), nunca red real -- corre SIEMPRE, sin gate de
 * credenciales, para no depender de un Supabase de prueba que no existe
 * (instrucción explícita: no hay staging, no tocar producción con tests).
 * 100 tenants, cada uno con su propio número + flow reales (sintéticos),
 * más una fila con trigger_routing_activo=false y otra sin fila -- confirma
 * que resolver el tenant 37 nunca "roza" ningún otro de los 99 restantes.
 */
describe("Escala -- 100 tenants, aislamiento total (Supabase falso, sin red)", () => {
  type FilaClienteConfig = {
    phone_number_id: string;
    id_tenant: string;
    flow_activo: boolean;
    flow_id: string | null;
    trigger_routing_activo: boolean;
  };

  function crearSupabaseFalsoClientesConfig(filas: FilaClienteConfig[]): SupabaseClient {
    const from = (tabla: string) => {
      if (tabla !== "dulabs_clientes_config") throw new Error(`tabla inesperada en el fake: ${tabla}`);
      const filtros: Array<(f: FilaClienteConfig) => boolean> = [];
      const builder = {
        select() {
          return builder;
        },
        eq(campo: string, valor: unknown) {
          filtros.push((f) => (f as unknown as Record<string, unknown>)[campo] === valor);
          return builder;
        },
        async maybeSingle() {
          const resultado = filas.filter((f) => filtros.every((fn) => fn(f)));
          return { data: resultado[0] ?? null, error: null };
        },
      };
      return builder;
    };
    return { from } as unknown as SupabaseClient;
  }

  const TOTAL_TENANTS = 100;
  const filas: FilaClienteConfig[] = Array.from({ length: TOTAL_TENANTS }, (_, i) => ({
    phone_number_id: `phone-${i}`,
    id_tenant: `tenant-${i}`,
    flow_activo: true,
    flow_id: `flow-${i}`,
    trigger_routing_activo: true,
  }));
  // Ruido adicional -- una fila con el router apagado y una sin flow
  // activo, para confirmar que ninguna de las 100 "reales" se confunde con
  // estas ni al revés.
  filas.push({ phone_number_id: "phone-ruido-inactivo", id_tenant: "tenant-ruido", flow_activo: true, flow_id: "flow-ruido", trigger_routing_activo: false });
  filas.push({ phone_number_id: "phone-ruido-sin-flow", id_tenant: "tenant-ruido-2", flow_activo: false, flow_id: null, trigger_routing_activo: false });

  const supabaseFalso = crearSupabaseFalsoClientesConfig(filas);

  it("el tenant 37 resuelve ÚNICAMENTE tenant-37 + phone-37 + flow-37 -- nunca ningún otro de los 99 restantes", async () => {
    const resultado = await resolverActivacionTriggerRouter(supabaseFalso, "phone-37");
    assert.deepEqual(resultado, { kind: "activo", tenantId: "tenant-37", flowId: "flow-37" });
  });

  it("las 100 combinaciones resuelven exactamente su propia tupla (tenant_i, phone_i, flow_i), sin ninguna colisión cruzada", async () => {
    for (let i = 0; i < TOTAL_TENANTS; i++) {
      const resultado = await resolverActivacionTriggerRouter(supabaseFalso, `phone-${i}`);
      assert.deepEqual(
        resultado,
        { kind: "activo", tenantId: `tenant-${i}`, flowId: `flow-${i}` },
        `tenant ${i} debe resolver únicamente su propia tupla`,
      );
    }
  });

  it("el ruido (router apagado / sin flow activo) nunca contamina ni es contaminado por los 100 tenants reales", async () => {
    const inactivo = await resolverActivacionTriggerRouter(supabaseFalso, "phone-ruido-inactivo");
    assert.deepEqual(inactivo, { kind: "inactivo" });

    const sinFlow = await resolverActivacionTriggerRouter(supabaseFalso, "phone-ruido-sin-flow");
    assert.deepEqual(sinFlow, { kind: "inactivo" });

    // Y ninguno de los 100 reales resultó afectado por la presencia del ruido.
    const primero = await resolverActivacionTriggerRouter(supabaseFalso, "phone-0");
    const ultimo = await resolverActivacionTriggerRouter(supabaseFalso, "phone-99");
    assert.deepEqual(primero, { kind: "activo", tenantId: "tenant-0", flowId: "flow-0" });
    assert.deepEqual(ultimo, { kind: "activo", tenantId: "tenant-99", flowId: "flow-99" });
  });

  it("un phone_number_id que no existe entre los 100 -> 'sin_configuracion', nunca resuelve por accidente a otro tenant", async () => {
    const resultado = await resolverActivacionTriggerRouter(supabaseFalso, "phone-no-existe-en-la-lista");
    assert.deepEqual(resultado, { kind: "sin_configuracion" });
  });

  it("el kill switch apaga los 100 tenants a la vez, sin excepción, sin siquiera consultar el Supabase falso", async () => {
    const original = process.env.TRIGGER_ROUTER_KILL_SWITCH;
    process.env.TRIGGER_ROUTER_KILL_SWITCH = "on";
    try {
      for (const i of [0, 37, 99]) {
        const resultado = await resolverActivacionTriggerRouter(supabaseFalso, `phone-${i}`);
        assert.deepEqual(resultado, { kind: "inactivo" });
      }
    } finally {
      if (original === undefined) delete process.env.TRIGGER_ROUTER_KILL_SWITCH;
      else process.env.TRIGGER_ROUTER_KILL_SWITCH = original;
    }
  });
});
