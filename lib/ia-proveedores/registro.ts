/**
 * Resolución EXPLÍCITA de proveedor, modelo y credencial — fail-closed.
 *
 * - No existe proveedor ni modelo "por defecto": si la configuración no los
 *   declara o no son soportados, NO se llama a ningún modelo (el agente queda
 *   inactivo y se registra el motivo).
 * - Nunca hay fallback: una configuración de Gemini jamás termina usando
 *   Anthropic ni otro proveedor.
 * - La credencial se referencia (`env:GEMINI_KEY_DELACOUR`), nunca se guarda
 *   el secreto en la configuración, y no cae a otra clave si falta la suya.
 */
import { AI_PROVIDER_IDS, type AIProvider, type AIProviderId } from "@/lib/ia-proveedores/contrato";
import { createGeminiProvider } from "@/lib/ia-proveedores/gemini";

/**
 * Modelos que la plataforma soporta por proveedor (lista cerrada). Agregar un
 * modelo = cambio revisado + tests de contrato, nunca un string libre en la BD.
 * gemini-3.6-flash: el que ya usa DuLabs (GEMINI_DEFAULT_MODEL, verificado en
 * vivo en la FASE B) y que figura en la lista oficial de @google/genai.
 */
export const SUPPORTED_MODELS: Readonly<Record<AIProviderId, readonly string[]>> = {
  gemini: ["gemini-3.6-flash"],
};

/** Variables de entorno que cada proveedor puede usar como credencial. */
const CREDENTIAL_ENV: Readonly<Record<AIProviderId, RegExp>> = {
  gemini: /^GEMINI_KEY(_[A-Z0-9][A-Z0-9_]{0,39})?$/,
};

export interface AIProviderConfigInput {
  provider: unknown;
  model: unknown;
  /** Referencia a la credencial: "env:NOMBRE_VARIABLE". */
  credentialRef: unknown;
}

export type AIProviderConfigError =
  | "provider_missing"
  | "provider_unsupported"
  | "model_missing"
  | "model_unsupported"
  | "credential_ref_invalid"
  | "credential_missing";

export type AIProviderResolution =
  | { ok: true; provider: AIProvider; providerId: AIProviderId; model: string }
  | { ok: false; reason: AIProviderConfigError };

export interface AIProviderFactories {
  gemini: (apiKey: string) => AIProvider;
}

const DEFAULT_FACTORIES: AIProviderFactories = {
  gemini: (apiKey) => createGeminiProvider({ apiKey }),
};

export function isSupportedProvider(value: unknown): value is AIProviderId {
  return typeof value === "string" && (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Valida SOLO la forma (sin leer secretos): útil al guardar configuración. */
export function validateAIProviderConfig(input: AIProviderConfigInput): { ok: true; providerId: AIProviderId; model: string; envVar: string } | { ok: false; reason: AIProviderConfigError } {
  if (input.provider === undefined || input.provider === null || input.provider === "") return { ok: false, reason: "provider_missing" };
  if (!isSupportedProvider(input.provider)) return { ok: false, reason: "provider_unsupported" };
  if (typeof input.model !== "string" || input.model === "") return { ok: false, reason: "model_missing" };
  if (!SUPPORTED_MODELS[input.provider].includes(input.model)) return { ok: false, reason: "model_unsupported" };
  const ref = typeof input.credentialRef === "string" ? /^env:(.+)$/.exec(input.credentialRef) : null;
  if (!ref || !CREDENTIAL_ENV[input.provider].test(ref[1])) return { ok: false, reason: "credential_ref_invalid" };
  return { ok: true, providerId: input.provider, model: input.model, envVar: ref[1] };
}

/**
 * Construye el proveedor configurado o falla cerrado. `env` se inyecta (tests)
 * y por defecto es process.env; el secreto nunca sale de aquí salvo hacia el
 * adaptador.
 */
export function resolveAIProvider(
  input: AIProviderConfigInput,
  deps: { env?: Record<string, string | undefined>; factories?: Partial<AIProviderFactories> } = {},
): AIProviderResolution {
  const valid = validateAIProviderConfig(input);
  if (!valid.ok) return valid;
  const secret = (deps.env ?? process.env)[valid.envVar]?.trim();
  if (!secret) return { ok: false, reason: "credential_missing" };
  const factory = { ...DEFAULT_FACTORIES, ...deps.factories }[valid.providerId];
  return { ok: true, provider: factory(secret), providerId: valid.providerId, model: valid.model };
}
