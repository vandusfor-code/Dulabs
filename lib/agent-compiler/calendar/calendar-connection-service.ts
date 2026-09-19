// DuLabs Business — Agent Compiler, Bloque 15B — servicio de conexión de
// calendario self-service (lógica pura, sin HTTP; los routes son adaptadores).
//
// Flujo: startConnect (state seguro) → Nylas Hosted OAuth → handleCallback
// (consume state, resuelve tenant DESDE EL STORE, intercambia code por grant) →
// listCalendars → selectCalendar → (disconnect). Todo tenant-scoped.
//
// SEGURIDAD:
//   - El tenant del callback NUNCA viene del query: se deriva del state
//     consumido (tenant-bound en createOAuthState). Un state de A no puede
//     usarse para escribir en B.
//   - State de un solo uso (replay-safe) + expiry (consumeOAuthState atómico).
//   - grant_id nunca se devuelve al cliente (solo proyección pública).
//   - selectCalendar valida el calendarId contra la lista REAL del grant del
//     tenant (el cliente no puede fijar un calendario arbitrario/ajeno).
//   - Fail-closed: state inválido/expirado/consumido, o error del proveedor,
//     no producen una conexión válida ni cruzan credenciales.

import { randomBytes } from "node:crypto";
import {
  toPublicConnection,
  type CalendarConnection,
  type CalendarConnectionPublic,
  type CalendarConnectionStore,
  type NylasCalendar,
  type NylasOAuthClient,
} from "@/lib/agent-compiler/calendar/types";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 min: suficiente para el consentimiento OAuth.

export interface CalendarServiceDeps {
  store: CalendarConnectionStore;
  nylas: NylasOAuthClient;
  now?: () => Date;
  /** Generador de state (inyectable para test). Default: 32 bytes aleatorios. */
  randomState?: () => string;
}

export type StartConnectResult = { ok: true; authUrl: string } | { ok: false; reason: "provider_unavailable" };

export type CallbackResult =
  | { ok: true; tenantId: string }
  | { ok: false; reason: "invalid_state" | "expired_state" | "replayed_state" | "exchange_failed" };

export type ListCalendarsResult =
  | { ok: true; calendars: NylasCalendar[] }
  | { ok: false; reason: "not_connected" | "provider_error" };

export type SelectCalendarResult =
  | { ok: true }
  | { ok: false; reason: "not_connected" | "calendar_not_found" | "provider_error" };

export function createCalendarConnectionService(deps: CalendarServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const randomState = deps.randomState ?? (() => randomBytes(32).toString("base64url"));

  async function getStatus(tenantId: string): Promise<CalendarConnectionPublic> {
    return toPublicConnection(await deps.store.getConnection(tenantId));
  }

  async function startConnect(input: { tenantId: string; redirectUri: string }): Promise<StartConnectResult> {
    const state = randomState();
    const expiresAt = new Date(now().getTime() + STATE_TTL_MS).toISOString();
    await deps.store.createOAuthState({ state, tenantId: input.tenantId, expiresAt });
    return { ok: true, authUrl: deps.nylas.buildAuthUrl({ state, redirectUri: input.redirectUri }) };
  }

  async function handleCallback(input: { state: string; code: string; redirectUri: string }): Promise<CallbackResult> {
    if (!input.state || !input.code) return { ok: false, reason: "invalid_state" };

    // El tenant se resuelve DESDE EL STORE vía el state (tenant-bound), nunca
    // desde el query — y el consumo es atómico (replay-safe).
    const consumed = await deps.store.consumeOAuthState(input.state, now().toISOString());
    if (!consumed.ok) {
      const reason = consumed.reason === "expired" ? "expired_state" : consumed.reason === "already_consumed" ? "replayed_state" : "invalid_state";
      return { ok: false, reason };
    }
    const tenantId = consumed.tenantId;

    let exchanged: { grantId: string; accountEmail: string | null };
    try {
      exchanged = await deps.nylas.exchangeCode({ code: input.code, redirectUri: input.redirectUri });
    } catch {
      // Fail-closed: no se crea conexión válida; se registra estado de error
      // (sin grant) para que la UI muestre "reconectar", nunca credenciales.
      await deps.store.saveConnection({
        tenantId,
        provider: "nylas",
        grantId: null,
        accountEmail: null,
        status: "error",
        selectedCalendarId: null,
        selectedCalendarName: null,
        connectedAt: null,
        updatedAt: now().toISOString(),
      });
      return { ok: false, reason: "exchange_failed" };
    }

    const nowIso = now().toISOString();
    await deps.store.saveConnection({
      tenantId,
      provider: "nylas",
      grantId: exchanged.grantId,
      accountEmail: exchanged.accountEmail,
      status: "connected",
      selectedCalendarId: null,
      selectedCalendarName: null,
      connectedAt: nowIso,
      updatedAt: nowIso,
    });
    return { ok: true, tenantId };
  }

  async function connectedGrant(tenantId: string): Promise<CalendarConnection | null> {
    const conn = await deps.store.getConnection(tenantId);
    if (!conn || conn.status !== "connected" || !conn.grantId) return null;
    return conn;
  }

  async function listCalendars(tenantId: string): Promise<ListCalendarsResult> {
    const conn = await connectedGrant(tenantId);
    if (!conn || !conn.grantId) return { ok: false, reason: "not_connected" };
    try {
      return { ok: true, calendars: await deps.nylas.listCalendars(conn.grantId) };
    } catch {
      return { ok: false, reason: "provider_error" };
    }
  }

  async function selectCalendar(input: { tenantId: string; calendarId: string }): Promise<SelectCalendarResult> {
    const conn = await connectedGrant(input.tenantId);
    if (!conn || !conn.grantId) return { ok: false, reason: "not_connected" };
    let calendars: NylasCalendar[];
    try {
      calendars = await deps.nylas.listCalendars(conn.grantId);
    } catch {
      return { ok: false, reason: "provider_error" };
    }
    // El cliente no puede fijar un calendario arbitrario: debe pertenecer a la
    // lista real del grant de ESTE tenant.
    const chosen = calendars.find((c) => c.id === input.calendarId);
    if (!chosen) return { ok: false, reason: "calendar_not_found" };
    await deps.store.saveConnection({
      ...conn,
      selectedCalendarId: chosen.id,
      selectedCalendarName: chosen.name,
      updatedAt: now().toISOString(),
    });
    return { ok: true };
  }

  async function disconnect(tenantId: string): Promise<{ ok: true }> {
    const conn = await deps.store.getConnection(tenantId);
    if (conn?.grantId) {
      try {
        await deps.nylas.revokeGrant(conn.grantId); // best-effort
      } catch {
        // Revocar en Nylas es best-effort: aunque falle, borramos la conexión
        // local para no seguir usando un grant que el usuario quiso soltar.
      }
    }
    await deps.store.deleteConnection(tenantId); // idempotente
    return { ok: true };
  }

  return { getStatus, startConnect, handleCallback, listCalendars, selectCalendar, disconnect };
}
