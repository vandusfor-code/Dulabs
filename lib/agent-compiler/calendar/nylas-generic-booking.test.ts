/**
 * Bloque 16 — agendamiento genérico Nylas (lib/agent-compiler/calendar/
 * nylas-generic-booking.ts). 100% offline: fake Supabase mínimo (solo
 * dulabs_idempotencia_reservas, mismo patrón que reserva-servicio-nylas.test.ts),
 * store de calendario en memoria (Bloque 15) y clientes Nylas fake -- nunca
 * red real, nunca Supabase real.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearCitaNylasGenerico, hayConflictoDeHorario, type CrearCitaNylasGenericoDeps, type CrearCitaNylasGenericoParams } from "@/lib/agent-compiler/calendar/nylas-generic-booking";
import { createInMemoryCalendarStore } from "@/lib/agent-compiler/calendar/testing/in-memory-calendar-store";
import type { CalendarConnectionStore } from "@/lib/agent-compiler/calendar/types";
import type { NylasEvent, NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

// ---------------------------------------------------------------------------
// Fake Supabase mínimo -- SOLO dulabs_idempotencia_reservas (mismo patrón que
// lib/reserva-servicio-nylas.test.ts, recortado a la única tabla que
// ejecutarConIdempotencia toca).
// ---------------------------------------------------------------------------
type FilaGenerica = Record<string, unknown>;

function crearSupabaseFalso(): SupabaseClient {
  const filas: FilaGenerica[] = [];
  const from = (tabla: string) => {
    if (tabla !== "dulabs_idempotencia_reservas") throw new Error(`tabla inesperada en el fake: ${tabla}`);
    const filtros: Array<(f: FilaGenerica) => boolean> = [];
    let modoInsert: FilaGenerica | undefined;
    let modoUpdate: FilaGenerica | undefined;

    function ejecutar(): { data: FilaGenerica[]; error: { code: string; message: string } | null } {
      if (modoInsert) {
        const nueva = modoInsert;
        const yaExiste = filas.some((f) => f.id_tenant === nueva.id_tenant && f.idempotency_key === nueva.idempotency_key);
        if (yaExiste) return { data: [], error: { code: "23505", message: "duplicate key" } };
        const filaCompleta = { resultado_json: null, ...nueva };
        filas.push(filaCompleta);
        return { data: [filaCompleta], error: null };
      }
      if (modoUpdate) {
        for (const f of filas) {
          if (filtros.every((fn) => fn(f))) Object.assign(f, modoUpdate);
        }
        return { data: [], error: null };
      }
      return { data: filas.filter((f) => filtros.every((fn) => fn(f))), error: null };
    }

    const builder = {
      select() {
        return builder;
      },
      eq(campo: string, valor: unknown) {
        filtros.push((f) => f[campo] === valor);
        return builder;
      },
      insert(fila: FilaGenerica) {
        modoInsert = fila;
        return builder;
      },
      update(cambios: FilaGenerica) {
        modoUpdate = cambios;
        return builder;
      },
      async maybeSingle() {
        const r = ejecutar();
        return { data: r.data[0] ?? null, error: r.error };
      },
      then(resolve: (r: { data: FilaGenerica[]; error: unknown }) => unknown) {
        return resolve(ejecutar());
      },
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Fakes Nylas
// ---------------------------------------------------------------------------
function fakeReadClient(eventos: NylasEvent[] = [], opts: { throws?: boolean } = {}): NylasEventsClient & { llamadas: number } {
  const client = {
    llamadas: 0,
    async listEvents() {
      client.llamadas++;
      if (opts.throws) throw new Error("nylas down");
      return eventos;
    },
  };
  return client;
}

function fakeWriteClient(opts: { throws?: boolean; idPrefix?: string } = {}): NylasEventsWriteClient & { creados: number } {
  const client = {
    creados: 0,
    async createEvent() {
      client.creados++;
      if (opts.throws) throw new Error("nylas write down");
      return { id: `${opts.idPrefix ?? "evt"}-${client.creados}` };
    },
    async deleteEvent() {},
  };
  return client;
}

function conectarCalendario(store: CalendarConnectionStore, tenantId: string, over: { grantId?: string | null; calendarId?: string | null; status?: "connected" | "error" | "pending" } = {}) {
  return store.saveConnection({
    tenantId,
    provider: "nylas",
    grantId: over.grantId ?? `grant-${tenantId}`,
    accountEmail: "negocio@example.com",
    status: over.status ?? "connected",
    selectedCalendarId: over.calendarId === undefined ? `cal-${tenantId}` : over.calendarId,
    selectedCalendarName: "Principal",
    connectedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

function baseParams(over: Partial<CrearCitaNylasGenericoParams> = {}): CrearCitaNylasGenericoParams {
  return {
    tenantId: TENANT_A,
    executionRowId: "exec-1",
    effectId: "effect-1",
    fecha: "2026-03-10",
    hora: "14:00",
    nombreCliente: "Ana Pérez",
    servicio: "Corte",
    ...over,
  };
}

function armarDeps(over: Partial<CrearCitaNylasGenericoDeps> = {}): { deps: CrearCitaNylasGenericoDeps; store: CalendarConnectionStore; read: ReturnType<typeof fakeReadClient>; write: ReturnType<typeof fakeWriteClient> } {
  const store = over.calendarStore ?? createInMemoryCalendarStore();
  const read = fakeReadClient();
  const write = fakeWriteClient();
  return {
    store,
    read,
    write,
    deps: {
      supabase: crearSupabaseFalso(),
      calendarStore: store,
      nylasApiKey: "api-key-fake",
      createNylasEventsClient: () => read,
      createNylasEventsWriteClient: () => write,
      ...over,
    },
  };
}

describe("hayConflictoDeHorario — detección pura de solape", () => {
  it("timespan que se solapa -> conflicto", () => {
    const evt: NylasEvent = { id: "e1", when: { object: "timespan", start_time: 1000, end_time: 2000 }, status: "confirmed" };
    assert.equal(hayConflictoDeHorario([evt], 1500, 2500), true);
  });

  it("timespan sin solape -> sin conflicto", () => {
    const evt: NylasEvent = { id: "e1", when: { object: "timespan", start_time: 1000, end_time: 2000 }, status: "confirmed" };
    assert.equal(hayConflictoDeHorario([evt], 2000, 3000), false, "adyacente, no se solapa (end exclusivo)");
  });

  it("evento cancelado nunca ocupa horario", () => {
    const evt: NylasEvent = { id: "e1", when: { object: "timespan", start_time: 1000, end_time: 2000 }, status: "cancelled" };
    assert.equal(hayConflictoDeHorario([evt], 1000, 2000), false);
  });

  it("evento de día completo (datespan) bloquea todo ese día", () => {
    const evt: NylasEvent = { id: "e1", when: { object: "datespan", start_date: "2026-03-10", end_date: "2026-03-10" }, status: "confirmed" };
    const inicioTarde = Math.floor(new Date("2026-03-10T14:00:00-05:00").getTime() / 1000);
    assert.equal(hayConflictoDeHorario([evt], inicioTarde, inicioTarde + 3600), true);
  });

  it("sin eventos -> sin conflicto", () => {
    assert.equal(hayConflictoDeHorario([], 1000, 2000), false);
  });
});

describe("crearCitaNylasGenerico — Bloque 16 (offline)", () => {
  it("1. calendario no conectado (pending) -> rechazado, nunca llama a Nylas", async () => {
    const { deps, read, write } = armarDeps();
    const r = await crearCitaNylasGenerico(deps, baseParams());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "calendario_no_conectado");
    assert.equal(read.llamadas, 0);
    assert.equal(write.creados, 0);
  });

  it("2. tenant isolation: el calendario de B nunca se usa para una solicitud de A", async () => {
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_B, { grantId: "grant-de-B", calendarId: "cal-de-B" });
    const { deps } = armarDeps({ calendarStore: store });
    const r = await crearCitaNylasGenerico(deps, baseParams({ tenantId: TENANT_A }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "calendario_no_conectado", "A no tiene conexión propia; el grant de B jamás se usa para A");
  });

  it("3. proveedor no disponible (sin API key) -> rechazado", async () => {
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_A);
    const { deps } = armarDeps({ calendarStore: store, nylasApiKey: null });
    const r = await crearCitaNylasGenerico(deps, baseParams());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "proveedor_no_disponible");
  });

  it("4. horario ocupado -> NO crea evento", async () => {
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_A);
    const inicioUnix = Math.floor(new Date("2026-03-10T14:00:00-05:00").getTime() / 1000);
    const ocupado: NylasEvent = { id: "existing", when: { object: "timespan", start_time: inicioUnix, end_time: inicioUnix + 3600 }, status: "confirmed" };
    const read = fakeReadClient([ocupado]);
    const write = fakeWriteClient();
    const r = await crearCitaNylasGenerico({ supabase: crearSupabaseFalso(), calendarStore: store, nylasApiKey: "k", createNylasEventsClient: () => read, createNylasEventsWriteClient: () => write }, baseParams());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "ocupado");
    assert.equal(write.creados, 0, "nunca crea el evento si está ocupado");
  });

  it("5. horario disponible -> crea el evento", async () => {
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_A);
    const { deps, read, write } = armarDeps({ calendarStore: store });
    const r = await crearCitaNylasGenerico(deps, baseParams());
    assert.equal(r.ok, true);
    if (r.ok) assert.ok(r.citaId);
    assert.equal(read.llamadas, 1, "consultó disponibilidad real antes de crear");
    assert.equal(write.creados, 1);
  });

  it("8. revalidación: SIEMPRE consulta eventos reales inmediatamente antes de crear (nunca confía en una consulta previa)", async () => {
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_A);
    const { deps, read } = armarDeps({ calendarStore: store });
    await crearCitaNylasGenerico(deps, baseParams({ effectId: "otro-effect" }));
    assert.equal(read.llamadas, 1, "el propio flujo de creación siempre revalida, sin excepción");
  });

  it("9. doble intento/replay (mismo executionRowId+effectId) -> NUNCA crea dos eventos", async () => {
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_A);
    const { deps, write } = armarDeps({ calendarStore: store });
    const params = baseParams();
    const r1 = await crearCitaNylasGenerico(deps, params);
    const r2 = await crearCitaNylasGenerico(deps, params); // mismo effectId/executionRowId/huella
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (r1.ok && r2.ok) assert.equal(r1.citaId, r2.citaId, "el replay devuelve el MISMO resultado, nunca uno nuevo");
    assert.equal(write.creados, 1, "un solo evento real creado, sin importar los reintentos");
  });

  it("10. error real de Nylas al consultar disponibilidad -> resultado controlado, nunca lanza", async () => {
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_A);
    const read = fakeReadClient([], { throws: true });
    const write = fakeWriteClient();
    const r = await crearCitaNylasGenerico({ supabase: crearSupabaseFalso(), calendarStore: store, nylasApiKey: "k", createNylasEventsClient: () => read, createNylasEventsWriteClient: () => write }, baseParams());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "error_tecnico");
    assert.equal(write.creados, 0);
  });

  it("11. error real de Nylas al crear el evento -> resultado controlado, nunca lanza", async () => {
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_A);
    const read = fakeReadClient([]);
    const write = fakeWriteClient({ throws: true });
    const r = await crearCitaNylasGenerico({ supabase: crearSupabaseFalso(), calendarStore: store, nylasApiKey: "k", createNylasEventsClient: () => read, createNylasEventsWriteClient: () => write }, baseParams());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "error_tecnico");
  });

  it("grant revocado/desconectado a mitad de camino -> rechazado igual que 'no conectado'", async () => {
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_A, { status: "error", grantId: null });
    const { deps } = armarDeps({ calendarStore: store });
    const r = await crearCitaNylasGenerico(deps, baseParams());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "calendario_no_conectado");
  });

  it("datos incompletos (falta nombreCliente) -> rechazado ANTES de tocar Nylas/store", async () => {
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_A);
    const { deps, read, write } = armarDeps({ calendarStore: store });
    const r = await crearCitaNylasGenerico(deps, baseParams({ nombreCliente: "" }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "datos_incompletos");
    assert.equal(read.llamadas, 0);
    assert.equal(write.creados, 0);
  });

  it("fecha/hora inválida -> rechazada", async () => {
    const { deps } = armarDeps();
    const r = await crearCitaNylasGenerico(deps, baseParams({ fecha: "no-es-una-fecha", hora: "25:99" }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "fecha_invalida");
  });

  it("13/grant nunca expuesto: el resultado nunca contiene grantId/apiKey en ninguna forma", async () => {
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_A, { grantId: "grant-secreto-xyz" });
    const { deps } = armarDeps({ calendarStore: store, nylasApiKey: "api-key-super-secreta" });
    const r = await crearCitaNylasGenerico(deps, baseParams());
    const serializado = JSON.stringify(r);
    assert.equal(serializado.includes("grant-secreto-xyz"), false);
    assert.equal(serializado.includes("api-key-super-secreta"), false);
  });

  it("conflicto de idempotencia real (misma clave, huella distinta) -> conflicto_reintento", async () => {
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_A);
    const supabase = crearSupabaseFalso();
    const read = fakeReadClient([]);
    const write = fakeWriteClient();
    const d: CrearCitaNylasGenericoDeps = { supabase, calendarStore: store, nylasApiKey: "k", createNylasEventsClient: () => read, createNylasEventsWriteClient: () => write };
    await crearCitaNylasGenerico(d, baseParams({ nombreCliente: "Ana Pérez" }));
    // MISMA executionRowId/effectId (misma idempotencyKey) pero datos de
    // negocio DISTINTOS (huella distinta) -- nunca reutiliza el resultado ajeno.
    const r2 = await crearCitaNylasGenerico(d, baseParams({ nombreCliente: "Otro Cliente Distinto" }));
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.motivo, "conflicto_reintento");
  });
});
