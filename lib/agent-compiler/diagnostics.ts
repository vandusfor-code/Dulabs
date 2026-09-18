// DuLabs Business — Agent Compiler (Fase 1), Step 5.
//
// Diagnósticos estructurados del Compiler. Nunca "Invalid configuration": cada
// diagnóstico lleva code, severity, phase, path, source y metadata para
// debugging y auditoría empresarial. Un `error` impide la compilación.

export type DiagnosticSeverity = "error" | "warning" | "info";

export type CompilerPhase = "validation" | "semantic_analysis" | "ir_generation";

export interface CompilerDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  phase: CompilerPhase;
  /** Ruta lógica dentro del Spec (ej. "capabilities.payments"). */
  path?: string;
  message: string;
  /** Origen concreto (ej. "prohibition:p1", "capability:scheduling"). */
  source?: string;
  metadata?: Record<string, unknown>;
}

export function diagError(code: string, phase: CompilerPhase, message: string, extra: Partial<CompilerDiagnostic> = {}): CompilerDiagnostic {
  return { code, severity: "error", phase, message, ...extra };
}
export function diagWarning(code: string, phase: CompilerPhase, message: string, extra: Partial<CompilerDiagnostic> = {}): CompilerDiagnostic {
  return { code, severity: "warning", phase, message, ...extra };
}
export function diagInfo(code: string, phase: CompilerPhase, message: string, extra: Partial<CompilerDiagnostic> = {}): CompilerDiagnostic {
  return { code, severity: "info", phase, message, ...extra };
}

export function hasErrors(diagnostics: readonly CompilerDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
