/**
 * Configuración EXPLÍCITA del agente de un número de WhatsApp — fail-closed.
 *
 *   none      -> no hay agente para este número (el webhook sigue como antes)
 *   disabled  -> hay fila pero está apagada (decisión explícita del operador)
 *   invalid   -> hay fila pero no se puede usar con seguridad: el agente NO
 *                corre y el mensaje NO cae a otro bot (ni a la IA legacy)
 *   ok        -> proveedor, modelo, credencial y herramientas válidos
 *
 * Nunca hay proveedor/modelo por defecto: se leen de la fila y se validan
 * contra el registro de proveedores (lib/ia-proveedores/registro.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AIProvider, AIProviderId, AIThinkingLevel } from "@/lib/ia-proveedores/contrato";
import { resolveAIProvider, validateAIProviderConfig, type AIProviderConfigError, type AIProviderFactories } from "@/lib/ia-proveedores/registro";
import { isAgentToolName, type AgentToolName } from "@/lib/agente/nombres-herramientas";
import type { OrderChannel } from "@/lib/catalogo/pedidos/contrato";

/** Configuración del negocio (confiable: la escribe DuLabs). Acotada: nunca el catálogo. */
export const businessConfigSchema = z
  .object({
    nombre_agente: z.string().trim().min(1).max(40).optional(),
    presentacion: z.string().trim().max(300).optional(),
    tono: z.string().trim().max(200).optional(),
    politicas: z.array(z.string().trim().min(1).max(300)).max(12).optional(),
  })
  .strict();

export type BusinessConfig = z.infer<typeof businessConfigSchema>;

/**
 * Topes de costo y abuso del agente (Bloque 14; columna `limites`). Vacío = por defecto.
 * Estrictos: un valor fuera de rango o una clave desconocida invalida la config (fail-closed).
 */
export const agentLimitsSchema = z
  .object({
    turnos_por_minuto_cliente: z.number().int().min(1).max(60).default(8),
    turnos_por_dia_cliente: z.number().int().min(10).max(5_000).default(300),
    tokens_por_dia_negocio: z.number().int().min(100_000).max(2_000_000_000).default(20_000_000),
  })
  .strict();

export type AgentLimitsConfig = z.infer<typeof agentLimitsSchema>;

export interface AgentRuntimeConfig {
  tenantId: string;
  phoneNumberId: string;
  kind: "catalog_sales";
  provider: AIProviderId;
  model: string;
  credentialRef: string;
  thinking: AIThinkingLevel | null;
  tools: AgentToolName[];
  channel: OrderChannel;
  business: BusinessConfig;
  limits: AgentLimitsConfig;
}

export type AgentConfigInvalidReason =
  | AIProviderConfigError
  | "tenant_mismatch"
  | "kind_unsupported"
  | "tools_invalid"
  | "business_config_invalid"
  | "limits_invalid"
  | "row_invalid";

export type AgentConfigResult =
  | { kind: "none" }
  | { kind: "disabled" }
  | { kind: "invalid"; reason: AgentConfigInvalidReason }
  | { kind: "ok"; config: AgentRuntimeConfig };

/** Fila tal como está en la BD (se valida entera antes de usarla). */
const rowSchema = z.object({
  id_tenant: z.string(),
  phone_number_id: z.string(),
  tipo: z.string(),
  habilitado: z.boolean(),
  proveedor: z.unknown(),
  modelo: z.unknown(),
  credencial_ref: z.unknown(),
  nivel_razonamiento: z.enum(["minimal", "low", "medium", "high"]).nullable(),
  herramientas: z.array(z.string()),
  canal: z.enum(["retail", "wholesale"]),
  negocio: z.unknown(),
  /** Bloque 14: puede faltar (fila leída antes de la migración de límites). */
  limites: z.unknown().optional(),
});

export type AgentConfigRow = z.input<typeof rowSchema>;

export interface AgentConfigStore {
  /** null = no hay fila para ese número. */
  getByPhoneNumber(phoneNumberId: string): Promise<AgentConfigRow | null>;
}

/** Interpreta una fila (puro, sin red). */
export function parseAgentConfig(raw: unknown, expected: { tenantId: string; phoneNumberId: string }): AgentConfigResult {
  const row = rowSchema.safeParse(raw);
  if (!row.success) return { kind: "invalid", reason: "row_invalid" };
  const r = row.data;
  // El número ya identificó al negocio en el webhook: una fila de OTRO negocio para este número es un error grave.
  if (r.id_tenant !== expected.tenantId || r.phone_number_id !== expected.phoneNumberId) return { kind: "invalid", reason: "tenant_mismatch" };
  if (!r.habilitado) return { kind: "disabled" };
  if (r.tipo !== "catalog_sales") return { kind: "invalid", reason: "kind_unsupported" };
  const provider = validateAIProviderConfig({ provider: r.proveedor, model: r.modelo, credentialRef: r.credencial_ref });
  if (!provider.ok) return { kind: "invalid", reason: provider.reason };
  const tools = [...new Set(r.herramientas)];
  if (tools.length === 0 || !tools.every(isAgentToolName)) return { kind: "invalid", reason: "tools_invalid" };
  const business = businessConfigSchema.safeParse(r.negocio);
  if (!business.success) return { kind: "invalid", reason: "business_config_invalid" };
  const limits = agentLimitsSchema.safeParse(r.limites ?? {});
  if (!limits.success) return { kind: "invalid", reason: "limits_invalid" };
  return {
    kind: "ok",
    config: {
      tenantId: r.id_tenant,
      phoneNumberId: r.phone_number_id,
      kind: "catalog_sales",
      provider: provider.providerId,
      model: provider.model,
      credentialRef: r.credencial_ref as string,
      thinking: r.nivel_razonamiento,
      tools: tools as AgentToolName[],
      channel: r.canal,
      business: business.data,
      limits: limits.data,
    },
  };
}

export async function loadAgentConfig(store: AgentConfigStore, expected: { tenantId: string; phoneNumberId: string }): Promise<AgentConfigResult> {
  const row = await store.getByPhoneNumber(expected.phoneNumberId);
  if (!row) return { kind: "none" };
  return parseAgentConfig(row, expected);
}

/** Construye el proveedor de ESTA configuración (sin fallback). La credencial se lee del entorno del servidor. */
export function providerForConfig(
  config: AgentRuntimeConfig,
  deps: { env?: Record<string, string | undefined>; factories?: Partial<AIProviderFactories> } = {},
): { ok: true; provider: AIProvider; model: string } | { ok: false; reason: AIProviderConfigError } {
  const r = resolveAIProvider({ provider: config.provider, model: config.model, credentialRef: config.credentialRef }, deps);
  return r.ok ? { ok: true, provider: r.provider, model: r.model } : r;
}

// ---------------------------------------------------------------------------

const COLUMNS = "id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, nivel_razonamiento, herramientas, canal, negocio";
const MISSING_SCHEMA = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

export function createSupabaseAgentConfigStore(supabase: SupabaseClient): AgentConfigStore {
  return {
    async getByPhoneNumber(phoneNumberId) {
      let { data, error } = await supabase.from("dulabs_agente_runtime_config").select(`${COLUMNS}, limites`).eq("phone_number_id", phoneNumberId).maybeSingle();
      // Sin la migración de límites (columna inexistente): se lee sin ella y aplican los topes por defecto.
      // Nunca se trata como "sin agente": eso haría caer el número a otro bot.
      if (error && (error.code === "42703" || error.code === "PGRST204")) {
        ({ data, error } = await supabase.from("dulabs_agente_runtime_config").select(COLUMNS).eq("phone_number_id", phoneNumberId).maybeSingle());
      }
      if (error) {
        // Sin la migración: no hay agentes configurados (todo sigue como antes).
        if (MISSING_SCHEMA.has(error.code ?? "")) return null;
        throw new Error(`[agente/config] ${error.code ?? "?"}`);
      }
      return (data as AgentConfigRow | null) ?? null;
    },
  };
}

export function createMemoryAgentConfigStore(rows: AgentConfigRow[] = []): AgentConfigStore & { rows: AgentConfigRow[] } {
  return {
    rows,
    async getByPhoneNumber(phoneNumberId) {
      return rows.find((r) => r.phone_number_id === phoneNumberId) ?? null;
    },
  };
}
