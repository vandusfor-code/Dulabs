/**
 * CONTRATO NEUTRAL de proveedores de IA para agentes conversacionales.
 *
 * El agente (lib/agente/*) trabaja SOLO contra esta interfaz: no conoce
 * Gemini, Anthropic ni ningún otro proveedor. Cada proveedor es un adaptador
 * que traduce este contrato a su API.
 *
 * Qué NO hace un proveedor (por diseño):
 *   - ejecutar herramientas: eso es del backend (el runtime del agente);
 *   - decidir tenant, canal o permisos: el modelo solo PIDE herramientas;
 *   - elegir otro proveedor si falla: no hay fallback silencioso;
 *   - streaming: WhatsApp entrega mensajes completos (no aporta nada aquí).
 *
 * Una llamada `generate` es UN paso del modelo: devuelve texto y/o llamadas a
 * herramientas. El bucle (pedir herramienta -> resultado -> razonar de nuevo)
 * vive en el runtime, igual para cualquier proveedor.
 */

export const AI_PROVIDER_IDS = ["gemini"] as const;
/** Proveedores REGISTRADOS. Agregar uno = adaptador + modelos soportados + tests (nunca un default implícito). */
export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];

/** Declaración de una herramienta para el modelo (nombre + JSON Schema de entrada). */
export interface AIToolDeclaration {
  name: string;
  description: string;
  /** JSON Schema (objeto) de los argumentos. El backend VUELVE a validar todo lo que llegue. */
  parameters: Record<string, unknown>;
}

/** Llamada a herramienta pedida por el modelo. `args` es un dato NO confiable. */
export interface AIToolCall {
  /** Id para emparejar la respuesta (el del proveedor o uno asignado por el adaptador). */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AIToolResult {
  callId: string;
  name: string;
  /** Resultado estructurado que produjo el BACKEND (nunca texto libre del modelo). */
  output: Record<string, unknown>;
}

/**
 * Estado opaco que el proveedor necesita para continuar (p. ej. las firmas de
 * pensamiento de Gemini). El runtime lo guarda y lo devuelve tal cual; nunca
 * lo interpreta, lo registra ni lo muestra.
 */
export interface AIContinuation {
  provider: AIProviderId;
  data: unknown;
}

export type AITurn =
  | { role: "user"; text: string }
  | { role: "model"; text: string | null; toolCalls: AIToolCall[]; continuation: AIContinuation | null }
  | { role: "tool"; results: AIToolResult[] };

export type AIThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface AIGenerateRequest {
  model: string;
  /** Instrucciones CONFIABLES (reglas de plataforma + configuración del negocio). */
  system: string;
  turns: AITurn[];
  /** Solo las herramientas permitidas para este agente. Vacío = sin herramientas. */
  tools: AIToolDeclaration[];
  /** "auto": el modelo decide texto o herramientas (restringido a `tools`); "none": solo texto. */
  toolMode: "auto" | "none";
  maxOutputTokens: number;
  thinking?: AIThinkingLevel;
  /** Solo si se configuró explícitamente; por defecto, el del modelo. */
  temperature?: number;
  /** Tope de esta llamada (el adaptador aborta al vencer). */
  timeoutMs: number;
}

export type AIFinishReason = "stop" | "tool_calls" | "max_tokens" | "safety" | "invalid_output" | "other";

export interface AIUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  cachedTokens: number | null;
}

export interface AIGenerateResult {
  provider: AIProviderId;
  /** Modelo que REALMENTE respondió (si el proveedor lo informa). */
  model: string;
  text: string | null;
  toolCalls: AIToolCall[];
  finish: AIFinishReason;
  usage: AIUsage;
  continuation: AIContinuation | null;
  latencyMs: number;
}

export type AIErrorKind =
  | "config" // proveedor/modelo/credencial inválidos: no se llama a nadie
  | "auth"
  | "rate_limit"
  | "timeout"
  | "server"
  | "network"
  | "invalid_request"
  | "safety_blocked"
  | "invalid_response"
  | "unknown";

const RETRYABLE: ReadonlySet<AIErrorKind> = new Set(["rate_limit", "timeout", "server", "network"]);

/**
 * Error NORMALIZADO. Nunca lleva la API key, el cuerpo de la petición ni el
 * texto del cliente: solo el tipo, el estado HTTP y un código corto del
 * proveedor (p. ej. "INVALID_ARGUMENT") para diagnóstico.
 */
export class AIProviderError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly kind: AIErrorKind,
    readonly provider: AIProviderId | null,
    readonly detail: { httpStatus?: number; providerCode?: string } = {},
  ) {
    super(`ai_${kind}${detail.httpStatus ? `:${detail.httpStatus}` : ""}${detail.providerCode ? `:${detail.providerCode}` : ""}`);
    this.name = "AIProviderError";
    this.retryable = RETRYABLE.has(kind);
  }
}

export interface AIProvider {
  readonly id: AIProviderId;
  generate(request: AIGenerateRequest, signal?: AbortSignal): Promise<AIGenerateResult>;
}
