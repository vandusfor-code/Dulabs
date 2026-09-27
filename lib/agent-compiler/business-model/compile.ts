// DuLabs Business — Business Agent 2.0, FASE 5 — compilador: Universal Business Model → artefacto publicado.
//
//   modelo → validateBusinessModel (fail-closed) → capacidades resueltas → acciones habilitadas + config por paso,
//   requisitos (state machine), contexto de entendimiento, preguntas, agenda, políticas → checksum → congelado.
//
// La configuración de cada paso reproduce EXACTAMENTE los params que el compilador del grafo (flow-compiler.ts) embebe
// para los mismos handlers (lo verifica un test contra un flow compilado real), con una corrección: la consulta de
// disponibilidad de una reserva nueva ya no hereda `modoReprogramar` del nodo de reprogramación (defecto de FASE 4).

import { toCompiledFields, WELL_KNOWN_FIELDS } from "@/lib/customer-data";
import { DEFAULT_NO_ANSWER_MESSAGE } from "@/lib/business-agent-knowledge/limits";
import { businessSlotsFromSpec, CUSTOMER_FIELD_TO_UNIVERSAL_SLOT } from "@/lib/agent-compiler/understanding/slots";
import { deriveRequirements, requirementInputsFromModel } from "@/lib/agent-compiler/conversation/requirements";
import { bookingCreateAction } from "@/lib/agent-compiler/flow-compiler";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { BUSINESS_MODEL_SCHEMA_VERSION, type BusinessModel } from "@/lib/agent-compiler/business-model/schema";
import { CAPABILITY_CATALOG, dependenciesOf, UBM_CAPABILITY_IDS, type UbmCapabilityId } from "@/lib/agent-compiler/business-model/capabilities";
import { validateBusinessModel, type ModelError, type ResolvedCapabilities } from "@/lib/agent-compiler/business-model/validate";
import { hoursToHandlerFormat, legacyModelFromSpec, type LegacyAdapterResult } from "@/lib/agent-compiler/business-model/legacy-adapter";
import { effectiveCustomerFields, selectableResources } from "@/lib/agent-compiler/business-model/resources";
import {
  ARTIFACT_COMPILER_VERSION,
  ARTIFACT_SCHEMA_VERSION,
  artifactChecksumOf,
  deepFreeze,
  executionFingerprintOf,
  type ArtifactActionEntry,
  type ArtifactBooking,
  type ArtifactContent,
  type CompiledAgentArtifact,
} from "@/lib/agent-compiler/business-model/artifact";

export const DEFAULT_HANDOFF_MESSAGE = "Te comunico con una persona del equipo. En breve te escriben por aquí.";

export interface CompileContext {
  /** Del servidor autenticado, nunca del modelo. */
  tenantId: string;
  agentId: string;
  versionRef: string;
  publishedVersion: number | null;
}

export type CompileResult = { ok: true; artifact: CompiledAgentArtifact } | { ok: false; code: "PUBLICATION_REJECTED"; errors: ModelError[] };

type Params = Record<string, string>;
const withParams = (params: Params): Record<string, unknown> => (Object.keys(params).length > 0 ? { params } : {});

function compileActions(model: BusinessModel, caps: ResolvedCapabilities, booking: ArtifactBooking | null): Record<string, ArtifactActionEntry> {
  const actions: Record<string, ArtifactActionEntry> = {};
  const add = (action: string, capability: UbmCapabilityId, steps: Record<string, Record<string, unknown>>) => {
    actions[action] = { capability, steps };
  };

  if (booking) {
    const createAction = bookingCreateAction(booking.provider)!;
    if (booking.provider === "nylas") {
      const horario: Params = {};
      if (booking.businessHours) horario.businessHoursJson = JSON.stringify(booking.businessHours);
      horario.minNoticeMinutes = String(booking.minimumNoticeMinutes);
      // FASE 8: la elección de recurso viaja como un dato más de la reserva (el handler lo valida contra las opciones).
      const fields = toCompiledFields(effectiveCustomerFields(model));
      const bookParams: Params = { ...horario, ...(fields.length > 0 ? { customerFieldsJson: JSON.stringify(fields) } : {}) };
      add("buscar_disponibilidad_nylas_generico", "booking", { buscar_disponibilidad_nylas_generico: withParams(horario) });
      add(createAction, "booking", { [createAction]: withParams(bookParams) });
      const politica: Params = { cancelAllowed: "true", cancelMinNoticeHours: String(booking.cancellation.minimumNoticeHours) };
      if (booking.cancellation.allowed) add("cancelar_cita_cliente", "booking", { listar_citas_cliente: { params: politica }, cancelar_cita_cliente: { params: politica } });
      if (booking.rescheduling.allowed) add("reprogramar_cita_cliente", "booking", { listar_citas_cliente: { params: politica }, reprogramar_cita_cliente: { params: { ...politica, ...horario } } });
    } else {
      // Agenda interna: el handler usa los horarios de especialistas (tablas); el compilador del grafo no embebe params.
      add(createAction, "booking", { [createAction]: {} });
    }
  }
  const catalogParams: Params | null = caps.catalog ? { incluirServicios: String(caps.catalog.config.includeServices), incluirProductos: String(caps.catalog.config.includeProducts) } : null;
  if (catalogParams) add("listar_catalogo_servicios", "catalog", { listar_catalogo_servicios: { params: catalogParams } });
  if (catalogParams && caps.quotes) add("calcular_cotizacion", "quotes", { calcular_cotizacion: { params: catalogParams } });
  if (caps.knowledge) add("buscar_conocimiento", "knowledge", { buscar_conocimiento: { params: { fuentes: caps.knowledge.config.sources.join(",") } } });
  if (caps.handoff) add("transferir_soporte", "handoff", { transferir_soporte: { pauseDurationHours: caps.handoff.config.pauseHours } });
  // FASE 8 — acciones nativas del Business Agent.
  if (caps.catalog?.config.includeProducts) add("ba_consultar_producto", "catalog", { ba_consultar_producto: { params: { moneda: model.identity.currency } } });
  if (caps.lead_capture) {
    add("ba_guardar_lead", "lead_capture", { ba_guardar_lead: { params: { fieldKeys: caps.lead_capture.config.fieldKeys.join(","), captureInterest: String(caps.lead_capture.config.captureInterest) } } });
  }
  if (caps.reminders && booking) add("ba_programar_recordatorio", "reminders", { ba_programar_recordatorio: { params: { offsetMinutes: String(caps.reminders.config.offsetMinutes), timezone: model.identity.timezone } } });
  return actions;
}

/** Preguntas configuradas para cada dato del cliente, por slot. */
function compileQuestions(model: BusinessModel): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of effectiveCustomerFields(model)) {
    if (!f.enabled) continue;
    const q = f.question?.trim() || WELL_KNOWN_FIELDS[f.key]?.question;
    if (q) out[CUSTOMER_FIELD_TO_UNIVERSAL_SLOT[f.key] ?? f.key] = q;
  }
  return out;
}

function compileValidated(model: BusinessModel, caps: ResolvedCapabilities, ctx: CompileContext, source: CompiledAgentArtifact["source"], notes: LegacyAdapterResult["notes"]): CompiledAgentArtifact {
  const b = caps.booking?.config;
  const booking: ArtifactBooking | null = b
    ? {
        provider: b.provider,
        requiresService: b.requiresService,
        slotDurationMinutes: b.slotDurationMinutes,
        minimumNoticeMinutes: b.minimumNoticeMinutes,
        maximumAdvanceDays: b.maximumAdvanceDays,
        cancellation: { allowed: b.cancellation.allowed, minimumNoticeHours: b.cancellation.minimumNoticeHours },
        rescheduling: { allowed: b.rescheduling.allowed },
        businessHours: b.provider === "nylas" && model.businessHours ? hoursToHandlerFormat(model.businessHours) : null,
      }
    : null;
  const enabledIds = new Set(Object.keys(caps) as UbmCapabilityId[]);
  const actions = compileActions(model, caps, booking);

  const content: ArtifactContent = {
    artifactSchema: ARTIFACT_SCHEMA_VERSION,
    compilerVersion: ARTIFACT_COMPILER_VERSION,
    source,
    businessModelSchema: BUSINESS_MODEL_SCHEMA_VERSION,
    tenantId: ctx.tenantId,
    agentId: ctx.agentId,
    identity: { name: model.identity.name, language: model.identity.language, currency: model.identity.currency, timezone: model.identity.timezone, category: model.identity.category ?? null },
    capabilities: UBM_CAPABILITY_IDS.map((id) => {
      const entry = model.capabilities.find((c) => c.id === id);
      const on = enabledIds.has(id);
      return {
        id,
        version: entry?.version ?? CAPABILITY_CATALOG[id].versions[0]!,
        enabled: on,
        actions: on ? Object.entries(actions).filter(([, a]) => a.capability === id).map(([name]) => name) : [],
        dependsOn: dependenciesOf(id, (caps as Record<string, { config: unknown } | undefined>)[id]?.config),
      };
    }),
    actions,
    booking,
    catalogAuthority: model.catalogAuthority,
    services: model.services.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes, bookable: s.bookingEnabled, ...(s.price ? { price: s.price.amount } : {}) })),
    requirements: deriveRequirements(requirementInputsFromModel(model)),
    understanding: { businessName: model.identity.name, businessSlots: businessSlotsFromSpec({ customerData: { fields: effectiveCustomerFields(model) } }) },
    questions: compileQuestions(model),
    handoff: { enabled: Boolean(caps.handoff), pauseHours: caps.handoff?.config.pauseHours ?? 0, message: caps.handoff?.config.message?.trim() || DEFAULT_HANDOFF_MESSAGE },
    knowledge: {
      enabled: Boolean(caps.knowledge),
      onNoAnswer: caps.knowledge?.config.onNoAnswer ?? "message",
      noAnswerMessage: caps.knowledge?.config.noAnswerMessage?.trim() || DEFAULT_NO_ANSWER_MESSAGE,
    },
    policies: { offerHandoff: Boolean(caps.handoff) && model.policies.unsupportedRequest === "offer_handoff" },
    presentation: { tone: model.presentation?.tone ?? "cercano", locale: model.identity.language },
    resources: booking ? selectableResources(model) : [],
    reminders: { enabled: Boolean(caps.reminders && booking), offsetMinutes: caps.reminders?.config.offsetMinutes ?? 0 },
    leadCapture: { enabled: Boolean(caps.lead_capture), fieldKeys: caps.lead_capture ? [...caps.lead_capture.config.fieldKeys] : [], captureInterest: caps.lead_capture?.config.captureInterest ?? false },
    notes,
  };
  const executionFingerprint = executionFingerprintOf(content);
  const checksum = artifactChecksumOf({ ...content, executionFingerprint });
  return deepFreeze({ ...content, version: { ref: ctx.versionRef.slice(0, 64), publishedVersion: ctx.publishedVersion }, executionFingerprint, checksum });
}

function contextErrors(ctx: CompileContext): ModelError[] {
  const errors: ModelError[] = [];
  if (!ctx.tenantId || ctx.tenantId.length > 64) errors.push({ code: "SCHEMA_INVALID", path: "(context).tenantId", message: "Tenant del servidor requerido." });
  if (!ctx.agentId || ctx.agentId.length > 64) errors.push({ code: "SCHEMA_INVALID", path: "(context).agentId", message: "Agente requerido." });
  if (!ctx.versionRef) errors.push({ code: "SCHEMA_INVALID", path: "(context).versionRef", message: "Versión requerida." });
  return errors;
}

/** Valida (fail-closed) y compila un Universal Business Model. */
export function compileBusinessModel(raw: unknown, ctx: CompileContext): CompileResult {
  const cErr = contextErrors(ctx);
  if (cErr.length > 0) return { ok: false, code: "PUBLICATION_REJECTED", errors: cErr };
  const v = validateBusinessModel(raw);
  if (!v.ok) return v;
  return { ok: true, artifact: compileValidated(v.model, v.capabilities, ctx, "business_model", []) };
}

/** Spec legacy → adaptador → UBM → el MISMO validador y compilador. */
export function compileLegacySpec(spec: BusinessAgentSpec, ctx: CompileContext): CompileResult {
  const cErr = contextErrors(ctx);
  if (cErr.length > 0) return { ok: false, code: "PUBLICATION_REJECTED", errors: cErr };
  const adapted = legacyModelFromSpec(spec);
  const v = validateBusinessModel(adapted.model);
  if (!v.ok) return v;
  return { ok: true, artifact: compileValidated(v.model, v.capabilities, ctx, "legacy_spec", adapted.notes) };
}
