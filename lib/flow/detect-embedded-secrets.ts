/**
 * Detección de secretos embebidos en definition_json (Fase 3.1).
 * Escanea valores (no solo nombres de clave) con patrones razonables.
 *
 * Frontera Enterprise: headers/URLs con credenciales deben vivir en
 * dulabs_flow_integrations + dulabs_flow_credentials, no en el grafo.
 */

const SENSITIVE_KEY =
  /^(api[_-]?key|api[_-]?token|apikey|client[_-]?secret|clientsecret|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|private[_-]?key|encrypted[_-]?value|meta[_-]?permanent[_-]?token|authorization|x[_-]api[_-]key|x[_-]auth[_-]token)$/i;

const JWT_VALUE = /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Bearer con token real (≥20 chars), no texto instructivo. */
const BEARER_SECRET = /^Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*$/i;

const BASIC_AUTH_SECRET = /^Basic\s+[A-Za-z0-9+/=]{20,}$/i;

const SK_OPENAI = /^sk-(live|test)-[A-Za-z0-9]{10,}$/;

const AWS_ACCESS_KEY = /^AKIA[0-9A-Z]{16}$/;

const PRIVATE_KEY_BLOCK = /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE KEY-----/;

const URL_EMBEDDED_CREDS = /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i;

/** Placeholders de variables del flow — no son secretos. */
const VARIABLE_PLACEHOLDER = /^\{\{[a-zA-Z0-9_.]+\}\}$/;

const INSTRUCTIONAL_BEARER =
  /^Bearer\s+(authentication|auth|token|required|header|credential|is required|must be provided)/i;

/** Claves cuyo nombre indica material sensible (observabilidad / publish). */
export function isSensitiveKeyName(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

function isEmptyOrPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || VARIABLE_PLACEHOLDER.test(trimmed);
}

function isCredentialReference(value: string): boolean {
  return /\{\{[a-zA-Z0-9_.]+\}\}/.test(value);
}

function looksLikeSecretValue(value: string, keyHint?: string): boolean {
  const trimmed = value.trim();
  if (isEmptyOrPlaceholder(trimmed)) return false;
  if (isCredentialReference(trimmed)) return false;

  if (INSTRUCTIONAL_BEARER.test(trimmed)) return false;

  if (JWT_VALUE.test(trimmed)) return true;
  if (BEARER_SECRET.test(trimmed)) return true;
  if (BASIC_AUTH_SECRET.test(trimmed)) return true;
  if (SK_OPENAI.test(trimmed)) return true;
  if (AWS_ACCESS_KEY.test(trimmed)) return true;
  if (PRIVATE_KEY_BLOCK.test(trimmed)) return true;
  if (URL_EMBEDDED_CREDS.test(trimmed)) return true;

  const key = keyHint?.toLowerCase() ?? "";
  if (SENSITIVE_KEY.test(key)) {
    if (trimmed.length >= 8 && !/^(true|false|null|undefined|none|n\/a)$/i.test(trimmed)) {
      return true;
    }
  }

  if (/^(authorization|x-api-key|x-auth-token)$/i.test(key)) {
    if (BEARER_SECRET.test(trimmed) || BASIC_AUTH_SECRET.test(trimmed)) return true;
    if (trimmed.length >= 24 && /^[A-Za-z0-9\-._~+/=]+$/.test(trimmed)) return true;
  }

  if (/^client[_-]?secret$/i.test(key) && trimmed.length >= 12) return true;

  return false;
}

function scanValue(value: unknown, keyHint?: string): boolean {
  if (typeof value === "string") {
    return looksLikeSecretValue(value, keyHint);
  }
  if (Array.isArray(value)) {
    return value.some((item) => scanValue(item, keyHint));
  }
  if (value !== null && typeof value === "object") {
    return scanObject(value as Record<string, unknown>);
  }
  return false;
}

function scanObject(obj: Record<string, unknown>): boolean {
  for (const [key, val] of Object.entries(obj)) {
    if (scanValue(val, key)) return true;
  }
  return false;
}

/**
 * Retorna true si definition_json contiene secretos embebidos.
 */
export function definitionContainsEmbeddedSecrets(definition: Record<string, unknown>): boolean {
  return scanObject(definition);
}

/** Expuesto para tests adversariales. */
export function looksLikeEmbeddedSecret(value: string, keyHint?: string): boolean {
  return looksLikeSecretValue(value, keyHint);
}
