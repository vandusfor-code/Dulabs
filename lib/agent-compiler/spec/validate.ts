// DuLabs Business — Agent Compiler (Fase 1), Step 4.
//
// Validación fuerte del BusinessAgentSpec. Falla ANTES de llegar al
// Compiler/Runtime. Combina: (1) guarda anti-inyección de tenant (el Spec
// nunca lleva tenantId; se rechaza cualquier clave tenant en el input crudo),
// (2) Zod (estructura/enums/requeridos), (3) refinements cross-field que anclan
// las capabilities a herramientas reales y verifican incompatibilidades y
// referencias. El tenant real se deriva del contexto autenticado del servidor,
// no de aquí.

import type { CompilerIssue } from "@/lib/agent-compiler/types";
import { safeParseBusinessAgentSpec } from "@/lib/agent-compiler/spec/schema";
import { CAPABILITY_BACKING, CAPABILITY_KEYS } from "@/lib/agent-compiler/spec/capabilities";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";

export interface SpecValidationResult {
  valid: boolean;
  issues: CompilerIssue[];
}

const CLAVES_TENANT_PROHIBIDAS = new Set(["tenantid", "tenant_id", "id_tenant", "tenant"]);

/** Escanea el input crudo en profundidad buscando claves de tenant inyectadas. */
function detectarInyeccionTenant(input: unknown, issues: CompilerIssue[]): void {
  const visto = new Set<unknown>();
  const recorrer = (valor: unknown): void => {
    if (!valor || typeof valor !== "object" || visto.has(valor)) return;
    visto.add(valor);
    if (Array.isArray(valor)) {
      for (const v of valor) recorrer(v);
      return;
    }
    for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
      if (CLAVES_TENANT_PROHIBIDAS.has(clave.toLowerCase())) {
        issues.push({
          code: "SPEC_TENANT_INJECTION",
          severity: "block",
          message: `El Spec no puede contener la clave "${clave}"; el tenant se deriva del servidor autenticado.`,
          evidence: clave,
        });
      }
      recorrer(v);
    }
  };
  recorrer(input);
}

function issue(code: CompilerIssue["code"], message: string, evidence?: string): CompilerIssue {
  return { code, severity: "block", message, evidence };
}

/** Refinements cross-field sobre un Spec ya parseado por Zod. */
function validarReglasDeNegocio(spec: BusinessAgentSpec, issues: CompilerIssue[]): void {
  const caps = spec.capabilities;

  // (a) Toda capability activa debe tener respaldo REAL en el Runtime.
  for (const key of CAPABILITY_KEYS) {
    if (!caps[key]) continue;
    const backing = CAPABILITY_BACKING[key];
    if (!backing.available) {
      issues.push(issue("CAPABILITY_UNAVAILABLE", `La capability "${key}" no tiene una herramienta de Runtime disponible; no puede habilitarse.`, key));
      continue;
    }
    for (const req of backing.requires ?? []) {
      if (!caps[req]) issues.push(issue("CAPABILITY_INCOMPATIBLE", `La capability "${key}" requiere "${req}" habilitada.`, key));
    }
  }

  // (b) scheduling.enabled debe coincidir con capabilities.scheduling.
  if (spec.scheduling.enabled !== caps.scheduling) {
    issues.push(issue("CAPABILITY_INCOMPATIBLE", `scheduling.enabled (${spec.scheduling.enabled}) no coincide con capabilities.scheduling (${caps.scheduling}).`, "scheduling"));
  }

  // (c) Config de catálogo sin la capability catalog.
  if ((spec.catalog.useServices || spec.catalog.useProducts) && !caps.catalog) {
    issues.push(issue("CAPABILITY_INCOMPATIBLE", "El catálogo está configurado (useServices/useProducts) pero la capability catalog está deshabilitada.", "catalog"));
  }

  // (d) Cualquier acción TRANSFER_HUMAN exige la capability humanHandoff.
  const usaTransferencia =
    spec.handoff.rules.length > 0 ||
    spec.policies.prohibitions.some((p) => p.action === "TRANSFER_HUMAN");
  if (usaTransferencia && !caps.humanHandoff) {
    issues.push(issue("SPEC_REFERENCE_INVALID", "Hay reglas de transferencia a humano pero la capability humanHandoff está deshabilitada.", "humanHandoff"));
  }

  // (e) Prioridades duplicadas de prohibiciones (ambigüedad de precedencia).
  const prioridades = spec.policies.prohibitions.map((p) => p.priority);
  if (new Set(prioridades).size !== prioridades.length) {
    issues.push(issue("SPEC_REFERENCE_INVALID", "Hay prohibiciones con la misma prioridad; la precedencia sería ambigua.", "policies.prohibitions"));
  }
}

/**
 * Valida un BusinessAgentSpec desde un input desconocido (frontend). No confía
 * en TypeScript: parsea con Zod y aplica reglas de negocio deterministas.
 */
export function validateBusinessAgentSpec(input: unknown): SpecValidationResult {
  const issues: CompilerIssue[] = [];

  detectarInyeccionTenant(input, issues);
  if (issues.length > 0) return { valid: false, issues };

  const parsed = safeParseBusinessAgentSpec(input);
  if (!parsed.success) {
    for (const zi of parsed.error.issues) {
      issues.push(issue("SPEC_SCHEMA_INVALID", zi.message, zi.path.join(".") || undefined));
    }
    return { valid: false, issues };
  }

  validarReglasDeNegocio(parsed.data as BusinessAgentSpec, issues);
  return { valid: issues.length === 0, issues };
}
