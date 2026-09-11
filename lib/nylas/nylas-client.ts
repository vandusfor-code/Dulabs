/**
 * Boundary aislado Nylas (PILOTO AMORE, autorizado) — la API key solo se lee
 * acá, nunca se loguea, nunca viaja en la URL (siempre header Authorization).
 * Mismo patrón que lib/flow/claude/anthropic-client.ts / lib/flow/gemini/gemini-client.ts.
 */
import type {
  NylasCreateEventParams,
  NylasCreatedEvent,
  NylasDeleteEventParams,
  NylasEvent,
  NylasEventsClient,
  NylasEventsWriteClient,
  NylasListEventsParams,
} from "@/lib/nylas/nylas-types";

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

interface NylasCreateEventResponse {
  request_id?: string;
  data?: { id: string };
}

/**
 * FASE C (autorizado) — cliente de ESCRITURA, separado de
 * createNylasEventsClient (solo lectura, FASE B) para que el camino de
 * disponibilidad nunca pueda crear/borrar un evento por accidente.
 */
export function createNylasEventsWriteClient(apiKey: string): NylasEventsWriteClient {
  return {
    async createEvent(params: NylasCreateEventParams, signal?: AbortSignal): Promise<NylasCreatedEvent> {
      const url = new URL(`${NYLAS_API_BASE}/v3/grants/${encodeURIComponent(params.grantId)}/events`);
      url.searchParams.set("calendar_id", params.calendarId);

      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          title: params.title,
          description: params.description,
          when: {
            start_time: params.startUnix,
            end_time: params.endUnix,
            start_timezone: params.timezone,
            end_timezone: params.timezone,
          },
          // Invitados reales del evento (autorizado) -- mismo campo real que
          // documenta la API de Nylas v3 para agregar participantes/guests a
          // un evento (Google Calendar los notifica e incluye el evento en
          // su calendario de inmediato, sin depender de que respondan la
          // invitación). Omitido = comportamiento idéntico al de siempre
          // (ningún invitado, ningún caller existente lo pasa).
          ...(params.participants ? { participants: params.participants } : {}),
        }),
        signal,
      });

      if (!res.ok) {
        const detalle = await res.text().catch(() => "");
        const err = new Error(`nylas_http_${res.status}: ${detalle.slice(0, 300)}`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }

      const body = (await res.json()) as NylasCreateEventResponse;
      if (!body.data?.id) {
        throw new Error("nylas_respuesta_sin_id: Nylas respondió 2xx pero sin id de evento");
      }
      return { id: body.data.id };
    },

    async deleteEvent(params: NylasDeleteEventParams, signal?: AbortSignal): Promise<void> {
      const url = new URL(`${NYLAS_API_BASE}/v3/grants/${encodeURIComponent(params.grantId)}/events/${encodeURIComponent(params.eventId)}`);
      url.searchParams.set("calendar_id", params.calendarId);

      const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal,
      });

      if (!res.ok) {
        const detalle = await res.text().catch(() => "");
        const err = new Error(`nylas_http_${res.status}: ${detalle.slice(0, 300)}`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
    },
  };
}

export function resolveNylasApiKeyFromEnv(): string | null {
  return process.env.NYLAS_API_KEY ?? null;
}
