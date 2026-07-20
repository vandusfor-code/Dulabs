import Anthropic from "@anthropic-ai/sdk";
import type { ClienteConfig } from "@/lib/supabase";
import { descifrarSecreto } from "@/lib/crypto";

const MODELO = "claude-opus-4-8";

export function construirSystemPrompt(cliente: Pick<ClienteConfig, "prompt_sistema" | "base_conocimiento" | "nombre_negocio">): string {
  let system =
    cliente.prompt_sistema ??
    `Eres el asistente de WhatsApp del negocio "${cliente.nombre_negocio}". Responde de forma breve, amable y útil.`;
  if (cliente.base_conocimiento) {
    system += `\n\n--- Información de referencia del negocio (catálogo, precios o documentos) ---\n${cliente.base_conocimiento}`;
  }
  return system;
}

// Genera la respuesta real de la IA (usada tanto por el webhook de WhatsApp
// como por el playground de prueba en el dashboard), con el mismo prompt y
// el mismo modelo — para que probar en el playground refleje exactamente
// cómo respondería la IA a un cliente real.
export async function generarRespuestaIA(
  cliente: Pick<ClienteConfig, "prompt_sistema" | "base_conocimiento" | "nombre_negocio" | "api_key_ia">,
  textoUsuario: string
): Promise<string | null> {
  const apiKey = cliente.api_key_ia ? descifrarSecreto(cliente.api_key_ia) : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[ia] sin API key de IA configurada");
    return null;
  }

  const anthropic = new Anthropic({ apiKey });
  const system = construirSystemPrompt(cliente);

  try {
    const response = await anthropic.messages.create({
      model: MODELO,
      max_tokens: 1024,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: textoUsuario }],
    });

    const texto = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    return texto || null;
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.error("[ia] IA rate-limited");
    } else if (err instanceof Anthropic.APIError) {
      console.error(`[ia] error de IA ${err.status}:`, err.message);
    } else {
      console.error("[ia] error de IA:", err instanceof Error ? err.message : err);
    }
    return null;
  }
}
