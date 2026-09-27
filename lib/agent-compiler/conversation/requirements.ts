// DuLabs Business — Business Agent 2.0, FASE 3 — requisitos de cada objetivo, derivados de la CONFIGURACIÓN.
//
// Nada de "una barbería necesita servicio + fecha + hora": qué objetivos existen, qué datos exigen y qué acción los
// cumple sale de las capacidades del Spec publicado (capabilities, scheduling, catalog, customerData) y de los
// contratos de acción de FASE 1. Un objetivo sin acción real de runtime queda `supported: false` (se dice, no se
// finge). Esta es la abstracción mínima para la FASE 3; el Business Model universal completo es la FASE 5.

import { createHash } from "node:crypto";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { CAPABILITY_BACKING } from "@/lib/agent-compiler/spec/capabilities";
import { getActionContract } from "@/lib/agent-compiler/contracts/action-contracts";
import { bookingCreateAction } from "@/lib/agent-compiler/flow-compiler";
import { isChannelSourced } from "@/lib/customer-data";
import { CUSTOMER_FIELD_TO_UNIVERSAL_SLOT, UNIVERSAL_SLOTS } from "@/lib/agent-compiler/understanding/slots";
import type { UnderstandingIntent } from "@/lib/agent-compiler/understanding/taxonomy";
import type { GoalKind } from "@/lib/agent-compiler/conversation/model";

/** Un requisito se cumple con cualquiera de sus slots; se pregunta por `ask`. */
export interface RequiredSlot {
  key: string;
  anyOf: readonly string[];
  ask: string;
}

export interface LookupRequirement {
  action: string;
  /** Slots que la consulta necesita para tener sentido. */
  requires: readonly string[];
  /** Se consulta cuando falta este slot del objetivo... */
  whenMissing: string;
  /** ...y el cliente dio una pista (p. ej. franja horaria) o pidió explícitamente la consulta. */
  hintSlots: readonly string[];
  triggerIntents: readonly UnderstandingIntent[];
}

export interface GoalRequirement {
  goal: GoalKind;
  supported: boolean;
  unsupportedReason?: "capability_disabled" | "no_runtime_action";
  required: readonly RequiredSlot[];
  /** Acción que cumple el objetivo (contrato de FASE 1). null = sin acción (p. ej. no soportado). */
  action: string | null;
  requiresConfirmation: boolean;
  lookup: LookupRequirement | null;
}

export interface AgentRequirements {
  /** Huella de los requisitos: cambia si cambia la configuración que los define. */
  fingerprint: string;
  goals: Readonly<Record<GoalKind, GoalRequirement>>;
  handoff: { supported: boolean; action: string | null };
  /** Consulta para responder una pregunta informativa mientras hay otro objetivo en curso. */
  informationAction: string | null;
  quoteAction: string | null;
  /** Slots que pertenecen a la persona (sobreviven entre objetivos). */
  customerSlots: readonly string[];
  /** Slots declarados por el negocio (customerData) → clave del campo en el Spec. */
  customerFieldBySlot: Readonly<Record<string, string>>;
}

function contractOrNull(action: string | null): string | null {
  return action && getActionContract(action) ? action : null;
}

function goal(g: GoalKind, over: Partial<GoalRequirement>): GoalRequirement {
  return { goal: g, supported: false, required: [], action: null, requiresConfirmation: false, lookup: null, ...over };
}

function one(slot: string): RequiredSlot {
  return { key: slot, anyOf: [slot], ask: slot };
}

export function buildAgentRequirements(spec: Pick<BusinessAgentSpec, "capabilities" | "scheduling" | "catalog" | "customerData">): AgentRequirements {
  const caps = spec.capabilities;
  const universal = new Set(UNIVERSAL_SLOTS.map((s) => s.name));

  // Datos del cliente configurados por el negocio (obligatorios y preguntables; el teléfono lo aporta el canal).
  const customerFieldBySlot: Record<string, string> = {};
  const requiredCustomer: RequiredSlot[] = [];
  const customerSlots = new Set<string>(["customer_name", "phone", "email"]);
  for (const f of spec.customerData?.fields ?? []) {
    if (!f.enabled) continue;
    const slot = CUSTOMER_FIELD_TO_UNIVERSAL_SLOT[f.key] ?? f.key;
    customerFieldBySlot[slot] = f.key;
    if (f.scope === "customer") customerSlots.add(slot);
    if (f.required && !isChannelSourced(f.key)) requiredCustomer.push(one(slot));
  }

  const scheduling = Boolean(caps.scheduling && spec.scheduling?.enabled);
  const provider = spec.scheduling?.provider ?? "none";
  const createAction = scheduling ? contractOrNull(bookingCreateAction(provider)) : null;
  const itemAsk = spec.catalog?.useProducts && !spec.catalog?.useServices ? "product" : "service";
  const item: RequiredSlot = { key: "item", anyOf: itemAsk === "product" ? ["product", "service"] : ["service", "product"], ask: itemAsk };

  const bookingRequired: RequiredSlot[] = [];
  if (spec.catalog?.useServices !== false) bookingRequired.push(one("service"));
  bookingRequired.push(one("date"), one("time"));
  // Un dato del cliente que ya es parte del objetivo (fecha, servicio) no se exige dos veces.
  for (const r of requiredCustomer) if (!bookingRequired.some((b) => b.key === r.key)) bookingRequired.push(r);

  const availability = provider === "nylas" ? contractOrNull("buscar_disponibilidad_nylas_generico") : null;
  const manageOwn = scheduling && provider === "nylas" && spec.scheduling?.cancellation?.allowed === true;

  const quoteAction = caps.sales && caps.catalog ? contractOrNull("calcular_cotizacion") : null;
  const informationAction = caps.faq ? contractOrNull("buscar_conocimiento") : caps.catalog ? contractOrNull("listar_catalogo_servicios") : null;
  const ordersBacked = Boolean(caps.orders && CAPABILITY_BACKING.orders.available);

  const goals: Record<GoalKind, GoalRequirement> = {
    booking: createAction
      ? goal("booking", {
          supported: true,
          required: bookingRequired,
          action: createAction,
          requiresConfirmation: true,
          lookup: availability
            ? { action: availability, requires: ["date"], whenMissing: "time", hintSlots: ["time_range"], triggerIntents: ["AVAILABILITY_INQUIRY"] }
            : null,
        })
      : goal("booking", { unsupportedReason: scheduling ? "no_runtime_action" : "capability_disabled" }),
    rescheduling: manageOwn
      ? goal("rescheduling", { supported: Boolean(contractOrNull("reprogramar_cita_cliente")), required: [one("date"), one("time")], action: contractOrNull("reprogramar_cita_cliente"), requiresConfirmation: true })
      : goal("rescheduling", { unsupportedReason: scheduling ? "no_runtime_action" : "capability_disabled" }),
    cancellation: manageOwn
      ? goal("cancellation", { supported: Boolean(contractOrNull("cancelar_cita_cliente")), action: contractOrNull("cancelar_cita_cliente"), requiresConfirmation: true })
      : goal("cancellation", { unsupportedReason: scheduling ? "no_runtime_action" : "capability_disabled" }),
    quote: quoteAction
      ? goal("quote", { supported: true, required: [item], action: quoteAction })
      : goal("quote", { unsupportedReason: "capability_disabled" }),
    // Hoy no existe acción de runtime para tomar pedidos (CAPABILITY_BACKING.orders.available = false).
    order: ordersBacked
      ? goal("order", { supported: false, unsupportedReason: "no_runtime_action", required: [item, one("quantity")] })
      : goal("order", { unsupportedReason: caps.orders ? "no_runtime_action" : "capability_disabled", required: [item, one("quantity")] }),
    information: informationAction
      ? goal("information", { supported: true, action: informationAction })
      : goal("information", { unsupportedReason: "capability_disabled" }),
  };

  const handoffAction = caps.humanHandoff ? contractOrNull("transferir_soporte") : null;
  const known = [...Object.keys(customerFieldBySlot), ...universal].sort();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ goals, handoffAction, quoteAction, informationAction, customerSlots: [...customerSlots].sort(), known }))
    .digest("hex")
    .slice(0, 16);

  return {
    fingerprint,
    goals,
    handoff: { supported: Boolean(handoffAction), action: handoffAction },
    informationAction,
    quoteAction,
    customerSlots: [...customerSlots],
    customerFieldBySlot,
  };
}

/**
 * Intent → objetivo. Determinista. Un pedido sin acción real de pedidos se atiende como COTIZACIÓN si el negocio cotiza
 * (el cliente recibe el precio real); si no, queda como objetivo no soportado (se le dice y se ofrece una persona).
 */
export function goalForIntent(intent: UnderstandingIntent, req: AgentRequirements): GoalKind | null {
  switch (intent) {
    case "BOOKING_REQUEST":
    case "AVAILABILITY_INQUIRY":
      return "booking";
    case "RESCHEDULING":
      return "rescheduling";
    case "CANCELLATION":
      return "cancellation";
    case "ORDER_REQUEST":
      return req.goals.order.supported ? "order" : req.goals.quote.supported ? "quote" : "order";
    case "PRICE_INQUIRY":
      return req.goals.quote.supported ? "quote" : "information";
    case "INFORMATION_REQUEST":
    case "PRODUCT_INQUIRY":
    case "SERVICE_INQUIRY":
      return "information";
    default:
      return null;
  }
}

/** Objetivos "de transacción" (desplazan a uno informativo en curso; uno informativo no los desplaza a ellos). */
export const TRANSACTIONAL_GOALS: ReadonlySet<GoalKind> = new Set(["booking", "rescheduling", "cancellation", "order"]);
