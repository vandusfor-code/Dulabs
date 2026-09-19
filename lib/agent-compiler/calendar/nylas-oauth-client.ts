// DuLabs Business — Agent Compiler, Bloque 15B — cliente Nylas Hosted OAuth (v3).
//
// Reutiliza la app Nylas EXISTENTE (misma API base y modelo de grants que
// lib/nylas/nylas-client.ts). La API key/client_id se leen SOLO acá, nunca se
// loguean, nunca viajan en un log. `createNylasOAuthClientFromEnv` devuelve
// null si faltan credenciales (NYLAS_CLIENT_ID/NYLAS_API_KEY) — el caller
// entonces reporta provider_unavailable, NUNCA simula una conexión.

import type { NylasCalendar, NylasOAuthClient } from "@/lib/agent-compiler/calendar/types";

const NYLAS_API_BASE = "https://api.us.nylas.com";

interface NylasTokenResponse {
  grant_id?: string;
  email?: string;
}
interface NylasCalendarsResponse {
  data?: Array<{ id: string; name?: string; is_primary?: boolean }>;
}

export function createNylasOAuthClient(config: { clientId: string; apiKey: string }): NylasOAuthClient {
  const { clientId, apiKey } = config;
  return {
    buildAuthUrl({ state, redirectUri }) {
      const url = new URL(`${NYLAS_API_BASE}/v3/connect/auth`);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("state", state);
      return url.toString();
    },

    async exchangeCode({ code, redirectUri }) {
      const res = await fetch(`${NYLAS_API_BASE}/v3/connect/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          // Nylas v3: el "client_secret" del intercambio es la API key de la app.
          client_secret: apiKey,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!res.ok) {
        const detalle = await res.text().catch(() => "");
        throw new Error(`nylas_token_http_${res.status}: ${detalle.slice(0, 200)}`);
      }
      const body = (await res.json()) as NylasTokenResponse;
      if (!body.grant_id) throw new Error("nylas_token_sin_grant_id");
      return { grantId: body.grant_id, accountEmail: body.email ?? null };
    },

    async listCalendars(grantId) {
      const res = await fetch(`${NYLAS_API_BASE}/v3/grants/${encodeURIComponent(grantId)}/calendars`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      if (!res.ok) {
        const detalle = await res.text().catch(() => "");
        throw new Error(`nylas_calendars_http_${res.status}: ${detalle.slice(0, 200)}`);
      }
      const body = (await res.json()) as NylasCalendarsResponse;
      const calendars: NylasCalendar[] = (body.data ?? []).map((c) => ({
        id: c.id,
        name: c.name ?? c.id,
        isPrimary: c.is_primary,
      }));
      return calendars;
    },

    async revokeGrant(grantId) {
      const res = await fetch(`${NYLAS_API_BASE}/v3/grants/${encodeURIComponent(grantId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      if (!res.ok && res.status !== 404) {
        const detalle = await res.text().catch(() => "");
        throw new Error(`nylas_revoke_http_${res.status}: ${detalle.slice(0, 200)}`);
      }
    },
  };
}

/** Cliente real desde env, o null si faltan credenciales (NUNCA simula). */
export function createNylasOAuthClientFromEnv(): NylasOAuthClient | null {
  const clientId = process.env.NYLAS_CLIENT_ID;
  const apiKey = process.env.NYLAS_API_KEY;
  if (!clientId || !apiKey) return null;
  return createNylasOAuthClient({ clientId, apiKey });
}
