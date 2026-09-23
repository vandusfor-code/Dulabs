/**
 * Frontera webhook -> agente conversacional (Fase 8).
 *
 * Se invoca desde app/webhook-dulabs/route.ts (atenderMensaje) DESPUÉS de las
 * guardas existentes (lista negra, ia_pausada, ia_restringida_a, pausa humana,
 * cupo, freno de ráfaga, candado del chat) y ANTES de Business Agent / Flow /
 * IA legacy.
 *
 *   sin fila de agente para el número  -> handled:false (todo sigue como antes)
 *   fila apagada                        -> handled:true, silencio (NO cae a otro bot)
 *   fila inválida / sin credencial      -> handled:true, silencio + error registrado
 *                                          (fail-closed: nunca cae a la IA legacy
 *                                          ni cambia de proveedor)
 *   fila válida                         -> el agente atiende el turno
 *
 * Así, un número configurado con Gemini jamás termina respondido por Claude.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteConfig } from "@/lib/supabase";
import { chatEnPausaHumana } from "@/lib/pausas-chat";
import { enviarMedia, enviarTexto } from "@/lib/whatsapp";
import { incrementarUsoMensajes, registrarMensaje, resolverTokenMeta } from "@/lib/whatsapp-outbound";
import { contactRef } from "@/lib/catalogo/pedidos/log";
import { productionAgentToolDeps } from "@/lib/catalogo/pedidos/produccion";
import { createGeminiProvider } from "@/lib/ia-proveedores/gemini";
import type { AIProviderFactories } from "@/lib/ia-proveedores/registro";
import { createSupabaseAgentConfigStore, loadAgentConfig, providerForConfig, type AgentConfigStore } from "@/lib/agente/config";
import { createSupabaseHistoryStore } from "@/lib/agente/contexto";
import { createSupabaseConversationStateStore } from "@/lib/agente/estado";
import type { AgentToolsDeps } from "@/lib/agente/herramientas";
import { runAgentTurn, type AgentRuntimeDeps, type AgentSender, type AgentTurnTrace } from "@/lib/agente/runtime";

export interface AgentBoundaryInput {
  cliente: Pick<ClienteConfig, "id_tenant" | "phone_number_id">;
  /** wa_id del remitente (identidad del contacto). */
  waId: string;
  /** Número al que se responde (puede diferir del wa_id en casos de Meta). */
  destino: string;
  wamid: string;
  text: string;
}

export type AgentBoundaryResult =
  | { handled: false; reason: "no_agent" }
  | { handled: true; outcome: "disabled" | "invalid_config" | "unavailable" | AgentTurnTrace["outcome"]; reason?: string };

export interface AgentBoundaryDeps {
  configStore: AgentConfigStore;
  /** Construye el resto de dependencias solo si hay un agente válido (evita trabajo para los demás números). */
  build(input: AgentBoundaryInput): Omit<AgentRuntimeDeps, "config" | "provider" | "model"> | null;
  env?: Record<string, string | undefined>;
  factories?: Partial<AIProviderFactories>;
  logError?: (entry: Record<string, unknown>) => void;
}

const defaultLogError = (entry: Record<string, unknown>) => console.error(JSON.stringify({ log: "agent_boundary", ...entry }));

export async function atenderConAgenteSiAplica(input: AgentBoundaryInput, deps: AgentBoundaryDeps): Promise<AgentBoundaryResult> {
  const logError = deps.logError ?? defaultLogError;
  const base = { business_id: input.cliente.id_tenant, contact_ref: contactRef(input.waId) };
  const expected = { tenantId: input.cliente.id_tenant, phoneNumberId: input.cliente.phone_number_id };
  let cfg;
  try {
    cfg = await loadAgentConfig(deps.configStore, expected).catch(() => loadAgentConfig(deps.configStore, expected));
  } catch {
    // Ni con un reintento se pudo saber si hay agente: fail-closed (no se arriesga a que responda otro bot).
    logError({ ...base, result: "config_unreadable" });
    return { handled: true, outcome: "unavailable", reason: "config_unreadable" };
  }
  if (cfg.kind === "none") return { handled: false, reason: "no_agent" };
  if (cfg.kind === "disabled") return { handled: true, outcome: "disabled" };
  if (cfg.kind === "invalid") {
    logError({ ...base, result: "invalid_config", reason: cfg.reason });
    return { handled: true, outcome: "invalid_config", reason: cfg.reason };
  }
  const provider = providerForConfig(cfg.config, { env: deps.env, factories: deps.factories });
  if (!provider.ok) {
    logError({ ...base, result: "invalid_config", reason: provider.reason, provider: cfg.config.provider });
    return { handled: true, outcome: "invalid_config", reason: provider.reason };
  }
  const rest = deps.build(input);
  if (!rest) {
    logError({ ...base, result: "unavailable", reason: "runtime_deps_unavailable" });
    return { handled: true, outcome: "unavailable", reason: "runtime_deps_unavailable" };
  }
  const r = await runAgentTurn(
    { ...rest, config: cfg.config, provider: provider.provider, model: provider.model },
    { tenantId: input.cliente.id_tenant, phoneNumberId: input.cliente.phone_number_id, waId: input.waId, wamid: input.wamid, text: input.text },
  );
  return { handled: true, outcome: r.outcome };
}

// ---------------------------------------------------------------------------
// Producción
// ---------------------------------------------------------------------------

/** Envío real por WhatsApp Cloud API; registra en el historial (origen "ia") y cuenta el uso, igual que enviarWhatsApp. */
function whatsappSender(supabase: SupabaseClient, cliente: ClienteConfig, input: AgentBoundaryInput): AgentSender {
  const simulated = process.env.NODE_ENV !== "production" && process.env.DULABS_AGENTE_ENVIO_SIMULADO === "1";
  return {
    async sendText(text) {
      let wamid: string | null = null;
      if (!simulated) {
        const token = resolverTokenMeta(cliente);
        if (!token) return false;
        try {
          ({ wamid } = await enviarTexto({ phoneNumberId: cliente.phone_number_id, token, para: input.destino, texto: text }));
        } catch {
          return false;
        }
        await incrementarUsoMensajes(supabase, cliente);
      }
      await registrarMensaje(supabase, cliente.phone_number_id, input.waId, "saliente", text, "ia", wamid ?? undefined);
      return true;
    },
    async sendImage(image) {
      let wamid: string | null = null;
      if (!simulated) {
        const token = resolverTokenMeta(cliente);
        if (!token) return false;
        try {
          ({ wamid } = await enviarMedia({ phoneNumberId: cliente.phone_number_id, token, para: input.destino, tipo: "image", link: image.url, caption: image.caption }));
        } catch {
          return false;
        }
        await incrementarUsoMensajes(supabase, cliente);
      }
      await registrarMensaje(supabase, cliente.phone_number_id, input.waId, "saliente", `[imagen] ${image.caption}`, "ia", wamid ?? undefined);
      return true;
    },
    humanTookOver: () => chatEnPausaHumana(supabase, cliente.phone_number_id, input.waId),
  };
}

async function nombreConocido(supabase: SupabaseClient, key: { phoneNumberId: string; waId: string }): Promise<string | null> {
  const { data } = await supabase.from("dulabs_clientes_conocidos").select("nombre").eq("phone_number_id", key.phoneNumberId).eq("telefono_cliente", key.waId).maybeSingle();
  const nombre = (data as { nombre?: string } | null)?.nombre?.trim();
  return nombre ? nombre.slice(0, 60) : null;
}

export function productionAgentBoundaryDeps(supabase: SupabaseClient, cliente: ClienteConfig): AgentBoundaryDeps {
  // Solo fuera de producción: E2E local contra un Gemini simulado por HTTP. En producción siempre la URL oficial.
  const baseUrl = process.env.NODE_ENV !== "production" ? process.env.DULABS_GEMINI_BASE_URL : undefined;
  return {
    configStore: createSupabaseAgentConfigStore(supabase),
    factories: baseUrl ? { gemini: (apiKey) => createGeminiProvider({ apiKey, baseUrl }) } : undefined,
    build(input) {
      const catalogDeps = productionAgentToolDeps(supabase);
      if (!catalogDeps) return null;
      const tools: AgentToolsDeps = { ...catalogDeps, customerName: (k) => nombreConocido(supabase, k) };
      return {
        tools,
        state: createSupabaseConversationStateStore(supabase),
        history: createSupabaseHistoryStore(supabase),
        sender: whatsappSender(supabase, cliente, input),
        log: (trace) => console.info(JSON.stringify(trace)),
      };
    },
  };
}
