/**
 * Boundary aislado Anthropic — API key solo aquí (Fase 4.2).
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  AnthropicCreateMessageResult,
  AnthropicMessagesClient,
} from "@/lib/flow/claude/claude-types";

const DEFAULT_MODEL = "claude-sonnet-5";

export function createAnthropicMessagesClient(apiKey: string): AnthropicMessagesClient {
  const client = new Anthropic({ apiKey });

  return {
    async createMessage(params, signal) {
      const response = await client.messages.create(
        {
          model: params.model,
          max_tokens: params.max_tokens,
          system: params.system,
          messages: params.messages,
          tools: params.tools?.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema as Anthropic.Tool.InputSchema,
          })),
        },
        signal ? { signal } : undefined,
      );

      return {
        content: response.content.map((block) => {
          if (block.type === "text") return { type: "text" as const, text: block.text };
          if (block.type === "tool_use") {
            return {
              type: "tool_use" as const,
              id: block.id,
              name: block.name,
              input: block.input as Record<string, unknown>,
            };
          }
          return { type: "text" as const, text: "" };
        }),
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
        model: response.model,
      } satisfies AnthropicCreateMessageResult;
    },
  };
}

export function resolveAnthropicApiKeyFromEnv(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? null;
}

export { DEFAULT_MODEL as CLAUDE_DEFAULT_MODEL };
