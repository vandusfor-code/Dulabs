/**
 * Etapa 4 (Flow Builder, autorizado) — quién puede Guardar/Validar en la UI.
 * Refleja EXACTAMENTE los roles que ya exigen las APIs reales
 * (requireFlowAccess en lib/flow/api-auth.ts: POST /versions = ["admin"],
 * POST /validate = ["admin", "agente"]) -- esto es SOLO reflejo visual para
 * ocultar/deshabilitar los botones; la autorización real sigue viviendo en
 * las rutas, que vuelven a exigir el rol correcto en cada request sin
 * importar lo que esta función devuelva.
 */

import type { Rol } from "@/lib/team";
import { isValidationStale, type BuilderState } from "@/lib/flow-builder/builder-state";

export function canSaveFlow(rol: Rol | null): boolean {
  return rol === "admin";
}

export function canValidateFlow(rol: Rol | null): boolean {
  return rol === "admin" || rol === "agente";
}

/** POST /api/flows/[id]/publish exige admin estricto -- refleja eso, nada más. */
export function canPublishFlow(rol: Rol | null): boolean {
  return rol === "admin";
}

/**
 * Etapa 5 (autorizado) — gate PURO de "¿se puede publicar AHORA?": combina
 * el rol con el estado del editor, sin llamar red ni reimplementar ninguna
 * regla del validador (solo lee `lastValidation.result`, tal cual llegó de
 * POST /validate). Publicar siempre publica `lastSavedVersion.id` -- nunca
 * `state.definition` -- así que las tres condiciones de referencia
 * (lastValidation.definition === lastSavedVersion.definition, más
 * !isValidationStale, que ya exige lastValidation.definition ===
 * state.definition) garantizan, transitivamente, que lo guardado, lo
 * validado y lo que se ve en el canvas son EXACTAMENTE la misma definición
 * -- si hay cualquier cambio sin guardar desde el último guardado o
 * validado, esto da false.
 */
export function canPublishNow(state: BuilderState | null, rol: Rol | null): boolean {
  if (!canPublishFlow(rol)) return false;
  if (!state) return false;
  const { lastSavedVersion, lastValidation } = state;
  if (!lastSavedVersion || !lastValidation) return false;
  if (lastValidation.definition !== lastSavedVersion.definition) return false;
  if (isValidationStale(state)) return false;
  if (!lastValidation.result.valid) return false;
  if (lastValidation.result.errors.length !== 0) return false;
  return true;
}

/**
 * Texto para explicar por qué el botón Publicar está deshabilitado (nunca
 * se llama si el rol ya no puede publicar -- el botón ni se muestra en ese
 * caso, ver FlowTopbar). null significa "listo para publicar".
 */
export function publishDisabledReason(state: BuilderState | null, rol: Rol | null): string | null {
  if (canPublishNow(state, rol)) return null;
  if (!state || !state.lastSavedVersion) return "Guarda primero para poder publicar";
  return "Valida y corrige los errores antes de publicar";
}
