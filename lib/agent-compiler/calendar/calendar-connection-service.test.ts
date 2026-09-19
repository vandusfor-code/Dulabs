// DuLabs Business — Agent Compiler, Bloque 15D — tests del servicio de calendario
// (100% offline: store en memoria + cliente Nylas OAuth fake, sin red).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCalendarConnectionService } from "@/lib/agent-compiler/calendar/calendar-connection-service";
import { createInMemoryCalendarStore } from "@/lib/agent-compiler/calendar/testing/in-memory-calendar-store";
import type { NylasCalendar, NylasOAuthClient } from "@/lib/agent-compiler/calendar/types";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const REDIRECT = "https://app.dulabs.co/api/business-agent/calendar/callback";

function fakeNylas(over: { exchange?: (code: string) => Promise<{ grantId: string; accountEmail: string | null }>; calendars?: NylasCalendar[]; failList?: boolean } = {}) {
  const revoked: string[] = [];
  const client: NylasOAuthClient = {
    buildAuthUrl: ({ state, redirectUri }) => `https://api.us.nylas.com/v3/connect/auth?client_id=APP&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async ({ code }) => (over.exchange ? over.exchange(code) : { grantId: `grant-${code}`, accountEmail: "user@example.com" }),
    listCalendars: async () => {
      if (over.failList) throw new Error("nylas down");
      return over.calendars ?? [{ id: "cal-1", name: "Principal", isPrimary: true }, { id: "cal-2", name: "Trabajo" }];
    },
    revokeGrant: async (g) => { revoked.push(g); },
  };
  return { client, revoked };
}

/** Servicio con reloj + state deterministas (para replay/expiry). */
function svc(over: Parameters<typeof fakeNylas>[0] = {}, clock?: { nowMs: number }) {
  const store = createInMemoryCalendarStore();
  const nylas = fakeNylas(over);
  let seq = 0;
  const service = createCalendarConnectionService({
    store,
    nylas: nylas.client,
    now: () => new Date(clock ? clock.nowMs : Date.now()),
    randomState: () => `state-${++seq}`,
  });
  return { store, nylas, service };
}

describe("Bloque 15D — calendar connection service (self-service Nylas)", () => {
  it("13/14. getStatus NUNCA expone grant_id (proyección pública) y el estado inicial es 'pending'", async () => {
    const { service } = svc();
    const status = await service.getStatus(A);
    assert.equal(status.status, "pending");
    assert.equal("grantId" in status, false, "la proyección pública jamás incluye grantId");
  });

  it("connect feliz: startConnect -> callback conecta el grant del tenant correcto", async () => {
    const { service, store } = svc();
    const start = await service.startConnect({ tenantId: A, redirectUri: REDIRECT });
    assert.ok(start.ok && start.authUrl.includes("state=state-1"));
    const cb = await service.handleCallback({ state: "state-1", code: "code-A", redirectUri: REDIRECT });
    assert.ok(cb.ok && cb.tenantId === A);
    const conn = await store.getConnection(A);
    assert.equal(conn?.status, "connected");
    assert.equal(conn?.grantId, "grant-code-A");
    // status público sin grant.
    assert.equal("grantId" in (await service.getStatus(A)), false);
  });

  it("4. el state OAuth es tenant-bound: un state emitido para A SIEMPRE conecta A (el tenant no viene del query)", async () => {
    const { service, store } = svc();
    await service.startConnect({ tenantId: A, redirectUri: REDIRECT }); // state-1 -> A
    // No hay forma de pasar "B": handleCallback resuelve el tenant desde el state.
    const cb = await service.handleCallback({ state: "state-1", code: "c", redirectUri: REDIRECT });
    assert.ok(cb.ok && cb.tenantId === A);
    assert.equal(await store.getConnection(B), null, "B nunca queda conectado con el state de A");
  });

  it("5. callback inválido (state inexistente) => fail-closed, sin conexión", async () => {
    const { service, store } = svc();
    const cb = await service.handleCallback({ state: "no-existe", code: "c", redirectUri: REDIRECT });
    assert.equal(cb.ok, false);
    if (!cb.ok) assert.equal(cb.reason, "invalid_state");
    assert.equal(await store.getConnection(A), null);
  });

  it("5b. callback sin code => fail-closed", async () => {
    const { service } = svc();
    await service.startConnect({ tenantId: A, redirectUri: REDIRECT });
    const cb = await service.handleCallback({ state: "state-1", code: "", redirectUri: REDIRECT });
    assert.equal(cb.ok, false);
  });

  it("6. replay: el mismo state no puede consumirse dos veces", async () => {
    const { service } = svc();
    await service.startConnect({ tenantId: A, redirectUri: REDIRECT });
    const first = await service.handleCallback({ state: "state-1", code: "c1", redirectUri: REDIRECT });
    const replay = await service.handleCallback({ state: "state-1", code: "c2", redirectUri: REDIRECT });
    assert.ok(first.ok);
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.reason, "replayed_state");
  });

  it("6b. state expirado => fail-closed", async () => {
    const clock = { nowMs: 1_000_000 };
    const { service } = svc({}, clock);
    await service.startConnect({ tenantId: A, redirectUri: REDIRECT }); // expiry = now + 10min
    clock.nowMs += 11 * 60 * 1000; // pasan 11 min
    const cb = await service.handleCallback({ state: "state-1", code: "c", redirectUri: REDIRECT });
    assert.equal(cb.ok, false);
    if (!cb.ok) assert.equal(cb.reason, "expired_state");
  });

  it("7/10. grant inexistente => desconectado; listCalendars => not_connected (BOOKING no debe correr)", async () => {
    const { service } = svc();
    assert.equal((await service.getStatus(A)).status, "pending");
    const list = await service.listCalendars(A);
    assert.equal(list.ok, false);
    if (!list.ok) assert.equal(list.reason, "not_connected");
  });

  it("8. exchange falla => estado 'error' (reconexión requerida), sin grant", async () => {
    const { service, store } = svc({ exchange: async () => { throw new Error("nylas 400"); } });
    await service.startConnect({ tenantId: A, redirectUri: REDIRECT });
    const cb = await service.handleCallback({ state: "state-1", code: "c", redirectUri: REDIRECT });
    assert.equal(cb.ok, false);
    if (!cb.ok) assert.equal(cb.reason, "exchange_failed");
    const conn = await store.getConnection(A);
    assert.equal(conn?.status, "error");
    assert.equal(conn?.grantId, null, "nunca se guarda un grant en un intercambio fallido");
  });

  it("9. calendario no seleccionado tras conectar => status connected pero selectedCalendarId null (publish lo detecta)", async () => {
    const { service } = svc();
    await service.startConnect({ tenantId: A, redirectUri: REDIRECT });
    await service.handleCallback({ state: "state-1", code: "c", redirectUri: REDIRECT });
    const status = await service.getStatus(A);
    assert.equal(status.status, "connected");
    assert.equal(status.selectedCalendarId, null);
  });

  it("select calendar válido => se guarda; inválido/ajeno => calendar_not_found", async () => {
    const { service } = svc();
    await service.startConnect({ tenantId: A, redirectUri: REDIRECT });
    await service.handleCallback({ state: "state-1", code: "c", redirectUri: REDIRECT });
    const bad = await service.selectCalendar({ tenantId: A, calendarId: "cal-de-otro" });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.reason, "calendar_not_found");
    const ok = await service.selectCalendar({ tenantId: A, calendarId: "cal-2" });
    assert.ok(ok.ok);
    assert.equal((await service.getStatus(A)).selectedCalendarId, "cal-2");
  });

  it("1/2/3. tenant isolation: A y B tienen grants/calendarios/desconexión independientes", async () => {
    const { service, store } = svc();
    // Conecta A y B (states separados).
    await service.startConnect({ tenantId: A, redirectUri: REDIRECT }); // state-1
    await service.startConnect({ tenantId: B, redirectUri: REDIRECT }); // state-2
    await service.handleCallback({ state: "state-1", code: "cA", redirectUri: REDIRECT });
    await service.handleCallback({ state: "state-2", code: "cB", redirectUri: REDIRECT });
    assert.equal((await store.getConnection(A))?.grantId, "grant-cA");
    assert.equal((await store.getConnection(B))?.grantId, "grant-cB");
    // 2. seleccionar en A no toca B.
    await service.selectCalendar({ tenantId: A, calendarId: "cal-1" });
    assert.equal((await store.getConnection(B))?.selectedCalendarId, null);
    // 3. desconectar A no toca B.
    await service.disconnect(A);
    assert.equal(await store.getConnection(A), null);
    assert.equal((await store.getConnection(B))?.grantId, "grant-cB", "B sigue conectado tras desconectar A");
  });

  it("15. conexión idempotente: reconectar (nuevo state) deja UNA sola conexión por tenant", async () => {
    const { service, store } = svc();
    await service.startConnect({ tenantId: A, redirectUri: REDIRECT }); // state-1
    await service.handleCallback({ state: "state-1", code: "c1", redirectUri: REDIRECT });
    await service.startConnect({ tenantId: A, redirectUri: REDIRECT }); // state-2
    await service.handleCallback({ state: "state-2", code: "c2", redirectUri: REDIRECT });
    assert.equal(store._debug.connections.size, 1, "una sola conexión por tenant (upsert)");
    assert.equal((await store.getConnection(A))?.grantId, "grant-c2");
  });

  it("16. disconnect idempotente: desconectar dos veces no lanza y revoca el grant una vez", async () => {
    const { service, nylas } = svc();
    await service.startConnect({ tenantId: A, redirectUri: REDIRECT });
    await service.handleCallback({ state: "state-1", code: "c", redirectUri: REDIRECT });
    const r1 = await service.disconnect(A);
    const r2 = await service.disconnect(A);
    assert.ok(r1.ok && r2.ok);
    assert.deepEqual(nylas.revoked, ["grant-c"], "revoca el grant una sola vez (la 2ª ya no tiene grant)");
  });

  it("provider_error en listCalendars => no rompe (fail-closed), reason provider_error", async () => {
    const { service } = svc({ failList: true });
    await service.startConnect({ tenantId: A, redirectUri: REDIRECT });
    await service.handleCallback({ state: "state-1", code: "c", redirectUri: REDIRECT });
    const list = await service.listCalendars(A);
    assert.equal(list.ok, false);
    if (!list.ok) assert.equal(list.reason, "provider_error");
  });
});
