// DuLabs Business — Agent Compiler, Step 8 — resolución del Business Agent.
//
// PORT que resuelve, de forma inequívoca y tenant-scoped, si un número de
// WhatsApp está atendido por un Business Agent PUBLICADO y ACTIVO, y devuelve
// el artefacto compilado necesario para ejecutarlo (flow publicado + versión
// pineada + gate rules + checksum). El tenant JAMÁS proviene del mensaje del
// usuario ni del LLM: proviene de la fila real de dulabs_clientes_config (el
// caller ya la leyó antes de invocar esto — ver atender-business-agent.ts).
//
// FRONTERA (fail-closed): si la resolución no es inequívoca (sin agente, sin
// versión publicada, sin artefactos, checksum inconsistente), se devuelve
// `none` y el llamador continúa por el runtime LEGACY existente — nunca se
// ejecuta un agente adivinado. Un ERROR real de infraestructura (DB caída,
// query fallida) SE PROPAGA (throw) en vez de degradar a `none`: confundir
// "no hay agente" con "no pude verificar si hay agente" dejaría a un tenant
// con Business Agent real cayendo a Legacy en silencio ante un problema de
// infra — la barrera de fail-closed del runtime (agent-runtime.ts) ya maneja
// una excepción del resolver como error explícito, no como bypass silencioso.
//
// Implementado sobre el Business Agent Registry (Step 8A, lib/agent-compiler/
// registry/) — dulabs_business_agent_versions + dulabs_flows/dulabs_flow_versions
// reutilizados sin cambios.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteConfig } from "@/lib/supabase";
import type { FlowDefinition } from "@/lib/flow/types";
import type { GateRule } from "@/lib/agent-compiler/runtime/guardrail-gate";
import { checksumOf } from "@/lib/agent-compiler/checksum";
import { createSupabaseBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/registry-store-supabase";
import type { BusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/types";

/** Datos mínimos del número necesarios para resolver (subconjunto de ClienteConfig). */
export type ClienteResolucion = Pick<ClienteConfig, "phone_number_id" | "id_tenant" | "flow_activo" | "flow_id">;

/** Business Agent resuelto y listo para ejecutar. */
export interface ResolvedBusinessAgent {
  kind: "business_agent";
  tenantId: string;
  /** dulabs_flows.id del flow publicado (compilado desde un BusinessAgentSpec). */
  flowId: string;
  /** Versión publicada pineada al resolver (el orquestador la fija al crear la ejecución). */
  flowVersionId: string;
  /** Identidad del artefacto compilado (checksum del FlowDefinition). */
  checksum: string;
  /** Reglas del Business Guardrail Gate (derivadas de la IR en publicación). */
  gateRules: GateRule[];
  /** FlowDefinition compilado (para validación defensiva; el orquestador lo carga del store). */
  flow?: FlowDefinition;
}

export type BusinessAgentResolution =
  | ResolvedBusinessAgent
  | { kind: "none"; reason: BusinessAgentNoneReason };

export type BusinessAgentNoneReason =
  | "registry_not_available"
  | "not_business_agent"
  | "not_published"
  | "not_active"
  | "checksum_mismatch"
  | "tenant_unresolved";

export interface BusinessAgentResolver {
  resolve(supabase: SupabaseClient, cliente: ClienteResolucion): Promise<BusinessAgentResolution>;
}

/**
 * Resolver Supabase real sobre el Business Agent Registry.
 *   1. flow_activo/flow_id (ya leídos por el caller de dulabs_clientes_config)
 *      determinan si este número tiene ALGÚN flow vinculado.
 *   2. resolvePublishedVersion carga la versión PUBLICADA del flow tenant-scoped
 *      — `null` si el flow no está publicado o si es un flow hand-built sin
 *      artefactos de Business Agent (Flow Studio, sin Gate).
 *   3. Se recalcula el checksum del FlowDefinition persistido y se compara con
 *      el checksum guardado al compilar tiempo de publish -- detecta
 *      corrupción/tampering de definition_json fuera del pipeline del compiler.
 *   4. Se re-verifica igualdad de tenant como defensa en profundidad (aunque
 *      cada query del store ya es tenant-scoped).
 *
 * `store` es inyectable para tests (mismo patrón que el resto del Compiler).
 */
export function createSupabaseBusinessAgentResolver(deps: { store?: BusinessAgentRegistryStore } = {}): BusinessAgentResolver {
  return {
    async resolve(supabase, cliente): Promise<BusinessAgentResolution> {
      if (!cliente.flow_activo || !cliente.flow_id) {
        return { kind: "none", reason: "not_active" };
      }

      const store = deps.store ?? createSupabaseBusinessAgentRegistryStore(supabase);
      const version = await store.resolvePublishedVersion(cliente.id_tenant, cliente.flow_id);

      if (!version) {
        // Ambiguo a propósito para el caller (Legacy en cualquier caso): puede
        // ser "flow no publicado todavía" o "flow hand-built sin Gate".
        return { kind: "none", reason: "not_published" };
      }

      if (version.tenantId !== cliente.id_tenant) {
        return { kind: "none", reason: "tenant_unresolved" };
      }

      if (version.validationStatus !== "validated") {
        return { kind: "none", reason: "not_business_agent" };
      }

      const recomputedChecksum = checksumOf(version.flow);
      if (recomputedChecksum !== version.flowChecksum) {
        return { kind: "none", reason: "checksum_mismatch" };
      }

      return {
        kind: "business_agent",
        tenantId: version.tenantId,
        flowId: version.flowId,
        flowVersionId: version.flowVersionId,
        checksum: version.flowChecksum,
        gateRules: version.gateRules,
        flow: version.flow,
      };
    },
  };
}
