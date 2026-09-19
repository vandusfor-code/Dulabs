/**
 * R4 — aviso al autor de una FAQ: ¿el filtro de afirmaciones externas del
 * runtime (lib/flow/external-claim-security.ts) podría BLOQUEAR esta respuesta
 * cuando el agente la use?
 *
 * Ese filtro es una capa de seguridad compartida (impide que un agente afirme
 * "tu cita quedó confirmada" sin evidencia) y es heurístico: algunas frases
 * legítimas de un negocio ("Puedes agendar tu cita escribiéndonos…", "…servicios
 * ya prestados") coinciden con sus patrones. NO se debilita: si bloquea, el
 * cliente recibe un mensaje seguro (el flujo compilado tiene rama de fallo).
 * Este aviso solo le da visibilidad al autor para que reescriba la respuesta.
 * Solo servidor (importa el módulo de seguridad del runtime).
 */
import { validateTextClaimsAgainstVerified } from "@/lib/flow/external-claim-security";

export interface ClaimRiskResult {
  /** true si, tal cual está escrita, el filtro la bloquearía. */
  risky: boolean;
  /** Mensaje para el autor (español) cuando `risky`. */
  message?: string;
}

/** Nunca lanza: ante cualquier error el aviso simplemente no se emite. */
export function assessClaimRisk(answerText: string): ClaimRiskResult {
  try {
    const verificadas = new Set<never>();
    const r = validateTextClaimsAgainstVerified(answerText, verificadas, { source: "ai_response" } as never);
    if (r.ok) return { risky: false };
    return {
      risky: true,
      message:
        "Esta respuesta contiene frases que el filtro de seguridad del agente podría bloquear (por ejemplo, invitar a agendar o afirmar que algo ya se hizo). Si se bloquea, el cliente recibirá un mensaje genérico. Prueba reescribirla con otras palabras.",
    };
  } catch {
    return { risky: false };
  }
}
