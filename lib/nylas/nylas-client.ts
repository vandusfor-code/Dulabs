/**
 * Boundary aislado Nylas (PILOTO AMORE, autorizado) — la API key solo se lee
 * acá, nunca se loguea, nunca viaja en la URL (siempre header Authorization).
 * Mismo patrón que lib/flow/claude/anthropic-client.ts / lib/flow/gemini/gemini-client.ts.
 */
import type { NylasEvent, NylasEventsClient, NylasListEventsParams } from "@/lib/nylas/nylas-types";

const NYLAS_API_BASE = "https://api.us.nylas.com";
/** Máximo de páginas a seguir por consulta -- un calendario real de un especialista nunca tiene miles de eventos en una sola ventana de un día; este tope es defensivo, nunca se espera alcanzarlo. */
const MAX_PAGINAS = 10;

interface NylasListEventsResponse {
  request_id?: string;
  data?: Array<{ id: string; when: NylasEvent["when"]; status?: string }>;
  next_cursor?: string | null;
}

export function createNylasEventsClient(apiKey: string): NylasEventsClient {
  return {
    async listEvents(params: NylasListEventsParams, signal?: AbortSignal): Promise<NylasEvent[]> {
      const eventos: NylasEvent[] = [];
      let cursor: string | undefined;

      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        const url = new URL(`${NYLAS_API_BASE}/v3/grants/${encodeURIComponent(params.grantId)}/events`);
        url.searchParams.set("calendar_id", params.calendarId);
        url.searchParams.set("start", String(params.startUnix));
        url.searchParams.set("end", String(params.endUnix));
        url.searchParams.set("limit", "200");
        if (cursor) url.searchParams.set("page_token", cursor);

        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
          signal,
        });

        if (!res.ok) {
          const detalle = await res.text().catch(() => "");
          const err = new Error(`nylas_http_${res.status}: ${detalle.slice(0, 300)}`) as Error & { status?: number };
          err.status = res.status;
          throw err;
        }

        const body = (await res.json()) as NylasListEventsResponse;
        for (const fila of body.data ?? []) {
          eventos.push({ id: fila.id, when: fila.when, status: fila.status });
        }

        if (!body.next_cursor) break;
        cursor = body.next_cursor;
      }

      return eventos;
    },
  };
}

export function resolveNylasApiKeyFromEnv(): string | null {
  return process.env.NYLAS_API_KEY ?? null;
}
