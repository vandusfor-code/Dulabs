// DuLabs Business — Business Agent 2.0, FASE 8 — recursos que el cliente elige al reservar (persona, silla, sala…).
//
// Genérico: el código no conoce tipos por industria. Con `booking.resourceSelection = "customer_choice"`, la elección
// es un DATO DE LA RESERVA más (select con los recursos ACTIVOS del modelo): la state machine lo pide, el entendimiento
// lo normaliza contra las opciones y el handler de agenda existente lo valida y lo guarda con la cita.
//
// Límite honesto (PARCIAL): la disponibilidad sigue siendo la del calendario del negocio completo; no hay agenda por
// recurso. Un recurso ocupado no se detecta hasta que el negocio lo gestione (ver FASE-8 doc).

import { MAX_OPTION_LENGTH, MAX_SELECT_OPTIONS } from "@/lib/customer-data";
import type { BusinessModel, CustomerFieldModel } from "@/lib/agent-compiler/business-model/schema";
import { RESOURCE_FIELD_KEY } from "@/lib/agent-compiler/business-model/validate";

export { RESOURCE_FIELD_KEY };

function bookingSelection(model: BusinessModel): string | null {
  const b = model.capabilities.find((c) => c.id === "booking" && c.enabled);
  const sel = (b?.config as { resourceSelection?: unknown } | undefined)?.resourceSelection;
  return typeof sel === "string" ? sel : null;
}

/** Recursos activos entre los que el cliente puede elegir (vacío = no se pregunta). */
export function selectableResources(model: BusinessModel): Array<{ id: string; name: string; kind: string }> {
  if (bookingSelection(model) !== "customer_choice") return [];
  return model.resources.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
}

/** Dato de la reserva sintetizado para la elección de recurso, o null si el negocio no la ofrece. */
export function resourceFieldOf(model: BusinessModel): CustomerFieldModel | null {
  const options = selectableResources(model)
    .map((r) => r.name.slice(0, MAX_OPTION_LENGTH))
    .slice(0, MAX_SELECT_OPTIONS);
  if (options.length === 0) return null;
  return { key: RESOURCE_FIELD_KEY, label: "Recurso elegido", type: "select", required: true, enabled: true, scope: "booking", options };
}

/** Datos del cliente del modelo + (si aplica) la elección de recurso. Única fuente para requisitos y compilación. */
export function effectiveCustomerFields(model: BusinessModel): CustomerFieldModel[] {
  const r = resourceFieldOf(model);
  return r ? [...model.customerFields, r] : [...model.customerFields];
}
