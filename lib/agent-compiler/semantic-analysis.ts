// DuLabs Business — Agent Compiler (Fase 1), Step 5.
//
// Análisis semántico: fase explícita que verifica que un BusinessAgentSpec
// (ya válido estructuralmente) pueda compilarse de forma DETERMINISTA contra
// las capacidades REALES del Runtime. No inventa comportamiento: si algo no se
// puede representar con seguridad, emite un diagnóstico `error` que impide la
// compilación. No toca el Runtime; solo razona sobre contratos.

import { CAPABILITY_BACKING, CAPABILITY_KEYS } from "@/lib/agent-compiler/spec/capabilities";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { diagError, diagInfo, diagWarning, type CompilerDiagnostic } from "@/lib/agent-compiler/diagnostics";

/** Contexto de compilación. El tenant SIEMPRE viene del servidor autenticado. */
export interface CompilerContext {
  tenantId: string;
}

/** Campos que el Runtime sabe resolver en una condición (determinista). */
const CAMPOS_RESOLVIBLES = new Set(["message", "intent", "customer_intent", "session_type", "selected_service", "selected_time", "state"]);

const PROVIDERS_CON_RUNTIME = new Set(["internal", "nylas"]); // google_calendar aún no

export function analyzeBusinessAgentSpec(spec: BusinessAgentSpec, context: CompilerContext): CompilerDiagnostic[] {
  const diags: CompilerDiagnostic[] = [];
  const caps = spec.capabilities;

  if (!context.tenantId || typeof context.tenantId !== "string") {
    diags.push(diagError("CONTEXT_TENANT_MISSING", "semantic_analysis", "El contexto de compilación no trae un tenantId del servidor.", { source: "context" }));
  }

  // 1. Capabilities: backing real + dependencias.
  for (const key of CAPABILITY_KEYS) {
    if (!caps[key]) continue;
    const backing = CAPABILITY_BACKING[key];
    if (!backing.available) {
      diags.push(diagError("CAPABILITY_NO_BACKING", "semantic_analysis", `La capability "${key}" no tiene herramienta de Runtime; no puede compilarse.`, { path: `capabilities.${key}`, source: `capability:${key}` }));
      continue;
    }
    for (const req of backing.requires ?? []) {
      if (!caps[req]) diags.push(diagError("CAPABILITY_REQUIRES", "semantic_analysis", `La capability "${key}" requiere "${req}".`, { path: `capabilities.${key}`, source: `capability:${key}`, metadata: { requires: req } }));
    }
  }

  // 2. Scheduling: provider debe tener soporte de Runtime.
  if (spec.scheduling.enabled) {
    if (!caps.scheduling) {
      diags.push(diagError("SCHEDULING_CAPABILITY_OFF", "semantic_analysis", "scheduling.enabled=true pero la capability scheduling está deshabilitada.", { path: "scheduling.enabled" }));
    }
    if (spec.scheduling.provider === "none") {
      diags.push(diagError("SCHEDULING_PROVIDER_NONE", "semantic_analysis", "scheduling habilitado pero provider = none.", { path: "scheduling.provider" }));
    } else if (!PROVIDERS_CON_RUNTIME.has(spec.scheduling.provider)) {
      diags.push(diagError("SCHEDULING_PROVIDER_UNSUPPORTED", "semantic_analysis", `El provider de scheduling "${spec.scheduling.provider}" no tiene soporte de Runtime todavía.`, { path: "scheduling.provider", source: `provider:${spec.scheduling.provider}` }));
    }
  }

  // 3. Human handoff: la transferencia debe tener backing y capability.
  const usaTransferencia = spec.handoff.rules.length > 0 || spec.policies.prohibitions.some((p) => p.action === "TRANSFER_HUMAN");
  if (usaTransferencia) {
    if (!caps.humanHandoff) {
      diags.push(diagError("HANDOFF_CAPABILITY_OFF", "semantic_analysis", "Hay reglas de transferencia pero humanHandoff está deshabilitada.", { path: "capabilities.humanHandoff" }));
    } else if (CAPABILITY_BACKING.humanHandoff.actions.length === 0) {
      diags.push(diagError("HANDOFF_NO_BACKING", "semantic_analysis", "No existe una acción de Runtime para transferir a humano.", { source: "capability:humanHandoff" }));
    }
  }

  // 4. Prohibiciones: contexto determinista + campos resolvibles.
  for (const p of spec.policies.prohibitions) {
    if (p.scope === "contextual" && !p.condition) {
      diags.push(diagError("PROHIBITION_CONTEXT_MISSING", "semantic_analysis", `La prohibición "${p.id}" es contextual pero no trae condición.`, { source: `prohibition:${p.id}` }));
      continue;
    }
    for (const rule of p.condition?.rules ?? []) {
      if (!CAMPOS_RESOLVIBLES.has(rule.field)) {
        diags.push(diagWarning("GUARDRAIL_UNKNOWN_FIELD", "semantic_analysis", `La condición de "${p.id}" usa el campo "${rule.field}" que el Runtime no resuelve de forma estándar; verifícalo.`, { source: `prohibition:${p.id}`, metadata: { field: rule.field } }));
      }
    }
    if (p.action === "TRANSFER_HUMAN" && !caps.humanHandoff) {
      diags.push(diagError("PROHIBITION_TRANSFER_OFF", "semantic_analysis", `La prohibición "${p.id}" transfiere a humano pero humanHandoff está deshabilitada.`, { source: `prohibition:${p.id}` }));
    }
  }

  // 5. Catálogo: los productos (R6) SÍ tienen runtime real (listado + cotización); ya no hay aviso de limitación.

  // 6. Conocimiento: nunca autoridad; aviso si no se usará.
  if (spec.knowledge.documents.length > 0 && !caps.faq) {
    diags.push(diagWarning("KNOWLEDGE_UNUSED", "semantic_analysis", "Hay documentos de conocimiento pero la capability faq está deshabilitada; no se consultarán.", { path: "knowledge.documents" }));
  }

  diags.push(diagInfo("ANALYSIS_OK", "semantic_analysis", "Análisis semántico completado.", { metadata: { capabilitiesActivas: CAPABILITY_KEYS.filter((k) => caps[k]) } }));
  return diags;
}
