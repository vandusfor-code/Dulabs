// DuLabs Business — Business Agent 2.0, FASE 6 — borrador + modelo → Spec del runtime vigente (SOLO servidor).
//
// El Spec es lo que hoy sirve producción (Gate PRE-LLM, grafo, activación). Sale del MISMO borrador que el Universal
// Business Model, y la publicación verifica que ambos compilan a la misma huella de ejecución.

import type { BusinessModel } from "@/lib/agent-compiler/business-model/schema";
import { hoursToHandlerFormat } from "@/lib/agent-compiler/business-model/legacy-adapter";
import { BUSINESS_TYPE_OPTIONS } from "@/lib/business-agent-form";
import { BUSINESS_TYPE_OTRO, CURRENT_SPEC_SCHEMA_VERSION, type BusinessAgentSpec, type HandoffRule, type Prohibition } from "@/lib/agent-compiler/spec/types";
import { DRAFT_TONE_TO_AGENT_TONE, ONBOARDING_RULE_PREFIX, type OnboardingDraft } from "@/lib/agent-compiler/onboarding/draft";
import { selectableResources } from "@/lib/agent-compiler/business-model/resources";

const DEFAULT_TOPIC_REPLY = "Prefiero no hablar de ese tema. ¿Te ayudo con algo más?";
export const HANDOFF_REQUEST_RULE_ID = `${ONBOARDING_RULE_PREFIX}handoff-persona`;

const PERSONALITY: Record<OnboardingDraft["tone"], BusinessAgentSpec["personality"]> = {
  friendly: { primary: "friendly", verbosity: "balanced", emojiPolicy: "limited", formality: "casual" },
  professional: { primary: "professional", verbosity: "balanced", emojiPolicy: "none", formality: "formal" },
  direct: { primary: "direct", verbosity: "concise", emojiPolicy: "none", formality: "neutral" },
  casual: { primary: "friendly", verbosity: "concise", emojiPolicy: "limited", formality: "casual" },
  formal: { primary: "professional", verbosity: "balanced", emojiPolicy: "none", formality: "formal" },
};

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Variantes de una palabra para la comparación determinista del Gate (no distingue mayúsculas; sí tildes). */
function variants(word: string): string[] {
  const w = word.trim().toLowerCase();
  return w ? [...new Set([w, stripAccents(w)])] : [];
}

function topicProhibitions(draft: OnboardingDraft, advanced: Prohibition[]): Prohibition[] {
  const base = Math.max(0, ...advanced.map((p) => p.priority)) + 10;
  const topics = draft.restrictedTopics.filter((t) => t.words.some((w) => w.trim()));
  return topics.map((t, i) => {
    const words = t.words.map((w) => w.trim()).filter(Boolean);
    return {
      id: `${ONBOARDING_RULE_PREFIX}tema-${i + 1}`,
      description: `No hablar de: ${words.join(", ")}`.slice(0, 300),
      scope: "contextual",
      condition: { rules: words.flatMap(variants).slice(0, 50).map((value) => ({ field: "message", operator: "contains" as const, value })), match: "any" },
      action: "FIXED_RESPONSE",
      response: t.reply?.trim() || DEFAULT_TOPIC_REPLY,
      priority: base + (topics.length - i),
    };
  });
}

function businessType(category: string | undefined): Pick<BusinessAgentSpec["identity"], "businessType" | "businessTypeCustom"> {
  if (!category) return {};
  if (BUSINESS_TYPE_OPTIONS.some((o) => o.value === category && o.value !== BUSINESS_TYPE_OTRO)) return { businessType: category };
  return { businessType: BUSINESS_TYPE_OTRO, businessTypeCustom: category };
}

/**
 * Spec (secciones editables) para el runtime vigente. Las reglas AVANZADAS del Spec anterior (editor avanzado: reglas
 * informativas, prohibiciones y transferencias que no generó esta configuración, capacidad de captar datos, documentos)
 * se CONSERVAN: la configuración guiada solo reemplaza lo suyo.
 */
export function buildRuntimeSpec(model: BusinessModel, draft: OnboardingDraft, previous: BusinessAgentSpec | null, meta: { specVersion: number; now: string; authorId?: string }): BusinessAgentSpec {
  const cap = (id: string) => model.capabilities.find((c) => c.id === id);
  const on = (id: string) => Boolean(cap(id)?.enabled);
  const booking = cap("booking")!.config as { provider?: "nylas" | "internal"; minimumNoticeMinutes: number; cancellation: { allowed: boolean; minimumNoticeHours: number } };
  const knowledge = cap("knowledge")!.config as { onNoAnswer: "message" | "handoff"; noAnswerMessage?: string };
  const handoffCfg = cap("handoff")!.config as { pauseHours: number };

  const advancedProhibitions = (previous?.policies.prohibitions ?? []).filter((p) => !p.id.startsWith(ONBOARDING_RULE_PREFIX));
  const advancedHandoff = (previous?.handoff.rules ?? []).filter((h) => !h.id.startsWith(ONBOARDING_RULE_PREFIX));
  const handoffRules: HandoffRule[] = on("handoff")
    ? [
        ...advancedHandoff,
        {
          id: HANDOFF_REQUEST_RULE_ID,
          description: "El cliente pide hablar con una persona.",
          trigger: { kind: "agent_request" },
          action: "TRANSFER_HUMAN",
          response: "Claro, te comunico con una persona del equipo.",
          pauseHours: handoffCfg.pauseHours,
        },
      ]
    : advancedHandoff;

  return {
    schemaVersion: CURRENT_SPEC_SCHEMA_VERSION,
    identity: {
      businessName: model.identity.name,
      agentName: draft.business.assistantName?.trim() || `Asistente de ${model.identity.name}`.slice(0, 120),
      ...(model.identity.description ? { description: model.identity.description } : {}),
      ...businessType(model.identity.category),
      language: model.identity.language,
      timezone: model.identity.timezone,
    },
    personality: PERSONALITY[draft.tone],
    capabilities: {
      faq: on("knowledge"),
      sales: on("quotes"),
      catalog: on("catalog"),
      // FASE 8: guardar interesados es una opción de la configuración guiada (en el grafo = captura de datos del contacto).
      leadCapture: on("lead_capture") || (previous?.capabilities.leadCapture ?? false),
      scheduling: on("booking"),
      orders: false,
      payments: false,
      humanHandoff: on("handoff"),
    },
    catalog: { source: "structured", useServices: draft.offer.services, useProducts: draft.offer.products, quoteBeforeQualification: previous?.catalog.quoteBeforeQualification ?? false },
    policies: { prohibitions: [...advancedProhibitions, ...topicProhibitions(draft, advancedProhibitions)], rules: previous?.policies.rules ?? [] },
    handoff: { rules: handoffRules, defaultPauseHours: on("handoff") ? handoffCfg.pauseHours : (previous?.handoff.defaultPauseHours ?? 24) },
    scheduling: {
      enabled: on("booking"),
      provider: on("booking") && booking.provider ? booking.provider : "none",
      timezone: model.identity.timezone,
      minNoticeMinutes: booking.minimumNoticeMinutes,
      cancellation: { allowed: on("booking") && booking.cancellation.allowed, minNoticeHours: booking.cancellation.minimumNoticeHours },
      confirmation: previous?.scheduling.confirmation ?? { required: false, hoursBefore: 2 },
      resources: previous?.scheduling.resources ?? [],
      ...(model.businessHours ? { businessHours: hoursToHandlerFormat(model.businessHours) } : {}),
    },
    knowledge: {
      authority: "secondary",
      documents: previous?.knowledge.documents ?? [],
      // Sin responder preguntas no hay "sin respuesta" que transferir (el validador del Spec lo exigiría igual).
      onNoAnswer: on("knowledge") ? knowledge.onNoAnswer : "message",
      ...(on("knowledge") && knowledge.noAnswerMessage ? { noAnswerMessage: knowledge.noAnswerMessage } : {}),
    },
    customerData: { fields: model.customerFields.map((f) => ({ ...f })) },
    // FASE 8 — motor publicado + configuración del motor conversacional. El motor solo cambia por elección explícita
    // (draft.engine); si no, se hereda el de la versión anterior (o el grafo).
    runtime: {
      engine: draft.engine ?? previous?.runtime?.engine ?? "graph_v1",
      tone: DRAFT_TONE_TO_AGENT_TONE[draft.tone],
      ...(on("reminders") ? { reminders: { enabled: true, offsetMinutes: (cap("reminders")!.config as { offsetMinutes: number }).offsetMinutes } } : {}),
      ...(selectableResources(model).length > 0 ? { resources: selectableResources(model).map((r) => ({ id: r.id, name: r.name.slice(0, 80), kind: r.kind })) } : {}),
      ...(on("lead_capture") ? { leadCapture: { ...(cap("lead_capture")!.config as { fieldKeys: string[]; captureInterest: boolean }) } } : {}),
    },
    metadata: { specVersion: meta.specVersion, status: "draft", createdAt: meta.now, updatedAt: meta.now, ...(meta.authorId ? { authorId: meta.authorId } : {}) },
  };
}

