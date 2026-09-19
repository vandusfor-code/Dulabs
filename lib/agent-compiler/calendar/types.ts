// DuLabs Business — Agent Compiler, Bloque 15A — modelo multi-tenant de calendario.
//
// Relación: tenant → Business Agent → conexión de calendario → grant Nylas →
// calendario seleccionado. Reutiliza la app Nylas EXISTENTE (una API key
// app-level server-side sirve muchos grants por cuenta — ver lib/nylas/*).
//
// SEGURIDAD (invariantes del puerto):
//   - tenant_id SIEMPRE del servidor (sesión), NUNCA del frontend/callback.
//   - grant_id es una credencial: vive server-side, nunca se expone al cliente
//     (la proyección pública lo omite). La tabla real es service_role-only.
//   - El state OAuth es de un solo uso (replay-safe), tenant-bound y con expiry.
//   - Ningún grant cruza entre tenants (todas las operaciones tenant-scoped).

export type CalendarProvider = "nylas";
export type CalendarConnectionStatus = "pending" | "connected" | "revoked" | "error";

/** Fila interna (incluye grant_id sensible). NUNCA se serializa hacia el cliente. */
export interface CalendarConnection {
  tenantId: string;
  provider: CalendarProvider;
  /** Credencial durable de Nylas (por cuenta). Sensible — nunca al cliente. */
  grantId: string | null;
  /** Email de la cuenta conectada (solo display). */
  accountEmail: string | null;
  status: CalendarConnectionStatus;
  selectedCalendarId: string | null;
  selectedCalendarName: string | null;
  connectedAt: string | null;
  updatedAt: string;
}

/** Proyección PÚBLICA (sin grant_id) — lo único que puede ver el cliente/UI. */
export interface CalendarConnectionPublic {
  provider: CalendarProvider;
  status: CalendarConnectionStatus;
  accountEmail: string | null;
  selectedCalendarId: string | null;
  selectedCalendarName: string | null;
  connectedAt: string | null;
}

export function toPublicConnection(c: CalendarConnection | null): CalendarConnectionPublic {
  if (!c) {
    return { provider: "nylas", status: "pending", accountEmail: null, selectedCalendarId: null, selectedCalendarName: null, connectedAt: null };
  }
  // Nunca incluir grantId: se construye campo por campo a propósito.
  return {
    provider: c.provider,
    status: c.status,
    accountEmail: c.accountEmail,
    selectedCalendarId: c.selectedCalendarId,
    selectedCalendarName: c.selectedCalendarName,
    connectedAt: c.connectedAt,
  };
}

export interface NylasCalendar {
  id: string;
  name: string;
  isPrimary?: boolean;
}

/** Resultado atómico de consumir un state OAuth (replay-safe). */
export type ConsumeOAuthStateResult =
  | { ok: true; tenantId: string }
  | { ok: false; reason: "not_found" | "expired" | "already_consumed" };

/**
 * Puerto de persistencia (tenant-scoped). Cada operación aplica el tenant en
 * la query; la implementación Supabase usa service_role (la tabla no tiene
 * política authenticated: grant_id es secreto). Inyectable para tests.
 */
export interface CalendarConnectionStore {
  getConnection(tenantId: string): Promise<CalendarConnection | null>;
  /** Upsert por tenant (una conexión por tenant/Business Agent). Idempotente. */
  saveConnection(conn: CalendarConnection): Promise<void>;
  /** Desconexión idempotente (no error si no existe). */
  deleteConnection(tenantId: string): Promise<void>;

  /** Crea un state OAuth de un solo uso, tenant-bound, con expiry. */
  createOAuthState(input: { state: string; tenantId: string; expiresAt: string }): Promise<void>;
  /**
   * Consume un state ATÓMICAMENTE: devuelve el tenant SOLO si existe, no expiró
   * y no fue consumido; y lo marca consumido en el mismo paso (replay-safe).
   */
  consumeOAuthState(state: string, nowIso: string): Promise<ConsumeOAuthStateResult>;
}

/** Puerto del cliente OAuth de Nylas (Hosted). Inyectable; real gated por env. */
export interface NylasOAuthClient {
  /** URL de Nylas Hosted Auth (/v3/connect/auth) con client_id + state + redirect_uri. */
  buildAuthUrl(input: { state: string; redirectUri: string }): string;
  /** Intercambia el code por un grant (/v3/connect/token). */
  exchangeCode(input: { code: string; redirectUri: string }): Promise<{ grantId: string; accountEmail: string | null }>;
  /** Lista calendarios del grant (/v3/grants/{grantId}/calendars). */
  listCalendars(grantId: string): Promise<NylasCalendar[]>;
  /** Revoca el grant (best-effort en disconnect). */
  revokeGrant(grantId: string): Promise<void>;
}
