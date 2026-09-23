/**
 * Proveedor SIMULADO y determinista para pruebas (ninguna prueba llama a un
 * modelo real). Cada paso del guion es la respuesta a UNA llamada `generate`:
 * texto, llamadas a herramientas, un error normalizado, o una función que
 * decide según la petición (p. ej. según el resultado de la última herramienta).
 *
 * Registra cada petición recibida para que las pruebas verifiquen qué se le
 * envió al modelo (herramientas permitidas, contexto, que no haya secretos…).
 */
import {
  AIProviderError,
  type AIGenerateRequest,
  type AIGenerateResult,
  type AIProvider,
  type AIProviderId,
  type AIToolCall,
} from "@/lib/ia-proveedores/contrato";

export type SimulatedStep =
  | { text: string }
  | { toolCalls: Array<{ name: string; args: Record<string, unknown> }>; text?: string }
  | { error: AIProviderError }
  | { finish: AIGenerateResult["finish"]; text?: string }
  | ((request: AIGenerateRequest) => SimulatedStep);

export interface SimulatedProvider extends AIProvider {
  readonly requests: AIGenerateRequest[];
  /** Pasos del guion aún no consumidos. */
  remaining(): number;
}

export function createSimulatedProvider(script: SimulatedStep[], opts: { id?: AIProviderId; model?: string } = {}): SimulatedProvider {
  const steps = [...script];
  const requests: AIGenerateRequest[] = [];
  let calls = 0;
  const id = opts.id ?? "gemini";

  function resolve(step: SimulatedStep, req: AIGenerateRequest): Exclude<SimulatedStep, (r: AIGenerateRequest) => SimulatedStep> {
    return typeof step === "function" ? resolve(step(req), req) : step;
  }

  return {
    id,
    requests,
    remaining: () => steps.length,
    async generate(req) {
      requests.push(structuredClone(req));
      const next = steps.shift();
      // Guion agotado = la prueba no previó esta llamada: se falla fuerte, nunca se inventa una respuesta.
      if (!next) throw new Error(`simulated provider: guion agotado en la llamada ${calls + 1}`);
      calls++;
      const step = resolve(next, req);
      if ("error" in step) throw step.error;
      const toolCalls: AIToolCall[] = "toolCalls" in step ? step.toolCalls.map((c, i) => ({ id: `sim-${calls}-${i}`, name: c.name, args: c.args })) : [];
      const text = "text" in step && step.text ? step.text : null;
      const finish = "finish" in step ? step.finish : toolCalls.length > 0 ? "tool_calls" : "stop";
      return {
        provider: id,
        model: opts.model ?? req.model,
        text,
        toolCalls,
        finish,
        usage: { inputTokens: 100, outputTokens: 20, thinkingTokens: null, cachedTokens: null },
        continuation: { provider: id, data: { simulatedCall: calls } },
        latencyMs: 1,
      };
    },
  };
}

export { AIProviderError };
