/**
 * Validador FINAL de publicación del Business Agent (R8) — PURO y determinista.
 *
 * Responde a "¿este agente PUEDE funcionar de verdad?" según las capacidades que el negocio eligió y los DATOS reales
 * que tiene hoy (servicios, productos, conocimiento, calendario conectado). Es la ÚNICA fuente de verdad de esas reglas:
 *   - el servidor la usa como gate de publicación (app/api/business-agent/publish): un agente que no puede funcionar no
 *     se publica, no importa lo que haga la UI;
 *   - el endpoint /api/business-agent/readiness la usa para el panel "Tu agente está configurado para…" (bloqueos,
 *     advertencias y resumen), de modo que la pantalla muestra exactamente lo que el servidor va a exigir.
 *
 * Las reglas estructurales del Spec (esquema, coherencia entre capacidades, horario con al menos un día abierto, datos
 * del cliente…) siguen en spec/validate.ts; esto agrega lo que depende de DATOS del negocio y de su infraestructura.
 *
 * No hay capacidad "solo UI": orders/payments no están disponibles y se bloquean; nada se publica prometiendo algo que el
 * runtime no hace.
 */
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { tieneAlgunHorarioAbierto } from "@/lib/business-hours";
import { CAPABILITY_BACKING, type CapabilityKey } from "@/lib/agent-compiler/spec/capabilities";

export type ReadinessSeverity = "blocker" | "warning";

export interface ReadinessIssue {
  code: string;
  severity: ReadinessSeverity;
  capability: CapabilityKey | "general";
  /** Texto para el negocio (claro, sin jerga técnica). */
  message: string;
  /** Paso del Wizard donde se arregla (mismos ids que wizardStepOrder). */
  step?: "capacidades" | "servicios" | "agendamiento" | "horarios" | "datos" | "conocimiento" | "reglas" | "handoff";
}

/** Hechos REALES del tenant que el servidor carga (solo los que el Spec necesita). */
export interface ReadinessFacts {
  activeServices: number;
  activeProducts: number;
  /** Hay al menos una FAQ activa o un documento ya procesado. */
  hasKnowledge: boolean;
  /** Calendario Nylas conectado y con un calendario seleccionado. */
  calendarConnected: boolean;
  /**
   * Nombres de servicios/productos ACTIVOS que el filtro de afirmaciones del runtime podría bloquear (contienen "cita",
   * "reserva", "pago"...): el agente no podría mostrar el catálogo ni la cotización. Opcional: si no se calcula, no avisa.
   */
  catalogNamesAtRisk?: string[];
  /**
   * Preguntas de FAQ ACTIVAS cuya respuesta el filtro de afirmaciones del runtime bloquearía (contiene "cita", "reserva",
   * "disponible", "pago"...): el cliente recibiría un mensaje genérico en vez de la respuesta. Opcional: si no se calcula, no avisa.
   */
  faqsAtRisk?: string[];
}

export interface ReadinessSummaryItem {
  capability: CapabilityKey;
  label: string;
  details: string[];
}

export interface ReadinessReport {
  ready: boolean;
  blockers: ReadinessIssue[];
  warnings: ReadinessIssue[];
  summary: ReadinessSummaryItem[];
}

const PROVIDER_LABEL: Record<string, string> = { nylas: "Google Calendar (Nylas)", internal: "especialistas de DuLabs", google_calendar: "Google Calendar", none: "sin proveedor" };

function diasConHorario(spec: BusinessAgentSpec): number {
  const week = spec.scheduling.businessHours?.week ?? [];
  return week.filter((d) => d && !d.closed && (d.intervals ?? []).length > 0).length;
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

export function evaluateReadiness(spec: BusinessAgentSpec, facts: ReadinessFacts): ReadinessReport {
  const caps = spec.capabilities;
  const issues: ReadinessIssue[] = [];
  const bloqueo = (code: string, capability: ReadinessIssue["capability"], message: string, step?: ReadinessIssue["step"]) =>
    issues.push({ code, severity: "blocker", capability, message, step });
  const aviso = (code: string, capability: ReadinessIssue["capability"], message: string, step?: ReadinessIssue["step"]) =>
    issues.push({ code, severity: "warning", capability, message, step });

  // ---- Capacidades sin runtime real: nunca se publica una promesa vacía ----
  for (const k of ["orders", "payments"] as const) {
    if (caps[k] && !CAPABILITY_BACKING[k].available) {
      bloqueo("CAPABILITY_UNAVAILABLE", k, k === "orders" ? "Tomar pedidos todavía no está disponible: el agente no puede hacerlo. Desactívalo para publicar." : "Cobrar todavía no está disponible: el agente no puede hacerlo. Desactívalo para publicar.", "capacidades");
    }
  }

  // ---- Servicios: los necesita quien agenda (duración/precio) o quien muestra SERVICIOS en el catálogo ----
  const catalogoUsaServicios = caps.catalog && (spec.catalog.useServices || !spec.catalog.useProducts);
  if ((caps.scheduling || catalogoUsaServicios) && facts.activeServices === 0) {
    bloqueo("MISSING_SERVICES", caps.scheduling ? "scheduling" : "catalog", "Para publicar con catálogo o agendamiento necesitas al menos un servicio activo. Agrégalo en el paso Servicios.", "servicios");
  }

  // ---- Agendamiento ----
  if (caps.scheduling) {
    if (spec.scheduling.provider === "nylas") {
      if (!tieneAlgunHorarioAbierto(spec.scheduling.businessHours)) {
        bloqueo("BUSINESS_HOURS_MISSING", "scheduling", "Configura tu horario de atención (al menos un día abierto): el agente no reserva fuera de él.", "horarios");
      }
      if (!facts.calendarConnected) {
        bloqueo("CALENDAR_NOT_CONNECTED", "scheduling", "Conecta tu Google Calendar en la pestaña Calendario: sin un calendario real el agente no puede consultar disponibilidad ni reservar.", "agendamiento");
      }
    } else if (spec.scheduling.provider === "internal") {
      aviso("INTERNAL_PROVIDER_SPECIALISTS", "scheduling", "Con el proveedor Interno el agente reserva con los especialistas configurados en DuLabs: asegúrate de tenerlos cargados. Para cancelar/cambiar citas por WhatsApp usa Google Calendar (Nylas).", "agendamiento");
    }
    if (spec.scheduling.cancellation.allowed && spec.scheduling.provider !== "nylas") {
      aviso("CANCELLATION_NOT_APPLICABLE", "scheduling", "'Permitir cancelar y cambiar citas' solo actúa con Google Calendar (Nylas); con el proveedor actual no hará nada.", "agendamiento");
    }
  }

  // ---- Catálogo ----
  if (caps.catalog) {
    if (!spec.catalog.useServices && !spec.catalog.useProducts) {
      bloqueo("CATALOG_SOURCE_MISSING", "catalog", "Elige qué muestra el catálogo: servicios y/o productos.", "capacidades");
    }
    if (spec.catalog.useProducts && facts.activeProducts === 0) {
      bloqueo("MISSING_PRODUCTS", "catalog", "Para publicar con catálogo de productos necesitas al menos un producto activo. Agrégalo en el paso Productos.", "servicios");
    }
  }

  // ---- Nombres del catálogo que el filtro de seguridad bloquearía (el cliente no vería el catálogo/cotización) ----
  if ((caps.catalog || caps.sales) && (facts.catalogNamesAtRisk?.length ?? 0) > 0) {
    const nombres = facts.catalogNamesAtRisk!.slice(0, 5).map((n) => `«${n}»`).join(", ");
    aviso(
      "CATALOG_NAME_CLAIM_RISK",
      caps.catalog ? "catalog" : "sales",
      `Estos nombres contienen palabras que el filtro de seguridad del agente puede bloquear (cita, reserva, agendar, pago...): ${nombres}. Si se bloquean, el cliente no verá el catálogo ni la cotización. Renómbralos (p. ej. «Valoración» en vez de «Cita de valoración»).`,
      "servicios",
    );
  }

  // ---- Respuestas de FAQ que el filtro de seguridad bloquearía (el cliente vería un mensaje genérico) ----
  if (caps.faq && (facts.faqsAtRisk?.length ?? 0) > 0) {
    const preguntas = facts.faqsAtRisk!.slice(0, 5).map((q) => `«${q}»`).join(", ");
    aviso(
      "FAQ_ANSWER_CLAIM_RISK",
      "faq",
      `Estas respuestas de preguntas frecuentes contienen palabras que el filtro de seguridad del agente puede bloquear (cita, reserva, disponible, pago...): ${preguntas}. Si se bloquean, el cliente recibe un mensaje genérico en vez de la respuesta. Reescríbelas sin esas palabras (p. ej. «Escríbenos por aquí lo que necesitas y con gusto te ayudamos»).`,
      "conocimiento",
    );
  }

  // ---- Cotizar: no cobra ni toma pedidos ----
  if (caps.sales && !caps.humanHandoff) {
    aviso("SALES_NO_HANDOFF", "sales", "El agente cotiza pero no puede concretar la compra: no cobra ni toma pedidos. Activa 'Transferir a un humano' para que el cliente siga con tu equipo.", "capacidades");
  }

  // ---- Preguntas frecuentes ----
  if (caps.faq && !facts.hasKnowledge) {
    bloqueo("MISSING_KNOWLEDGE", "faq", "Para publicar con preguntas frecuentes necesitas al menos una pregunta activa o un documento procesado. Agrégalos en el paso Conocimiento.", "conocimiento");
  }

  // ---- Transferencia a humano ----
  if (caps.humanHandoff) {
    const reglas = spec.handoff.rules.length > 0 || spec.policies.prohibitions.some((p) => p.action === "TRANSFER_HUMAN");
    const automaticos = caps.scheduling || (caps.faq && spec.knowledge.onNoAnswer === "handoff") || (caps.catalog && caps.sales);
    if (!reglas && !automaticos) {
      bloqueo("HANDOFF_NO_TRIGGER", "humanHandoff", "'Transferir a un humano' está activo pero nada lo dispara. Agrega una regla (p. ej. 'El cliente pide hablar con una persona') o activa la transferencia cuando no hay información.", "handoff");
    } else if (!reglas) {
      aviso("HANDOFF_NO_CUSTOMER_REQUEST", "humanHandoff", "El agente solo transferirá cuando algo falle: si el cliente pide hablar con una persona no habrá transferencia. Agrega la regla 'El cliente pide hablar con una persona'.", "handoff");
    }
  }

  const blockers = issues.filter((i) => i.severity === "blocker");
  const warnings = issues.filter((i) => i.severity === "warning");
  return { ready: blockers.length === 0, blockers, warnings, summary: resumen(spec, facts) };
}

function resumen(spec: BusinessAgentSpec, facts: ReadinessFacts): ReadinessSummaryItem[] {
  const caps = spec.capabilities;
  const out: ReadinessSummaryItem[] = [];

  if (caps.scheduling) {
    const d: string[] = [`Con ${PROVIDER_LABEL[spec.scheduling.provider] ?? spec.scheduling.provider}`];
    d.push(plural(facts.activeServices, "servicio activo", "servicios activos"));
    const dias = diasConHorario(spec);
    if (dias > 0) d.push(`Horario de atención ${plural(dias, "día", "días")} a la semana`);
    d.push(`Aviso mínimo: ${spec.scheduling.minNoticeMinutes} min`);
    if (spec.scheduling.provider === "nylas") {
      d.push(spec.scheduling.cancellation.allowed ? `El cliente puede cancelar o cambiar su cita hasta ${spec.scheduling.cancellation.minNoticeHours} h antes` : "El cliente no puede cancelar ni cambiar citas por WhatsApp");
    }
    out.push({ capability: "scheduling", label: "Agendar citas", details: d });
  }
  if (caps.catalog) {
    const d: string[] = [];
    if (spec.catalog.useServices || !spec.catalog.useProducts) d.push(plural(facts.activeServices, "servicio", "servicios"));
    if (spec.catalog.useProducts) d.push(plural(facts.activeProducts, "producto", "productos"));
    out.push({ capability: "catalog", label: "Mostrar catálogo", details: d });
  }
  if (caps.sales) {
    out.push({
      capability: "sales",
      label: "Cotizar precios",
      details: ["Cotización calculada por el sistema con tus precios reales", caps.humanHandoff ? "Para concretar la compra, el cliente pasa con una persona de tu equipo" : "No cobra ni toma pedidos"],
    });
  }
  if (caps.faq) {
    out.push({ capability: "faq", label: "Responder preguntas frecuentes", details: [facts.hasKnowledge ? "Con tus preguntas y documentos" : "Sin conocimiento cargado todavía", spec.knowledge.onNoAnswer === "handoff" ? "Si no sabe la respuesta, transfiere a una persona" : "Si no sabe la respuesta, lo dice (no inventa)"] });
  }
  if (caps.leadCapture) {
    const campos = (spec.customerData?.fields ?? []).filter((f) => f.enabled).length;
    out.push({ capability: "leadCapture", label: "Captar datos del cliente", details: [campos > 0 ? plural(campos, "dato configurado", "datos configurados") : "Nombre del cliente"] });
  }
  if (caps.humanHandoff) {
    const reglas = spec.handoff.rules.length;
    out.push({ capability: "humanHandoff", label: "Transferir a una persona", details: [reglas > 0 ? plural(reglas, "regla de transferencia", "reglas de transferencia") : "Solo ante fallos del agente", `El agente se pausa ${spec.handoff.defaultPauseHours} h en esa conversación`] });
  }
  return out;
}
