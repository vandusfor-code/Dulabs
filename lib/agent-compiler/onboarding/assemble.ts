// DuLabs Business — Business Agent 2.0, FASE 6 — del borrador guiado a lo que el sistema ejecuta.
//
//   borrador ─┬─► Universal Business Model ─► validateBusinessModel (FASE 5, fail-closed) ─► artefacto
//             └─► Spec del runtime (Gate PRE-LLM + grafo + activación, lo que hoy sirve producción)
//
// Las dos salidas salen del MISMO borrador y deben significar lo mismo: al publicar se verifica que el Spec, pasado por
// el adaptador legacy, compile a la MISMA huella de ejecución que el UBM (si no, no se publica). Así no hay dos fuentes
// de verdad ni dos comportamientos según el runtime que atienda.
//
// Módulo PURO y apto para el navegador (la pantalla valida al instante con esta MISMA función; el servidor la repite
// antes de guardar y publicar). La proyección al Spec del runtime vive en runtime-spec.ts (solo servidor).
//
// Autoridad del catálogo: "business_tables". Servicios y productos se editan donde ya viven (tablas del negocio, mismos
// módulos del dashboard); el borrador no los copia.

import { BUSINESS_MODEL_SCHEMA_VERSION, WEEKDAYS, type BusinessModel, type CapabilityEntry, type CustomerFieldModel } from "@/lib/agent-compiler/business-model/schema";
import { validateBusinessModel, type ModelError, type ResolvedCapabilities } from "@/lib/agent-compiler/business-model/validate";
import { KNOWLEDGE_SOURCES } from "@/lib/business-agent-knowledge/limits";
import { slugifyFieldKey } from "@/lib/business-agent-form";
import type { OnboardingDraft } from "@/lib/agent-compiler/onboarding/draft";
import { issue, SUPPORT_CODES, type OnboardingIssue } from "@/lib/agent-compiler/onboarding/issues";

/**
 * Duración de una reserva sin servicio: la MISMA que usan por defecto los handlers de agenda (DURACION_MIN_DEFAULT de
 * calendar/nylas-availability, que no se importa aquí para no llevar código de servidor al navegador; un test fija la
 * igualdad).
 */
export const ONBOARDING_SLOT_MINUTES = 60;

/** Orden fijo de capacidades en el modelo (permite traducir `capabilities[i]` de un error al paso correcto). */
const CAP_ORDER = ["knowledge", "catalog", "quotes", "booking", "handoff"] as const;

const DAY_ES: Record<string, string> = { sunday: "domingo", monday: "lunes", tuesday: "martes", wednesday: "miércoles", thursday: "jueves", friday: "viernes", saturday: "sábado" };

/** De dónde salió cada dato del cliente del modelo (para devolver el error al campo que la persona ve). */
type FieldOrigin = { kind: "name" | "email" | "notes" } | { kind: "extra"; index: number };

export interface Assembly {
  model: BusinessModel;
  /** Solo si el modelo es publicable. */
  capabilities: ResolvedCapabilities | null;
  issues: OnboardingIssue[];
}

const trimOrUndefined = (s: string | undefined) => (s && s.trim() ? s.trim() : undefined);

function customerFields(draft: OnboardingDraft, pre: OnboardingIssue[]): { fields: CustomerFieldModel[]; origins: FieldOrigin[] } {
  const fields: CustomerFieldModel[] = [];
  const origins: FieldOrigin[] = [];
  // Los datos del cliente se piden para AGENDAR (así los usa el runtime): sin citas no se configuran (el Spec del runtime
  // actual los rechazaría y la state machine no los exige para ningún otro objetivo). El borrador los conserva.
  if (!draft.booking.enabled) return { fields, origins };
  const scope = "booking";
  if (draft.customerData.askName) {
    fields.push({ key: "nombreCliente", label: "Nombre", type: "text", required: true, enabled: true, scope: "customer" });
    origins.push({ kind: "name" });
  }
  if (draft.customerData.askEmail) {
    fields.push({ key: "correoCliente", label: "Correo electrónico", type: "email", required: true, enabled: true, scope: "customer" });
    origins.push({ kind: "email" });
  }
  if (draft.customerData.askNotes) {
    fields.push({ key: "notas", label: "Notas", type: "text", required: false, enabled: true, scope });
    origins.push({ kind: "notes" });
  }
  const used = new Set(fields.map((f) => f.key));
  draft.customerData.extra.forEach((e, index) => {
    const label = e.label.trim();
    const field = `customerData.extra.${index}`;
    if (!label) {
      pre.push(issue("atencion", SUPPORT_CODES.FIELD_INVALID, "Ponle nombre a este dato.", `${field}.label`));
      return;
    }
    // La clave técnica la genera el servidor; solo se respeta la de un campo existente (continuidad de datos).
    const key = trimOrUndefined(e.key) ?? slugifyFieldKey(label);
    if (!key) {
      pre.push(issue("atencion", SUPPORT_CODES.FIELD_INVALID, `«${label}» necesita un nombre con letras.`, `${field}.label`));
      return;
    }
    if (used.has(key)) {
      pre.push(issue("atencion", SUPPORT_CODES.FIELD_DUPLICATE, `Ya pides un dato llamado «${label}».`, `${field}.label`));
      return;
    }
    used.add(key);
    fields.push({
      key,
      label,
      type: e.type,
      required: e.required,
      enabled: true,
      scope,
      ...(e.type === "select" ? { options: (e.options ?? []).map((o) => o.trim()).filter(Boolean) } : {}),
    });
    origins.push({ kind: "extra", index });
  });
  return { fields, origins };
}

/** Borrador → Universal Business Model (siempre se construye; la validación dice qué falta). */
export function draftToModel(draft: OnboardingDraft): { model: BusinessModel; origins: FieldOrigin[]; pre: OnboardingIssue[] } {
  const pre: OnboardingIssue[] = [];
  const b = draft.booking;
  const calendar = b.enabled && b.agenda === "calendar";
  const cap = (id: (typeof CAP_ORDER)[number], enabled: boolean, config: Record<string, unknown>): CapabilityEntry => ({ id, version: "1.0.0", enabled, config });
  const { fields, origins } = customerFields(draft, pre);
  draft.restrictedTopics.forEach((t, i) => {
    if (t.words.every((w) => !w.trim())) pre.push(issue("reglas", SUPPORT_CODES.TOPIC_INVALID, "Escribe al menos una palabra para este tema.", `restrictedTopics.${i}.words`));
  });

  const model: BusinessModel = {
    schemaVersion: BUSINESS_MODEL_SCHEMA_VERSION,
    identity: {
      name: draft.business.name?.trim() ?? "",
      ...(trimOrUndefined(draft.business.description) ? { description: draft.business.description!.trim() } : {}),
      ...(trimOrUndefined(draft.business.category) ? { category: draft.business.category!.trim() } : {}),
      language: "es-CO",
      currency: "COP",
      timezone: draft.business.timezone,
    },
    capabilities: [
      cap("knowledge", draft.support.answerQuestions, {
        sources: [...KNOWLEDGE_SOURCES],
        onNoAnswer: draft.support.whenUnknown === "handoff" ? "handoff" : "message",
        ...(trimOrUndefined(draft.support.unknownMessage) ? { noAnswerMessage: draft.support.unknownMessage!.trim() } : {}),
      }),
      cap("catalog", draft.offer.showCatalog, { includeServices: draft.offer.services, includeProducts: draft.offer.products }),
      cap("quotes", draft.offer.quotes, {}),
      cap("booking", b.enabled, {
        provider: b.agenda === "calendar" ? "nylas" : b.agenda === "team" ? "internal" : undefined,
        // Una cita es por servicio cuando el negocio ofrece servicios (si no, p. ej. una mesa).
        requiresService: draft.offer.services,
        slotDurationMinutes: ONBOARDING_SLOT_MINUTES,
        bufferMinutes: 0,
        minimumNoticeMinutes: b.minimumNoticeMinutes,
        maximumAdvanceDays: null,
        resourceSelection: "none",
        cancellation: { allowed: b.allowChanges, minimumNoticeHours: b.changesNoticeHours },
        rescheduling: { allowed: b.allowChanges },
      }),
      cap("handoff", draft.support.handoff, { pauseHours: draft.support.pauseHours }),
    ],
    catalogAuthority: "business_tables",
    services: [],
    products: [],
    resources: [],
    customerFields: fields,
    businessHours: calendar ? draft.hours : null,
    policies: { unsupportedRequest: draft.support.whenCannotHelp === "offer_person" ? "offer_handoff" : "inform_only" },
  };
  return { model, origins, pre };
}

function stepOfCapability(index: number): OnboardingIssue["step"] {
  const id = CAP_ORDER[index];
  return id === "booking" ? "citas" : id === "knowledge" || id === "handoff" ? "atencion" : "oferta";
}

function fieldPath(origin: FieldOrigin | undefined): string | undefined {
  if (!origin) return undefined;
  return origin.kind === "extra" ? `customerData.extra.${origin.index}.label` : origin.kind === "name" ? "customerData.askName" : origin.kind === "email" ? "customerData.askEmail" : "customerData.askNotes";
}

/** Error del modelo (FASE 5) → mensaje humano en el paso donde se arregla. */
export function humanizeModelError(e: ModelError, origins: FieldOrigin[]): OnboardingIssue {
  const capIdx = /^capabilities\[(\d+)\]/.exec(e.path);
  const day = /^businessHours\.week\.([a-z]+)/.exec(e.path);
  const exc = /^businessHours\.exceptions\[(\d+)\]/.exec(e.path);
  const cf = /^customerFields\[(\d+)\]/.exec(e.path);
  switch (e.code) {
    case "TIMEZONE_INVALID":
      return issue("negocio", SUPPORT_CODES.TIMEZONE_INVALID, "Elige la ciudad donde está tu negocio.", "business.timezone");
    case "TIMEZONE_NOT_SUPPORTED":
      return issue("citas", SUPPORT_CODES.TIMEZONE_NOT_SUPPORTED, "Por ahora las citas solo se agendan con la hora de Bogotá, Colombia. Cambia la ciudad de tu negocio o desactiva las citas.", "booking.enabled");
    case "BUSINESS_HOURS_REQUIRED":
      return issue("horario", SUPPORT_CODES.HOURS_REQUIRED, "Marca al menos un día abierto: con tu calendario el agente solo reserva dentro de tu horario.", "hours");
    case "BUSINESS_HOURS_OVERLAP":
      return issue("horario", SUPPORT_CODES.HOURS_OVERLAP, `El ${DAY_ES[day?.[1] ?? ""] ?? "día"} tiene horarios que se cruzan.`, day ? `hours.week.${day[1]}` : "hours");
    case "BUSINESS_HOURS_INVALID":
      if (exc) return issue("horario", SUPPORT_CODES.HOURS_INVALID, `La fecha especial ${Number(exc[1]) + 1} no es válida o está repetida.`, `hours.exceptions.${exc[1]}`);
      return issue("horario", SUPPORT_CODES.HOURS_INVALID, `El ${DAY_ES[day?.[1] ?? ""] ?? "día"}: la hora de inicio debe ser antes que la de cierre, y un día abierto necesita al menos un horario.`, day ? `hours.week.${day[1]}` : "hours");
    case "BOOKING_POLICY_NOT_SUPPORTED":
      return issue("citas", SUPPORT_CODES.CHANGES_NEED_CALENDAR, "Cancelar o cambiar citas por WhatsApp solo funciona con Google Calendar.", "booking.allowChanges");
    case "POLICY_REQUIRES_CAPABILITY":
      return issue("atencion", SUPPORT_CODES.HANDOFF_NEEDED, "Para ofrecer hablar con una persona, activa que tu equipo pueda atender conversaciones.", "support.whenCannotHelp");
    case "CAPABILITY_DEPENDENCY_MISSING":
      if (e.path === "capabilities.quotes") return issue("oferta", SUPPORT_CODES.QUOTES_NEED_CATALOG, "Para dar precios, activa también que el agente muestre lo que ofreces.", "offer.quotes");
      if (e.path === "capabilities.knowledge") return issue("atencion", SUPPORT_CODES.HANDOFF_NEEDED, "Para pasar a una persona cuando no sepa la respuesta, activa que tu equipo pueda atender conversaciones.", "support.whenUnknown");
      return issue("atencion", SUPPORT_CODES.MODEL_OTHER, "Falta activar algo que esta opción necesita.");
    case "CAPABILITY_CONFIG_INVALID":
      if (e.path.startsWith("capabilities.catalog")) return issue("oferta", SUPPORT_CODES.CATALOG_EMPTY, "Elige si ofreces servicios, productos o ambos.", "offer.services");
      if (capIdx && CAP_ORDER[Number(capIdx[1])] === "booking" && e.path.includes("provider")) return issue("citas", SUPPORT_CODES.AGENDA_MISSING, "Elige dónde llevas tu agenda.", "booking.agenda");
      return issue(capIdx ? stepOfCapability(Number(capIdx[1])) : "oferta", SUPPORT_CODES.MODEL_OTHER, "Revisa esta opción: tiene un valor que no es válido.");
    case "PROTECTED_FIELD":
    case "CUSTOMER_FIELD_INVALID": {
      const origin = cf ? origins[Number(cf[1])] : undefined;
      const msg = e.message.includes("opciones")
        ? e.message.replace(/El campo "[^"]*"/, "Esta lista").replace(/la clave "[^"]*"/i, "este dato")
        : e.message.includes("repetid")
          ? "Hay dos datos con el mismo nombre."
          : "Ese nombre de dato lo usa el sistema; llámalo de otra forma.";
      const code = e.code === "PROTECTED_FIELD" || /reservad|no es válida/.test(e.message) ? SUPPORT_CODES.FIELD_PROTECTED : SUPPORT_CODES.FIELD_INVALID;
      return issue("atencion", code, msg, fieldPath(origin));
    }
    case "SCHEMA_INVALID":
      if (e.path === "identity.name") return issue("negocio", SUPPORT_CODES.NAME_MISSING, "Escribe el nombre de tu negocio.", "business.name");
      if (e.path.startsWith("identity")) return issue("negocio", SUPPORT_CODES.MODEL_OTHER, "Revisa los datos de tu negocio: algún texto es demasiado largo o no es válido.", `business.${e.path.split(".")[1] ?? ""}`);
      if (e.path.startsWith("businessHours")) return issue("horario", SUPPORT_CODES.HOURS_INVALID, "Revisa tu horario: alguna hora no es válida.", "hours");
      if (cf) return issue("atencion", SUPPORT_CODES.FIELD_INVALID, "Revisa los datos que pides al cliente.", fieldPath(origins[Number(cf[1])]));
      if (capIdx) return issue(stepOfCapability(Number(capIdx[1])), SUPPORT_CODES.MODEL_OTHER, "Revisa esta opción: tiene un valor que no es válido.");
      return issue("negocio", SUPPORT_CODES.MODEL_OTHER, "Hay un dato que no es válido.");
    default:
      return issue("negocio", SUPPORT_CODES.MODEL_OTHER, "Hay algo por revisar en tu configuración.");
  }
}

/** Borrador → modelo validado (FASE 5) + problemas en lenguaje humano. Puro y barato (se usa en cada guardado). */
export function assembleDraft(draft: OnboardingDraft): Assembly {
  const { model, origins, pre } = draftToModel(draft);
  // Sin nombre, el esquema cortaría antes de revisar lo demás: se valida con un marcador para mostrar TODO a la vez
  // (el marcador nunca se publica: el problema del nombre queda registrado y bloquea).
  if (!model.identity.name) pre.push(issue("negocio", SUPPORT_CODES.NAME_MISSING, "Escribe el nombre de tu negocio.", "business.name"));
  const v = validateBusinessModel(model.identity.name ? model : { ...model, identity: { ...model.identity, name: "·" } });
  const modelIssues = v.ok ? [] : v.errors.map((e) => humanizeModelError(e, origins));
  // Un mismo mensaje en el mismo campo se muestra una vez.
  const seen = new Set<string>();
  const issues = [...pre, ...modelIssues].filter((i) => {
    const k = `${i.step}|${i.field ?? ""}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { model, capabilities: v.ok && pre.length === 0 ? v.capabilities : null, issues };
}

/** Días abiertos (para textos del resumen). */
export function openDays(draft: OnboardingDraft): number {
  return WEEKDAYS.filter((d) => draft.hours.week[d].open && draft.hours.week[d].intervals.length > 0).length;
}
