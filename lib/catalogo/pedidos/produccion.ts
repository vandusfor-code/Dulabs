/**
 * Cableado de PRODUCCIÓN del motor de pedidos (Supabase service_role).
 * Reutiliza lo existente: repositorio del catálogo, clave de firma de la
 * Fase 6, pausa por chat (dulabs_pausas_chat) y estado de conversación del
 * Inbox. Las pruebas arman el motor con repositorios en memoria.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { actualizarEstadoConversacion } from "@/lib/conversacion-estado";
import { extenderPausaChat } from "@/lib/pausas-chat";
import { orderSigningKey } from "@/lib/catalogo/pedido-firma";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import type { AgentToolDeps } from "@/lib/catalogo/pedidos/herramientas";
import type { IntakeDeps } from "@/lib/catalogo/pedidos/intake";
import { createOrderEngine, type HumanHandoffPort, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createSupabaseOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";

/** Igual que transferir_soporte del Flow: la IA calla 24 h en ESE chat (la asesora la devuelve antes desde el Inbox). */
const PAUSA_HANDOFF_MS = 24 * 60 * 60 * 1000;

export function supabaseHandoffPort(supabase: SupabaseClient): HumanHandoffPort {
  return {
    async pauseConversation({ contact }) {
      // Nunca acorta una pausa más larga: si una asesora ya tomó el chat (30 días), sigue suya.
      const pausa = await extenderPausaChat(supabase, contact.phoneNumberId, contact.waId, PAUSA_HANDOFF_MS);
      if (!pausa.ok) return { ok: false };
      // "pending" en el Inbox (si la migración del estado no está, la pausa ya basta). Si una
      // persona ya la tenía, no se le cambia el estado que ella decidió.
      if (pausa.efecto !== "ya_mas_larga") {
        await actualizarEstadoConversacion(supabase, { phoneNumberId: contact.phoneNumberId, telefonoCliente: contact.waId, estado: "pending" });
      }
      return { ok: true };
    },
  };
}

// Una instancia por proceso: la sonda de disponibilidad queda en caché 60 s.
let cached: { supabase: SupabaseClient; engine: OrderEngine } | null = null;

/** null = sin clave de firma (no se pueden derivar ids): la entrada de pedidos queda inactiva. */
export function productionOrderEngine(supabase: SupabaseClient): OrderEngine | null {
  if (cached?.supabase === supabase) return cached.engine;
  const key = orderSigningKey();
  if (!key) return null;
  const engine = createOrderEngine({
    orders: createSupabaseOrdersRepository(supabase),
    catalog: createSupabaseCatalogRepository(supabase),
    key,
    handoff: supabaseHandoffPort(supabase),
  });
  cached = { supabase, engine };
  return engine;
}

export function productionIntakeDeps(supabase: SupabaseClient): IntakeDeps | null {
  const engine = productionOrderEngine(supabase);
  if (!engine) return null;
  const catalog = createSupabaseCatalogRepository(supabase);
  return { engine, isModuleEnabled: (tenantId) => catalog.isModuleEnabled(tenantId) };
}

/** Dependencias de las herramientas del agente (para el runtime que las exponga al modelo). */
export function productionAgentToolDeps(supabase: SupabaseClient): AgentToolDeps | null {
  const engine = productionOrderEngine(supabase);
  if (!engine) return null;
  return {
    engine,
    catalog: createSupabaseCatalogRepository(supabase),
    async ownsPhoneNumber(tenantId, phoneNumberId) {
      const { data, error } = await supabase.from("dulabs_clientes_config").select("id").eq("id_tenant", tenantId).eq("phone_number_id", phoneNumberId).limit(1);
      if (error) throw new Error(`[catalogo/pedidos] ownsPhoneNumber: ${error.code ?? "?"}`);
      return (data ?? []).length === 1;
    },
  };
}
