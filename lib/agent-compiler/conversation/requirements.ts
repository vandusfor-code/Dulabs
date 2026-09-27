// DuLabs Business — Business Agent 2.0, FASE 3 — requisitos de cada objetivo, derivados de la CONFIGURACIÓN.
//
// Nada de "una barbería necesita servicio + fecha + hora": qué objetivos existen, qué datos exigen y qué acción los
// cumple sale de las capacidades del Universal Business Model (FASE 5) y de los contratos de acción de FASE 1. Un
// objetivo sin acción real de runtime queda `supported: false` (se dice, no se finge). Un Spec legacy entra por el
// adaptador (Spec → UBM) y usa exactamente la misma derivación.

import { createHash } from "node:crypto";
import type { BusinessAgentSpec, CustomerField } from "@/lib/agent-compiler/spec/types";
import { CAPABILITY_BACKING } from "@/lib/agent-compiler/spec/capabilities";
import { getActionContract } from "@/lib/agent-compiler/contracts/action-contracts";
import { bookingCreateAction } from "@/lib/agent-compiler/flow-compiler";
import { isChannelSourced } from "@/lib/customer-data";
import { CUSTOMER_FIELD_TO_UNIVERSAL_SLOT, UNIVERSAL_SLOTS } from "@/lib/agent-compiler/understanding/slots";
import type { UnderstandingIntent } from "@/lib/agent-compiler/understanding/taxonomy";
import type { GoalKind } from "@/lib/agent-compiler/conversation/model";
import type { BusinessModel } from "@/lib/agent-compiler/business-model/schema";
import { CAPABILITY_CATALOG, type BookingCapabilityConfig, type CatalogCapabilityConfig, type UbmCapabilityId } from "@/lib/agent-compiler/business-model/capabilities";
import { legacyModelFromSpec } from "@/lib/agent-compiler/business-model/legacy-adapter";

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
  /**
   * FASE 5: huella de ejecución del artefacto publicado (la fija el runtime al cargar el artefacto). Entra en la
   * identidad de cada solicitud de acción y de su confirmación: lo confirmado en una versión no autoriza otra.
   */
  artifactRef?: string;
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

/**
 * Lo que define los requisitos, ya resuelto desde las capacidades del Universal Business Model (FASE 5). Una sola
 * derivación para todo negocio: tanto un modelo nativo como un Spec legacy (vía el adaptador) llegan aquí igual.
 */
export interface RequirementInputs {
  customerFields: readonly CustomerField[];
  /** Agenda ACTIVA con config válida (null = sin agenda). */
  booking: { provider: string; requiresService: boolean; cancellation: boolean; rescheduling: boolean } | null;
  /** La agenda se pidió en el modelo (aunque su config no tenga runtime): distingue "no_runtime_action" de "capability_disabled". */
  bookingRequested: boolean;
  catalog: { includeServices: boolean; includeProducts: boolean } | null;
  quotes: boolean;
  knowledge: boolean;
  handoff: boolean;
  ordersRequested: boolean;
}

/** Entradas de requisitos desde un modelo (tolerante: no valida publicación; eso es validateBusinessModel). */
export function requirementInputsFromModel(model: BusinessModel): RequirementInputs {
  const entry = (id: string) => model.capabilities.find((c) => c.id === id && c.enabled);
  const parse = <T,>(id: UbmCapabilityId): T | null => {
    const e = entry(id);
    if (!e) return null;
    const r = CAPABILITY_CATALOG[id].configSchema.safeParse(e.config);
    return r.success ? (r.data as T) : null;
  };
  const booking = parse<BookingCapabilityConfig>("booking");
  const catalog = parse<CatalogCapabilityConfig>("catalog");
  return {
    customerFields: model.customerFields,
    booking: booking ? { provider: booking.provider, requiresService: booking.requiresService, cancellation: booking.cancellation.allowed, rescheduling: booking.rescheduling.allowed } : null,
    bookingRequested: Boolean(entry("booking")),
    catalog,
    quotes: Boolean(entry("quotes")),
    knowledge: Boolean(parse("knowledge")),
    handoff: Boolean(parse("handoff")),
    ordersRequested: Boolean(entry("orders")),
  };
}

export function deriveRequirements(inputs: RequirementInputs): AgentRequirements {
  const universal = new Set(UNIVERSAL_SLOTS.map((s) => s.name));

  // Datos del cliente configurados por el negocio (obligatorios y preguntables; el teléfono lo aporta el canal).
  const customerFieldBySlot: Record<string, string> = {};
  const requiredCustomer: RequiredSlot[] = [];
  const customerSlots = new Set<string>(["customer_name", "phone", "email"]);
  for (const f of inputs.customerFields) {
    if (!f.enabled) continue;
    const slot = CUSTOMER_FIELD_TO_UNIVERSAL_SLOT[f.key] ?? f.key;
    customerFieldBySlot[slot] = f.key;
    if (f.scope === "customer") customerSlots.add(slot);
    if (f.required && !isChannelSourced(f.key)) requiredCustomer.push(one(slot));
  }

  const booking = inputs.booking;
  const provider = booking?.provider ?? "none";
  const createAction = booking ? contractOrNull(bookingCreateAction(provider)) : null;
  const itemAsk = inputs.catalog?.includeProducts && !inputs.catalog?.includeServices ? "product" : "service";
  const item: RequiredSlot = { key: "item", anyOf: itemAsk === "product" ? ["product", "service"] : ["service", "product"], ask: itemAsk };

  const bookingRequired: RequiredSlot[] = [];
  if (booking?.requiresService !== false) bookingRequired.push(one("service"));
  bookingRequired.push(one("date"), one("time"));
  // Un dato del cliente que ya es parte del objetivo (fecha, servicio) no se exige dos veces.
  for (const r of requiredCustomer) if (!bookingRequired.some((b) => b.key === r.key)) bookingRequired.push(r);

  const availability = provider === "nylas" ? contractOrNull("buscar_disponibilidad_nylas_generico") : null;
  const calendar = Boolean(booking) && provider === "nylas";
  const unsupportedScheduling = inputs.bookingRequested ? "no_runtime_action" : "capability_disabled";

  const quoteAction = inputs.quotes && inputs.catalog ? contractOrNull("calcular_cotizacion") : null;
  const informationAction = inputs.knowledge ? contractOrNull("buscar_conocimiento") : inputs.catalog ? contractOrNull("listar_catalogo_servicios") : null;
  const ordersBacked = Boolean(inputs.ordersRequested && CAPABILITY_BACKING.orders.available);

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
      : goal("booking", { unsupportedReason: unsupportedScheduling }),
    rescheduling: calendar && booking!.rescheduling
      ? goal("rescheduling", { supported: Boolean(contractOrNull("reprogramar_cita_cliente")), required: [one("date"), one("time")], action: contractOrNull("reprogramar_cita_cliente"), requiresConfirmation: true })
      : goal("rescheduling", { unsupportedReason: unsupportedScheduling }),
    cancellation: calendar && booking!.cancellation
      ? goal("cancellation", { supported: Boolean(contractOrNull("cancelar_cita_cliente")), action: contractOrNull("cancelar_cita_cliente"), requiresConfirmation: true })
      : goal("cancellation", { unsupportedReason: unsupportedScheduling }),
    quote: quoteAction
      ? goal("quote", { supported: true, required: [item], action: quoteAction })
      : goal("quote", { unsupportedReason: "capability_disabled" }),
    // Hoy no existe acción de runtime para tomar pedidos (CAPABILITY_BACKING.orders.available = false).
    order: ordersBacked
      ? goal("order", { supported: false, unsupportedReason: "no_runtime_action", required: [item, one("quantity")] })
      : goal("order", { unsupportedReason: inputs.ordersRequested ? "no_runtime_action" : "capability_disabled", required: [item, one("quantity")] }),
    information: informationAction
      ? goal("information", { supported: true, action: informationAction })
      : goal("information", { unsupportedReason: "capability_disabled" }),
  };

  const handoffAction = inputs.handoff ? contractOrNull("transferir_soporte") : null;
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

/** Requisitos de un Spec legacy: Spec → adaptador → UBM → la MISMA derivación que un modelo nativo. */
export function buildAgentRequirements(spec: BusinessAgentSpec): AgentRequirements {
  return deriveRequirements(requirementInputsFromModel(legacyModelFromSpec(spec).model));
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
