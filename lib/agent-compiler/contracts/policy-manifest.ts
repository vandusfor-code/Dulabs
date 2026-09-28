// DuLabs Business — Business Agent 2.0, FASE 1 — manifiesto de políticas en runtime.
//
// Responde de forma verificable: "cada regla que configuró el negocio, ¿llegó al runtime y cómo se aplica?".
// Compara el Spec (lo que el negocio configuró en la UI) con las reglas del Gate que el runtime REALMENTE
// sirve para esa versión (gate_rules persistidas, completadas con su contenido semántico). Una regla que la UI
// presenta como funcional y que no tiene un camino hasta el runtime aparece con un `issue` y bloquea la
// publicación (lib/business-agent-readiness.ts). Las reglas informativas llegan al runtime pero todavía no se
// aplican: se declaran `not_enforced` en vez de fingir que funcionan.

import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { normalizePolicyText, type GateRule } from "@/lib/agent-compiler/runtime/guardrail-gate";

export type PolicyEnforcement = "deterministic" | "semantic" | "not_enforced";

export type PolicyIssue =
  /** La regla está en el Spec pero el runtime no tiene ninguna regla del Gate para ella. */
  | "missing_gate_rule"
  /** Regla semántica sin contenido: el clasificador no puede evaluarla (no se le envía). */
  | "semantic_without_content"
  /** Regla informativa: disponible en runtime, sin aplicación todavía (FASE 2/3). */
  | "not_enforced_yet";

export interface RuntimePolicyEntry {
  ruleId: string;
  kind: "prohibition" | "handoff" | "informational";
  active: boolean;
  scope?: string;
  action?: string;
  /** Texto normalizado de la regla (lo que ve el clasificador cuando es semántica). */
  normalized: string;
  enforcement: PolicyEnforcement;
  /** Ids de las reglas del Gate que la aplican (vacío para informativas). */
  gateRuleIds: string[];
  issue?: PolicyIssue;
}

export interface RuntimePolicyManifest {
  entries: RuntimePolicyEntry[];
  /** Reglas que la UI presenta como funcionales y que NO pueden aplicarse en runtime (bloquean publicar). */
  unenforceable: RuntimePolicyEntry[];
  /** Reglas informativas: llegan al runtime pero todavía no cambian el comportamiento. */
  notEnforced: RuntimePolicyEntry[];
}

function entryForGateRules(
  base: Omit<RuntimePolicyEntry, "enforcement" | "gateRuleIds" | "issue">,
  rules: GateRule[],
): RuntimePolicyEntry {
  if (rules.length === 0) return { ...base, enforcement: "not_enforced", gateRuleIds: [], issue: "missing_gate_rule" };
  const ids = rules.map((r) => r.id);
  const deterministic = rules.some((r) => r.evaluation === "deterministic" && (r.condition?.rules.length ?? 0) > 0);
  if (deterministic) return { ...base, enforcement: "deterministic", gateRuleIds: ids };
  const conContenido = rules.some((r) => r.evaluation === "semantic" && !!r.semantic?.description);
  if (conContenido) return { ...base, enforcement: "semantic", gateRuleIds: ids };
  return { ...base, enforcement: "not_enforced", gateRuleIds: ids, issue: "semantic_without_content" };
}

/**
 * @param gateRules reglas que el runtime sirve para ESTA versión (ya completadas con withSemanticContent).
 */
export function buildRuntimePolicyManifest(spec: Pick<BusinessAgentSpec, "policies" | "handoff">, gateRules: GateRule[]): RuntimePolicyManifest {
  const porOrigen = new Map<string, GateRule[]>();
  for (const r of gateRules) {
    const key = `${r.provenance.kind}:${r.provenance.sourceId}`;
    porOrigen.set(key, [...(porOrigen.get(key) ?? []), r]);
  }

  const entries: RuntimePolicyEntry[] = [];
  for (const p of spec.policies.prohibitions) {
    entries.push(
      entryForGateRules(
        { ruleId: p.id, kind: "prohibition", active: true, scope: p.scope, action: p.action, normalized: normalizePolicyText(p.description) },
        porOrigen.get(`prohibition:${p.id}`) ?? [],
      ),
    );
  }
  for (const h of spec.handoff.rules) {
    entries.push(
      entryForGateRules(
        { ruleId: h.id, kind: "handoff", active: true, action: h.action, normalized: normalizePolicyText(h.description) },
        porOrigen.get(`handoff:${h.id}`) ?? [],
      ),
    );
  }
  for (const r of spec.policies.rules) {
    entries.push({
      ruleId: r.id,
      kind: "informational",
      active: true,
      normalized: normalizePolicyText(r.description),
      enforcement: "not_enforced",
      gateRuleIds: [],
      issue: "not_enforced_yet",
    });
  }

  return {
    entries,
    unenforceable: entries.filter((e) => e.issue === "missing_gate_rule" || e.issue === "semantic_without_content"),
    notEnforced: entries.filter((e) => e.issue === "not_enforced_yet"),
  };
}
