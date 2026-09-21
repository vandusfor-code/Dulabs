/**
 * Carga de los HECHOS reales del tenant que necesita el validador final (R8). Solo consulta lo que el Spec usa
 * (si el agente no agenda, no se toca el calendario). El tenant llega SIEMPRE de la sesión (lo pasa el route).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { ReadinessFacts } from "@/lib/business-agent-readiness";
import { countActiveProducts } from "@/lib/business-agent-products-store";
import { hasUsableKnowledge } from "@/lib/business-agent-knowledge/service";
import { createSupabaseKnowledgeStore } from "@/lib/business-agent-knowledge/store-supabase";
import { createSupabaseCalendarStore } from "@/lib/agent-compiler/calendar/calendar-store-supabase";
import { createSupabaseCatalogStore } from "@/lib/business-agent-catalog-store";
import { detectDomainCapabilities } from "@/lib/flow/external-claim-security";
import { assessClaimRisk } from "@/lib/business-agent-knowledge/claim-risk";

export async function loadReadinessFacts(supabase: SupabaseClient, tenantId: string, spec: BusinessAgentSpec): Promise<ReadinessFacts> {
  const caps = spec.capabilities;
  const necesitaServicios = caps.scheduling || caps.catalog;
  const necesitaProductos = caps.catalog && spec.catalog.useProducts;
  const necesitaCalendario = caps.scheduling && spec.scheduling.provider === "nylas";

  // Nombres que el agente mostraría en catálogo/cotización: si el filtro de afirmaciones los bloquearía, se avisa al autor.
  const revisaNombres = caps.catalog || caps.sales;
  const [activeServices, activeProducts, hasKnowledge, calendarConnected, catalogNamesAtRisk, faqsAtRisk] = await Promise.all([
    necesitaServicios
      ? supabase
          .from("dulabs_servicios")
          .select("id", { count: "exact", head: true })
          .eq("id_tenant", tenantId)
          .eq("activo", true)
          .then(({ count, error }) => {
            if (error) throw error;
            return count ?? 0;
          })
      : Promise.resolve(0),
    necesitaProductos ? countActiveProducts(supabase, tenantId) : Promise.resolve(0),
    caps.faq ? hasUsableKnowledge(createSupabaseKnowledgeStore(supabase), tenantId) : Promise.resolve(false),
    necesitaCalendario
      ? createSupabaseCalendarStore(supabase)
          .getConnection(tenantId)
          .then((c) => !!c && c.status === "connected" && !!c.grantId && !!c.selectedCalendarId)
      : Promise.resolve(false),
    revisaNombres ? nombresConRiesgo(supabase, tenantId, spec) : Promise.resolve([] as string[]),
    caps.faq ? faqsConRiesgo(supabase, tenantId) : Promise.resolve([] as string[]),
  ]);

  return { activeServices, activeProducts, hasKnowledge, calendarConnected, catalogNamesAtRisk, faqsAtRisk };
}

/** Nombres activos del catálogo (servicios y/o productos según el Spec) que el filtro de afirmaciones del runtime bloquearía. */
async function nombresConRiesgo(supabase: SupabaseClient, tenantId: string, spec: BusinessAgentSpec): Promise<string[]> {
  const store = createSupabaseCatalogStore(supabase);
  const usaServicios = spec.catalog.useServices || !spec.catalog.useProducts;
  const [servicios, productos] = await Promise.all([
    usaServicios ? store.listarServicios(tenantId) : Promise.resolve([]),
    spec.catalog.useProducts ? store.listarProductos(tenantId) : Promise.resolve([]),
  ]);
  return [...servicios, ...productos].map((i) => i.nombre).filter((n) => detectDomainCapabilities(n).length > 0);
}

/** Preguntas de FAQ activas cuya respuesta el filtro de afirmaciones del runtime bloquearía (el cliente vería un mensaje genérico). */
async function faqsConRiesgo(supabase: SupabaseClient, tenantId: string): Promise<string[]> {
  const faqs = await createSupabaseKnowledgeStore(supabase).listFaqs(tenantId);
  return faqs.filter((f) => f.active && assessClaimRisk(f.answer).risky).map((f) => f.question);
}
