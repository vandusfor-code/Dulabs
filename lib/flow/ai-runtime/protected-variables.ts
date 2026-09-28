/**
 * Business Agent 2.0, FASE 1 — variables que la IA NUNCA puede escribir (capa GENÉRICA del Flow Engine).
 *
 * Los argumentos que propone la IA (actionProposal.arguments) se vuelven variables de la ejecución
 * (ai-proposal-bridge.ts -> variablesPatch). Antes de esta fase cualquier clave escalar pasaba, incluidas
 * las internas del motor: `__dulabsAiBudget` (el presupuesto de la propia IA), `__verifiedResults`
 * (la evidencia verificada), `__firstMessageText`, o identificadores como `tenantId`/`flowId`.
 *
 * Esta capa aplica a TODO flow (Business Agent y Flow Studio): son claves que por definición pertenecen
 * al runtime y nunca a la IA. La clasificación completa por categorías (USER-CONTROLLED /
 * BUSINESS-CONFIGURED / RUNTIME-DERIVED / SYSTEM-INTERNAL) y los contratos por acción viven en
 * lib/agent-compiler/contracts (solo Business Agent), para no cambiar el comportamiento de flows ajenos.
 */

/** Prefijo reservado para variables internas del motor (presupuesto, evidencia, primer mensaje, bridge...). */
export const INTERNAL_VARIABLE_PREFIX = "__";

/**
 * SYSTEM-INTERNAL: identidad, autorización y control del runtime. Comparación sin distinguir
 * mayúsculas (la IA no puede evadirlo escribiendo `TenantId`).
 */
const SYSTEM_INTERNAL_KEYS_LOWER: ReadonlySet<string> = new Set([
  "tenant",
  "tenantid",
  "tenant_id",
  "id_tenant",
  "businessid",
  "business_id",
  "agentid",
  "agent_id",
  "flowid",
  "flow_id",
  "flowversionid",
  "flow_version_id",
  "versionid",
  "version_id",
  "executionid",
  "execution_id",
  "executionrowid",
  "execution_row_id",
  "effectid",
  "effect_id",
  "phonenumberid",
  "phone_number_id",
  "wabaid",
  "waba_id",
  "wamid",
  "userid",
  "user_id",
  "authorization",
  "authorizationcontext",
  "authorization_context",
  "permissions",
  "apikey",
  "api_key",
  "accesstoken",
  "access_token",
]);

export function isSystemInternalVariableKey(key: string): boolean {
  if (key.startsWith(INTERNAL_VARIABLE_PREFIX)) return true;
  return SYSTEM_INTERNAL_KEYS_LOWER.has(key.toLowerCase());
}
