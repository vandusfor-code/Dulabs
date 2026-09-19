/**
 * R7 — consulta de disponibilidad genérica Nylas (lib/agent-compiler/calendar/
 * nylas-availability.ts). 100% offline: store de calendario en memoria y cliente
 * Nylas fake -- nunca red real, nunca Supabase real. Verifica que el BACKEND es
 * la única autoridad: solo ofrece horarios que caben en el horario de atención,
 * con la duración real, sin solaparse con eventos reales, y nunca en el pasado.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buscarDisponibilidadNylasGenerico,
  calcularSlotsDisponibles,
  type BuscarDisponibilidadNylasGenericoDeps,
} from "@/lib/agent-compiler/calendar/nylas-availability";
import { createInMemoryCalendarStore } from "@/lib/agent-compiler/calendar/testing/in-memory-calendar-store";
import type { CalendarConnectionStore } from "@/lib/agent-compiler/calendar/types";
import type { NylasEvent, NylasEventsClient } from "@/lib/nylas/nylas-types";
import type { BusinessDaySchedule, BusinessHours } from "@/lib/agent-compiler/spec/types";
import { weekdayDeFecha } from "@/lib/business-hours";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const FECHA = "2026-03-10"; // día de referencia
const ANTES = Math.floor(new Date("2026-03-01T00:00:00-05:00").getTime() / 1000); // "ahora" muy anterior al día

function unix(fecha: string, hora: string): number {
  return Math.floor(new Date(`${fecha}T${hora}:00-05:00`).getTime() / 1000);
}

const diaAbierto = (open: string, close: string): BusinessDaySchedule => ({ closed: false, intervals: [{ open, close }] });
const diaCerrado = (): BusinessDaySchedule => ({ closed: true, intervals: [] });

/** Semana con TODOS los días abiertos en [open, close). */
function semanaAbierta(open: string, close: string): BusinessHours {
  return { week: Array.from({ length: 7 }, () => diaAbierto(open, close)), exceptions: [] };
}

/** Semana abierta salvo el weekday de `fecha`, que queda cerrado. */
function semanaConDiaCerrado(fecha: string, open = "09:00", close = "18:00"): BusinessHours {
  const week = Array.from({ length: 7 }, () => diaAbierto(open, close));
  const wd = weekdayDeFecha(fecha);
  if (wd !== null) week[wd] = diaCerrado();
  return { week, exceptions: [] };
}

const evtTimespan = (fecha: string, desde: string, hasta: string): NylasEvent => ({
  id: `e-${desde}`,
  when: { object: "timespan", start_time: unix(fecha, desde), end_time: unix(fecha, hasta) },
  status: "confirmed",
});

// ---------------------------------------------------------------------------
// calcularSlotsDisponibles (PURA)
// ---------------------------------------------------------------------------
describe("calcularSlotsDisponibles — autoridad determinista del backend", () => {
  it("sin horario de atención -> sin_horario (fail-closed, no inventa)", () => {
    const r = calcularSlotsDisponibles({ businessHours: null, fecha: FECHA, durationMin: 60, eventos: [], nowUnix: ANTES });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "sin_horario");
  });

  it("día cerrado -> cerrado (nunca ofrece un día que el negocio no atiende)", () => {
    const r = calcularSlotsDisponibles({ businessHours: semanaConDiaCerrado(FECHA), fecha: FECHA, durationMin: 60, eventos: [], nowUnix: ANTES });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "cerrado");
  });

  it("excepción por fecha (festivo) cerrada -> cerrado", () => {
    const bh: BusinessHours = { week: Array.from({ length: 7 }, () => diaAbierto("09:00", "18:00")), exceptions: [{ date: FECHA, closed: true, intervals: [] }] };
    const r = calcularSlotsDisponibles({ businessHours: bh, fecha: FECHA, durationMin: 60, eventos: [], nowUnix: ANTES });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "cerrado");
  });

  it("día abierto 09-12, dur 60, sin eventos -> solo turnos que CABEN completos", () => {
    const r = calcularSlotsDisponibles({ businessHours: semanaAbierta("09:00", "12:00"), fecha: FECHA, durationMin: 60, eventos: [], nowUnix: ANTES });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.slots, ["09:00", "09:30", "10:00", "10:30", "11:00"]);
      assert.ok(!r.slots.includes("11:30"), "11:30+60=12:30 se sale del cierre 12:00");
      assert.ok(!r.slots.includes("12:00"), "12:00+60 se sale del cierre");
    }
  });

  it("descarta horarios que se solapan con un evento REAL del calendario", () => {
    const r = calcularSlotsDisponibles({
      businessHours: semanaAbierta("09:00", "12:00"),
      fecha: FECHA,
      durationMin: 60,
      eventos: [evtTimespan(FECHA, "10:00", "11:00")],
      nowUnix: ANTES,
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.slots, ["09:00", "11:00"]);
  });

  it("un evento cancelado NO ocupa horario", () => {
    const cancelado: NylasEvent = { id: "x", when: { object: "timespan", start_time: unix(FECHA, "10:00"), end_time: unix(FECHA, "11:00") }, status: "cancelled" };
    const r = calcularSlotsDisponibles({ businessHours: semanaAbierta("09:00", "12:00"), fecha: FECHA, durationMin: 60, eventos: [cancelado], nowUnix: ANTES });
    assert.equal(r.ok, true);
    if (r.ok) assert.ok(r.slots.includes("10:00"), "el horario del evento cancelado vuelve a estar libre");
  });

  it("nunca ofrece horarios en el pasado (guarda por nowUnix)", () => {
    const r = calcularSlotsDisponibles({
      businessHours: semanaAbierta("09:00", "12:00"),
      fecha: FECHA,
      durationMin: 60,
      eventos: [],
      nowUnix: unix(FECHA, "10:15"),
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.ok(!r.slots.includes("09:00") && !r.slots.includes("10:00"), "10:00 < 10:15 (pasado)");
      assert.deepEqual(r.slots, ["10:30", "11:00"]);
    }
  });

  it("respeta la duración real: dur 120 en 09-12 solo cabe hasta 10:00", () => {
    const r = calcularSlotsDisponibles({ businessHours: semanaAbierta("09:00", "12:00"), fecha: FECHA, durationMin: 120, eventos: [], nowUnix: ANTES });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.slots, ["09:00", "09:30", "10:00"]);
  });

  it("aplica el tope maxSlots", () => {
    const r = calcularSlotsDisponibles({ businessHours: semanaAbierta("09:00", "18:00"), fecha: FECHA, durationMin: 60, eventos: [], nowUnix: ANTES, granularityMin: 60, maxSlots: 3 });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.slots, ["09:00", "10:00", "11:00"]);
  });
});

// ---------------------------------------------------------------------------
// buscarDisponibilidadNylasGenerico (orquestación, offline)
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

function conectarCalendario(store: CalendarConnectionStore, tenantId: string, over: { grantId?: string; calendarId?: string; status?: "connected" | "pending" } = {}) {
  return store.saveConnection({
    tenantId,
    provider: "nylas",
    grantId: over.grantId ?? `grant-${tenantId}`,
    accountEmail: "negocio@example.com",
    status: over.status ?? "connected",
    selectedCalendarId: over.calendarId ?? `cal-${tenantId}`,
    selectedCalendarName: "Principal",
    connectedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

function armarDeps(read: ReturnType<typeof fakeReadClient>, over: Partial<BuscarDisponibilidadNylasGenericoDeps> = {}): { deps: BuscarDisponibilidadNylasGenericoDeps; store: CalendarConnectionStore } {
  const store = over.calendarStore ?? createInMemoryCalendarStore();
  return {
    store,
    deps: { calendarStore: store, nylasApiKey: "api-key-fake", createNylasEventsClient: () => read, ...over },
  };
}

describe("buscarDisponibilidadNylasGenerico — orquestación (offline)", () => {
  it("calendario no conectado -> rechazado, nunca llama a Nylas", async () => {
    const read = fakeReadClient();
    const { deps } = armarDeps(read);
    const r = await buscarDisponibilidadNylasGenerico(deps, { tenantId: TENANT_A, fecha: FECHA, durationMin: 60, businessHours: semanaAbierta("09:00", "12:00"), nowUnix: ANTES });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "calendario_no_conectado");
    assert.equal(read.llamadas, 0);
  });

  it("proveedor sin API key -> proveedor_no_disponible (nunca simula)", async () => {
    const read = fakeReadClient();
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_A);
    const { deps } = armarDeps(read, { calendarStore: store, nylasApiKey: null });
    const r = await buscarDisponibilidadNylasGenerico(deps, { tenantId: TENANT_A, fecha: FECHA, durationMin: 60, businessHours: semanaAbierta("09:00", "12:00"), nowUnix: ANTES });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "proveedor_no_disponible");
    assert.equal(read.llamadas, 0);
  });

  it("tenant isolation: el calendario de B nunca se usa para una consulta de A", async () => {
    const read = fakeReadClient();
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_B, { grantId: "grant-de-B", calendarId: "cal-de-B" });
    const { deps } = armarDeps(read, { calendarStore: store });
    const r = await buscarDisponibilidadNylasGenerico(deps, { tenantId: TENANT_A, fecha: FECHA, durationMin: 60, businessHours: semanaAbierta("09:00", "12:00"), nowUnix: ANTES });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "calendario_no_conectado");
    assert.equal(read.llamadas, 0);
  });

  it("happy path: consulta el calendario real UNA vez y devuelve los horarios libres", async () => {
    const read = fakeReadClient([evtTimespan(FECHA, "10:00", "11:00")]);
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_A);
    const { deps } = armarDeps(read, { calendarStore: store });
    const r = await buscarDisponibilidadNylasGenerico(deps, { tenantId: TENANT_A, fecha: FECHA, durationMin: 60, businessHours: semanaAbierta("09:00", "12:00"), nowUnix: ANTES });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.fecha, FECHA);
      assert.equal(r.durationMin, 60);
      assert.deepEqual(r.slots, ["09:00", "11:00"]);
    }
    assert.equal(read.llamadas, 1);
  });

  it("error real de Nylas -> error_tecnico (nunca inventa disponibilidad)", async () => {
    const read = fakeReadClient([], { throws: true });
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_A);
    const { deps } = armarDeps(read, { calendarStore: store });
    const r = await buscarDisponibilidadNylasGenerico(deps, { tenantId: TENANT_A, fecha: FECHA, durationMin: 60, businessHours: semanaAbierta("09:00", "12:00"), nowUnix: ANTES });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "error_tecnico");
  });

  it("día cerrado -> cerrado aunque el calendario esté vacío", async () => {
    const read = fakeReadClient([]);
    const store = createInMemoryCalendarStore();
    await conectarCalendario(store, TENANT_A);
    const { deps } = armarDeps(read, { calendarStore: store });
    const r = await buscarDisponibilidadNylasGenerico(deps, { tenantId: TENANT_A, fecha: FECHA, durationMin: 60, businessHours: semanaConDiaCerrado(FECHA), nowUnix: ANTES });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "cerrado");
  });
});
