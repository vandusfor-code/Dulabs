// Business Agent 2.0, FASE 5 — modelos de negocio de prueba (Universal Business Model nativo).
//
// Cuatro negocios distintos con la MISMA arquitectura: ningún prompt ni regla por industria. Lo que cambia es solo
// configuración: capacidades, servicios, datos del cliente, horario, políticas. `category` es metadato.
//
// Selección de recurso (el cliente elige persona/mesa/sala): NO tiene runtime. El servicio profesional declara sus
// recursos genéricos con resourceSelection "none"; activar "customer_choice" se rechaza al publicar (ver tests).

import { BUSINESS_MODEL_SCHEMA_VERSION, type BusinessHoursModel, type BusinessModel } from "@/lib/agent-compiler/business-model/schema";

const iv = (start: string, end: string) => ({ start, end });
const closed = { open: false, intervals: [] };

/** Lunes a viernes 09–13 y 14–19; sábado 09–17; domingo cerrado. */
export function weekdayHours(): BusinessHoursModel {
  const split = { open: true, intervals: [iv("09:00", "13:00"), iv("14:00", "19:00")] };
  return {
    week: { sunday: closed, monday: split, tuesday: split, wednesday: split, thursday: split, friday: split, saturday: { open: true, intervals: [iv("09:00", "17:00")] } },
    exceptions: [{ date: "2026-12-25", open: false, intervals: [] }],
  };
}

const base = (name: string, category: string): Pick<BusinessModel, "schemaVersion" | "identity"> => ({
  schemaVersion: BUSINESS_MODEL_SCHEMA_VERSION,
  identity: { name, category, language: "es-CO", currency: "COP", timezone: "America/Bogota" },
});

const knowledge = () => ({ id: "knowledge", version: "1.0.0", enabled: true, config: { sources: ["faq", "documento"], onNoAnswer: "message" } });
const handoff = (pauseHours = 12) => ({ id: "handoff", version: "1.0.0", enabled: true, config: { pauseHours } });

/** Barbería: agenda con calendario, servicios del modelo (duración real por servicio), cancelar y reprogramar. */
export function barberiaModel(): BusinessModel {
  return {
    ...base("Barbería Norte", "barbería"),
    capabilities: [
      {
        id: "booking",
        version: "1.0.0",
        enabled: true,
        config: {
          provider: "nylas",
          requiresService: true,
          slotDurationMinutes: 30,
          bufferMinutes: 0,
          minimumNoticeMinutes: 60,
          maximumAdvanceDays: 30,
          resourceSelection: "none",
          cancellation: { allowed: true, minimumNoticeHours: 4 },
          rescheduling: { allowed: true },
        },
      },
      knowledge(),
      handoff(),
    ],
    catalogAuthority: "model",
    services: [
      { id: "corte-clasico", name: "Corte clásico", durationMinutes: 45, price: { amount: 30000, currency: "COP" }, active: true, bookingEnabled: true },
      { id: "barba", name: "Arreglo de barba", durationMinutes: 30, price: { amount: 20000, currency: "COP" }, active: true, bookingEnabled: true },
      { id: "tinte", name: "Tinte", durationMinutes: 90, active: false, bookingEnabled: true },
    ],
    products: [],
    resources: [],
    customerFields: [{ key: "nombreCliente", label: "Nombre", type: "text", required: true, enabled: true, scope: "customer" }],
    businessHours: weekdayHours(),
    policies: { unsupportedRequest: "offer_handoff" },
  };
}

/** Tienda: catálogo de productos en sus tablas, cotiza; NO agenda ni toma pedidos (no existe acción de pedidos). */
export function tiendaModel(): BusinessModel {
  return {
    ...base("Tienda Centro", "tienda de ropa"),
    capabilities: [
      { id: "catalog", version: "1.0.0", enabled: true, config: { includeServices: false, includeProducts: true } },
      { id: "quotes", version: "1.0.0", enabled: true, config: {} },
      knowledge(),
      handoff(24),
      { id: "orders", version: "1.0.0", enabled: false, config: {} },
    ],
    catalogAuthority: "business_tables",
    services: [],
    products: [],
    resources: [],
    customerFields: [
      { key: "color", label: "Color", type: "text", required: false, enabled: true, scope: "customer" },
      { key: "talla", label: "Talla", type: "select", required: false, enabled: true, scope: "customer", options: ["S", "M", "L"] },
    ],
    businessHours: null,
    policies: { unsupportedRequest: "offer_handoff" },
  };
}

/** Restaurante: reserva de mesa SIN servicio (duración fija de la reserva), número de personas obligatorio. */
export function restauranteModel(): BusinessModel {
  return {
    ...base("Restaurante Mar", "restaurante"),
    capabilities: [
      {
        id: "booking",
        version: "1.0.0",
        enabled: true,
        config: {
          provider: "nylas",
          requiresService: false,
          slotDurationMinutes: 90,
          bufferMinutes: 0,
          minimumNoticeMinutes: 120,
          maximumAdvanceDays: 60,
          resourceSelection: "none",
          cancellation: { allowed: false, minimumNoticeHours: 0 },
          rescheduling: { allowed: false },
        },
      },
      knowledge(),
      handoff(),
    ],
    catalogAuthority: "model",
    services: [],
    products: [],
    resources: [
      { id: "terraza", name: "Terraza", kind: "table", active: true, serviceIds: [] },
      { id: "salon", name: "Salón principal", kind: "table", active: true, serviceIds: [] },
    ],
    customerFields: [
      { key: "nombreCliente", label: "Nombre", type: "text", required: true, enabled: true, scope: "customer" },
      { key: "personas", label: "Número de personas", type: "number", required: true, enabled: true, scope: "booking", question: "¿Para cuántas personas es la reserva?" },
    ],
    businessHours: {
      week: { sunday: { open: true, intervals: [iv("12:00", "16:00")] }, monday: closed, tuesday: { open: true, intervals: [iv("12:00", "15:00"), iv("19:00", "23:00")] }, wednesday: { open: true, intervals: [iv("12:00", "15:00"), iv("19:00", "23:00")] }, thursday: { open: true, intervals: [iv("12:00", "15:00"), iv("19:00", "23:00")] }, friday: { open: true, intervals: [iv("12:00", "15:00"), iv("19:00", "23:30")] }, saturday: { open: true, intervals: [iv("12:00", "23:30")] } },
      exceptions: [],
    },
    policies: { unsupportedRequest: "offer_handoff" },
  };
}

/**
 * Servicio profesional (asesoría): agenda INTERNA (horarios de especialistas en sus tablas), recursos genéricos
 * "staff". Sin handoff: la política es solo informar.
 */
export function servicioProfesionalModel(): BusinessModel {
  return {
    ...base("Estudio Contable Ruiz", "servicio profesional"),
    capabilities: [
      {
        id: "booking",
        version: "1.0.0",
        enabled: true,
        config: {
          provider: "internal",
          requiresService: true,
          slotDurationMinutes: 60,
          bufferMinutes: 0,
          minimumNoticeMinutes: 1440,
          maximumAdvanceDays: 45,
          resourceSelection: "none",
          cancellation: { allowed: false, minimumNoticeHours: 0 },
          rescheduling: { allowed: false },
        },
      },
      { id: "knowledge", version: "1.0.0", enabled: true, config: { sources: ["faq"], onNoAnswer: "message", noAnswerMessage: "No tengo ese dato; te lo confirma un asesor en horario de oficina." } },
    ],
    catalogAuthority: "model",
    services: [
      { id: "asesoria-inicial", name: "Asesoría inicial", durationMinutes: 60, price: { amount: 120000, currency: "COP" }, active: true, bookingEnabled: true, resourceIds: ["ana", "luis"] },
      { id: "declaracion-renta", name: "Declaración de renta", durationMinutes: 90, active: true, bookingEnabled: false, resourceIds: ["ana"] },
    ],
    products: [],
    resources: [
      { id: "ana", name: "Ana Ruiz", kind: "staff", active: true, serviceIds: ["asesoria-inicial", "declaracion-renta"] },
      { id: "luis", name: "Luis Gómez", kind: "staff", active: true, serviceIds: ["asesoria-inicial"] },
    ],
    customerFields: [
      { key: "nombreCliente", label: "Nombre", type: "text", required: true, enabled: true, scope: "customer" },
      { key: "correoCliente", label: "Correo", type: "email", required: true, enabled: true, scope: "customer" },
    ],
    businessHours: null,
    policies: { unsupportedRequest: "inform_only" },
  };
}
