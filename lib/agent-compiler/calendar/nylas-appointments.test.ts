/**
 * R7 — cancelar / reprogramar citas del cliente (backend). Store en memoria + Nylas fake + fake de la tabla de
 * idempotencia: sin red ni Supabase. Foco: IDENTIDAD por canal, aislamiento por tenant, política del negocio,
 * idempotencia, y que un id/teléfono ajeno NUNCA toque el calendario.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInMemoryAppointmentStore } from "@/lib/agent-compiler/calendar/appointment-store";
import { createInMemoryCalendarStore } from "@/lib/agent-compiler/calendar/testing/in-memory-calendar-store";
import {
  cancelarCitaCliente,
  evaluarPoliticaCita,
  formatearCitasTexto,
  listarCitasCliente,
  reprogramarCitaCliente,
  resolverSeleccionCita,
  type AppointmentsDeps,
} from "@/lib/agent-compiler/calendar/nylas-appointments";
import type { NylasEvent, NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const TEL = "573001112233";
const OTRO_TEL = "573009998877";
// Jueves 2030-03-14 10:00 (Colombia).
const AHORA = new Date("2030-03-14T15:00:00Z").getTime();
const POLITICA = { allowed: true, minNoticeHours: 24 };
const HORARIO = { week: Array.from({ length: 7 }, () => ({ closed: false, intervals: [{ open: "08:00", close: "20:00" }] })), exceptions: [] };

type Fila = Record<string, unknown>;
/** Fake mínimo de Supabase: solo dulabs_idempotencia_reservas (lo que usa ejecutarConIdempotencia). */
function supabaseIdempotencia(): SupabaseClient {
  const filas: Fila[] = [];
  const from = (tabla: string) => {
    if (tabla !== "dulabs_idempotencia_reservas") throw new Error(`tabla inesperada: ${tabla}`);
    const filtros: Array<(f: Fila) => boolean> = [];
    let insert: Fila | undefined;
    let update: Fila | undefined;
    let borrar = false;
    const ejecutar = (): { data: Fila[]; error: { code: string; message: string } | null } => {
      if (borrar) {
        for (const f of filas.filter((x) => filtros.every((fn) => fn(x)))) filas.splice(filas.indexOf(f), 1);
        return { data: [], error: null };
      }
      if (insert) {
        const n = insert;
        if (filas.some((f) => f.id_tenant === n.id_tenant && f.idempotency_key === n.idempotency_key)) return { data: [], error: { code: "23505", message: "dup" } };
        const fila = { resultado_json: null, ...n };
        filas.push(fila);
        return { data: [fila], error: null };
      }
      if (update) {
        for (const f of filas) if (filtros.every((fn) => fn(f))) Object.assign(f, update);
        return { data: [], error: null };
      }
      return { data: filas.filter((f) => filtros.every((fn) => fn(f))), error: null };
    };
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), b),
      insert: (f: Fila) => ((insert = f), b),
      update: (c: Fila) => ((update = c), b),
      delete: () => ((borrar = true), b),
      async maybeSingle() {
        const r = ejecutar();
        return { data: r.data[0] ?? null, error: r.error };
      },
      then: (resolve: (r: { data: Fila[]; error: unknown }) => unknown) => resolve(ejecutar()),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

async function mundo(opts: { calendarId?: string; conectado?: boolean; nowMs?: number; sinUpdate?: boolean; deleteError?: { status?: number }; updateFalla?: number } = {}) {
  let fallosPendientes = opts.updateFalla ?? 0;
  const calendarStore = createInMemoryCalendarStore();
  if (opts.conectado !== false) {
    await calendarStore.saveConnection({
      tenantId: A, provider: "nylas", grantId: "grant-A", accountEmail: "a@x.com", status: "connected",
      selectedCalendarId: opts.calendarId ?? "cal-A", selectedCalendarName: "P", connectedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }
  const appointmentStore = createInMemoryAppointmentStore();
  const eventos: NylasEvent[] = [];
  const borrados: string[] = [];
  const movidos: Array<{ eventId: string; startUnix: number; endUnix: number }> = [];
  const lector: NylasEventsClient = { async listEvents() { return eventos; } };
  const escritor: NylasEventsWriteClient = {
    async createEvent() { return { id: "evt-new" }; },
    async deleteEvent(p) {
      if (opts.deleteError) throw Object.assign(new Error("nylas"), { status: opts.deleteError.status });
      borrados.push(p.eventId);
    },
    ...(opts.sinUpdate ? {} : { async updateEventTime(p: { eventId: string; startUnix: number; endUnix: number }) { if (fallosPendientes-- > 0) throw new Error("nylas 500"); movidos.push({ eventId: p.eventId, startUnix: p.startUnix, endUnix: p.endUnix }); } }),
  };
  const deps: AppointmentsDeps = {
    supabase: supabaseIdempotencia(),
    calendarStore,
    appointmentStore,
    nylasApiKey: "api-key-fake",
    createNylasEventsClient: () => lector,
    createNylasEventsWriteClient: () => escritor,
    nowMs: opts.nowMs ?? AHORA,
  };
  // Cita de TEL en A: sábado 2030-03-16 10:00–10:45 (Colombia).
  await appointmentStore.record({ tenantId: A, telefonoCliente: TEL, calendarId: opts.calendarId ?? "cal-A", eventId: "evt-1", servicio: "Corte", nombreCliente: "Ana", inicioIso: "2030-03-16T15:00:00.000Z", finIso: "2030-03-16T15:45:00.000Z" });
  eventos.push({ id: "evt-1", when: { object: "timespan", start_time: Date.parse("2030-03-16T15:00:00Z") / 1000, end_time: Date.parse("2030-03-16T15:45:00Z") / 1000 } });
  return { deps, appointmentStore, eventos, borrados, movidos, calendarStore };
}

async function citasMostradas(deps: AppointmentsDeps, telefono = TEL, tenantId = A) {
  const r = await listarCitasCliente(deps, { tenantId, telefono, ...POLITICA });
  return r.ok ? r.citas : [];
}

describe("política y selección (puras)", () => {
  it("1. política: no permitido / muy cerca / ok", () => {
    assert.deepEqual(evaluarPoliticaCita({ allowed: false, minNoticeHours: 0 }, "2030-03-16T15:00:00Z", AHORA), { ok: false, motivo: "no_permitido" });
    assert.deepEqual(evaluarPoliticaCita(POLITICA, "2030-03-15T12:00:00Z", AHORA), { ok: false, motivo: "muy_cerca" });
    assert.deepEqual(evaluarPoliticaCita(POLITICA, "2030-03-16T15:00:00Z", AHORA), { ok: true });
  });

  it("2. selección: número, ordinal, única cita; una NEGACIÓN nunca selecciona; fuera de rango se rechaza", () => {
    const dos = [{ id: "a" }, { id: "b" }];
    assert.equal(resolverSeleccionCita(dos, "2").ok && (resolverSeleccionCita(dos, "2") as { cita: { id: string } }).cita.id, "b");
    assert.equal((resolverSeleccionCita(dos, "la primera") as { cita: { id: string } }).cita.id, "a");
    assert.equal((resolverSeleccionCita(dos, "quiero la segunda") as { cita: { id: string } }).cita.id, "b");
    assert.deepEqual(resolverSeleccionCita(dos, "3"), { ok: false, motivo: "seleccion_invalida" });
    assert.deepEqual(resolverSeleccionCita(dos, "la que sea"), { ok: false, motivo: "seleccion_invalida" });
    assert.deepEqual(resolverSeleccionCita(dos, "no, ninguna"), { ok: false, motivo: "seleccion_invalida" });
    assert.deepEqual(resolverSeleccionCita([{ id: "solo" }], "no"), { ok: false, motivo: "seleccion_invalida" });
    assert.equal((resolverSeleccionCita([{ id: "solo" }], "sí esa") as { cita: { id: string } }).cita.id, "solo");
    assert.deepEqual(resolverSeleccionCita([], "1"), { ok: false, motivo: "sin_citas" });
  });
});

describe("listar — SOLO las citas de esta persona en este negocio", () => {
  it("3. lista la cita propia con texto determinista; otro teléfono u otro tenant NO la ven", async () => {
    const { deps } = await mundo();
    const r = await listarCitasCliente(deps, { tenantId: A, telefono: TEL, ...POLITICA });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.citas.length, 1);
      assert.equal(r.citas[0]!.duracionMin, 45);
      assert.match(r.texto, /Corte — .*sábado.*16 de marzo/i);
      assert.equal(r.citas[0]!.modificable, true);
    }
    assert.deepEqual(await listarCitasCliente(deps, { tenantId: A, telefono: OTRO_TEL, ...POLITICA }), { ok: false, motivo: "sin_citas" });
    assert.deepEqual(await listarCitasCliente(deps, { tenantId: B, telefono: TEL, ...POLITICA }), { ok: false, motivo: "sin_citas" });
  });

  it("4. una cita YA pasada o CANCELADA no se lista", async () => {
    const { deps, appointmentStore } = await mundo({ nowMs: Date.parse("2030-03-17T00:00:00Z") });
    assert.equal((await listarCitasCliente(deps, { tenantId: A, telefono: TEL, ...POLITICA })).ok, false, "pasada");
    const m2 = await mundo();
    const id = (await citasMostradas(m2.deps))[0]!.id;
    await m2.appointmentStore.markCancelled(A, TEL, id, "2030-03-14T15:00:00Z");
    assert.equal((await listarCitasCliente(m2.deps, { tenantId: A, telefono: TEL, ...POLITICA })).ok, false, "cancelada");
    void appointmentStore;
  });

  it("5. la política se refleja en el listado: una cita a menos de N horas se marca no modificable", async () => {
    const { deps } = await mundo({ nowMs: Date.parse("2030-03-16T02:00:00Z") }); // 13 h antes
    const r = await listarCitasCliente(deps, { tenantId: A, telefono: TEL, ...POLITICA });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.citas[0]!.modificable, false);
      assert.match(formatearCitasTexto(r.citas, 24), /quedan menos de 24 h/);
    }
  });
});

describe("cancelar", () => {
  it("6. cancela en el calendario REAL, marca la cita cancelada y es IDEMPOTENTE", async () => {
    const { deps, borrados, appointmentStore } = await mundo();
    const mostradas = await citasMostradas(deps);
    const r = await cancelarCitaCliente(deps, { tenantId: A, telefono: TEL, citasMostradas: mostradas, seleccion: "1", ...POLITICA });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(borrados, ["evt-1"]);
    assert.equal(appointmentStore.all()[0]!.estado, "cancelada");
    // Repetir (replay / doble toque): no rompe y no borra dos veces "de más".
    const otra = await cancelarCitaCliente(deps, { tenantId: A, telefono: TEL, citasMostradas: mostradas, seleccion: "1", ...POLITICA });
    assert.equal(otra.ok, false, "ya no está vigente: la re-verificación la descarta (nunca opera sobre una cita ya cancelada)");
    assert.deepEqual(borrados, ["evt-1"], "no hubo un segundo borrado");
  });

  it("7. SEGURIDAD: el id de la cita de OTRA persona (payload forjado) NUNCA llega al calendario", async () => {
    const { deps, borrados, appointmentStore } = await mundo();
    const idAjena = (await citasMostradas(deps))[0]!.id;
    // El atacante es OTRO teléfono del mismo negocio, con la lista/id de la cita ajena en el payload.
    const r = await cancelarCitaCliente(deps, { tenantId: A, telefono: OTRO_TEL, citasMostradas: [{ id: idAjena }], seleccion: "1", ...POLITICA });
    assert.deepEqual(r.ok === false && r.motivo, "cita_no_encontrada");
    assert.deepEqual(borrados, [], "el calendario NO se tocó");
    assert.equal(appointmentStore.all()[0]!.estado, "confirmada");
  });

  it("8. SEGURIDAD: otro TENANT tampoco puede cancelar la cita (aislamiento)", async () => {
    const { deps, borrados } = await mundo();
    const idAjena = (await citasMostradas(deps))[0]!.id;
    const r = await cancelarCitaCliente(deps, { tenantId: B, telefono: TEL, citasMostradas: [{ id: idAjena }], seleccion: "1", ...POLITICA });
    assert.equal(r.ok, false);
    assert.deepEqual(borrados, []);
  });

  it("9. POLÍTICA: no permitido y 'muy cerca' se rechazan ANTES de tocar el calendario", async () => {
    const m1 = await mundo();
    const r1 = await cancelarCitaCliente(m1.deps, { tenantId: A, telefono: TEL, citasMostradas: await citasMostradas(m1.deps), seleccion: "1", allowed: false, minNoticeHours: 0 });
    assert.equal(r1.ok === false && r1.motivo, "no_permitido");
    const m2 = await mundo({ nowMs: Date.parse("2030-03-16T02:00:00Z") });
    const r2 = await cancelarCitaCliente(m2.deps, { tenantId: A, telefono: TEL, citasMostradas: await citasMostradas(m2.deps), seleccion: "1", ...POLITICA });
    assert.equal(r2.ok === false && r2.motivo, "muy_cerca");
    assert.deepEqual([...m1.borrados, ...m2.borrados], []);
  });

  it("10. selección inválida no cancela nada; calendario sin conectar / reconectado a OTRO calendario => derivar", async () => {
    const m = await mundo();
    const mostradas = await citasMostradas(m.deps);
    assert.equal((await cancelarCitaCliente(m.deps, { tenantId: A, telefono: TEL, citasMostradas: [...mostradas, ...mostradas], seleccion: "hola", ...POLITICA })).ok, false);
    assert.deepEqual(m.borrados, []);
    const distinto = await mundo({ calendarId: "cal-A" });
    await distinto.calendarStore.saveConnection({ tenantId: A, provider: "nylas", grantId: "grant-A", accountEmail: "a@x.com", status: "connected", selectedCalendarId: "OTRO-CAL", selectedCalendarName: "X", connectedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    const r = await cancelarCitaCliente(distinto.deps, { tenantId: A, telefono: TEL, citasMostradas: await citasMostradas(distinto.deps), seleccion: "1", ...POLITICA });
    assert.equal(r.ok === false && r.motivo, "calendario_distinto");
    assert.deepEqual(distinto.borrados, []);
    const sinCal = await mundo({ conectado: false });
    const r3 = await cancelarCitaCliente(sinCal.deps, { tenantId: A, telefono: TEL, citasMostradas: await citasMostradas(sinCal.deps), seleccion: "1", ...POLITICA });
    assert.equal(r3.ok === false && r3.motivo, "calendario_no_conectado");
  });

  it("11. si el evento YA no existe en el calendario (404) la cita queda cancelada igual; otro error => fallo técnico y NO se marca", async () => {
    const m404 = await mundo({ deleteError: { status: 404 } });
    const r = await cancelarCitaCliente(m404.deps, { tenantId: A, telefono: TEL, citasMostradas: await citasMostradas(m404.deps), seleccion: "1", ...POLITICA });
    assert.equal(r.ok, true);
    assert.equal(m404.appointmentStore.all()[0]!.estado, "cancelada");
    const m500 = await mundo({ deleteError: { status: 500 } });
    const r2 = await cancelarCitaCliente(m500.deps, { tenantId: A, telefono: TEL, citasMostradas: await citasMostradas(m500.deps), seleccion: "1", ...POLITICA });
    assert.equal(r2.ok === false && r2.motivo, "error_tecnico");
    assert.equal(m500.appointmentStore.all()[0]!.estado, "confirmada", "no se marca cancelada si el calendario falló");
  });
});

describe("reprogramar", () => {
  const params = (deps: AppointmentsDeps, mostradas: Array<{ id: string }>, over: Partial<Parameters<typeof reprogramarCitaCliente>[1]> = {}) => ({
    tenantId: A, telefono: TEL, executionRowId: "exec-1", effectId: "eff-1", citasMostradas: mostradas, seleccion: "1",
    fecha: "2030-03-18", hora: "15:00", businessHours: HORARIO, minNoticeMinutes: 60, ...POLITICA, ...over,
  });

  it("12. mueve el MISMO evento (conserva id), con la DURACIÓN de la cita registrada, y actualiza el registro", async () => {
    const { deps, movidos, appointmentStore } = await mundo();
    const r = await reprogramarCitaCliente(deps, params(deps, await citasMostradas(deps)));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(movidos.length, 1);
    assert.equal(movidos[0]!.eventId, "evt-1");
    assert.equal(movidos[0]!.endUnix - movidos[0]!.startUnix, 45 * 60, "duración = la de la cita (45), no la que diga la IA");
    assert.equal(new Date(movidos[0]!.startUnix * 1000).toISOString(), "2030-03-18T20:00:00.000Z", "15:00 Colombia");
    const fila = appointmentStore.all()[0]!;
    assert.equal(fila.inicioIso, "2030-03-18T20:00:00.000Z");
    assert.equal(fila.reprogramaciones, 1);
    assert.equal(fila.eventId, "evt-1");
  });

  it("13. rechaza: fuera de horario, día cerrado, ocupado (evento de OTRO), pasado/anticipación y mismo horario — sin tocar el calendario", async () => {
    const m = await mundo();
    const mostradas = await citasMostradas(m.deps);
    const casos: Array<[Partial<Parameters<typeof reprogramarCitaCliente>[1]>, string]> = [
      [{ hora: "22:00" }, "fuera_de_horario"],
      [{ fecha: "2030-03-17", businessHours: { week: HORARIO.week.map((d, i) => (i === 0 ? { closed: true, intervals: [] } : d)), exceptions: [] } }, "fuera_de_horario"],
      [{ fecha: "2030-03-14", hora: "10:30" }, "muy_pronto"],
      [{ fecha: "2030-03-16", hora: "10:00" }, "mismo_horario"],
    ];
    for (const [over, motivo] of casos) {
      const r = await reprogramarCitaCliente(m.deps, params(m.deps, mostradas, { ...over, effectId: `e-${motivo}-${JSON.stringify(over).length}` }));
      assert.equal(r.ok === false && r.motivo, motivo, JSON.stringify(over));
    }
    // Conflicto con un evento de OTRA persona el lunes 15:00.
    m.eventos.push({ id: "evt-otro", when: { object: "timespan", start_time: Date.parse("2030-03-18T20:00:00Z") / 1000, end_time: Date.parse("2030-03-18T21:00:00Z") / 1000 } });
    const ocupado = await reprogramarCitaCliente(m.deps, params(m.deps, mostradas, { effectId: "e-ocupado" }));
    assert.equal(ocupado.ok === false && ocupado.motivo, "ocupado");
    assert.deepEqual(m.movidos, [], "ningún rechazo llegó a mover el evento");
  });

  it("14. el propio evento NO cuenta como conflicto: se puede mover a un horario que solapa con su hueco actual", async () => {
    const m = await mundo();
    const r = await reprogramarCitaCliente(m.deps, params(m.deps, await citasMostradas(m.deps), { fecha: "2030-03-16", hora: "10:30" }));
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("15. IDEMPOTENCIA: el mismo effectId no mueve dos veces; con datos distintos es un conflicto", async () => {
    const m = await mundo();
    const mostradas = await citasMostradas(m.deps);
    const a = await reprogramarCitaCliente(m.deps, params(m.deps, mostradas));
    const b = await reprogramarCitaCliente(m.deps, params(m.deps, mostradas));
    assert.equal(a.ok && b.ok, true);
    assert.equal(m.movidos.length, 1, "un replay NO vuelve a mover el evento");
    const c = await reprogramarCitaCliente(m.deps, params(m.deps, mostradas, { hora: "16:00" }));
    assert.equal(c.ok === false && c.motivo, "conflicto_reintento");
  });

  it("15b. un fallo TÉCNICO del calendario no se cachea: el reintento del MISMO efecto puede recuperarse (y luego es idempotente)", async () => {
    const m = await mundo({ updateFalla: 1 });
    const mostradas = await citasMostradas(m.deps);
    const primero = await reprogramarCitaCliente(m.deps, params(m.deps, mostradas));
    assert.equal(primero.ok === false && primero.motivo, "error_tecnico");
    assert.equal(m.appointmentStore.all()[0]!.inicioIso, "2030-03-16T15:00:00.000Z", "no se movió nada en el registro");
    const reintento = await reprogramarCitaCliente(m.deps, params(m.deps, mostradas));
    assert.equal(reintento.ok, true, JSON.stringify(reintento));
    assert.equal(m.movidos.length, 1);
  });

  it("16. SEGURIDAD: teléfono/tenant ajeno y política no permitida => no se mueve nada; proveedor sin soporte => se deriva", async () => {
    const m = await mundo();
    const id = (await citasMostradas(m.deps))[0]!.id;
    assert.equal((await reprogramarCitaCliente(m.deps, params(m.deps, [{ id }], { telefono: OTRO_TEL }))).ok, false);
    assert.equal((await reprogramarCitaCliente(m.deps, params(m.deps, [{ id }], { tenantId: B }))).ok, false);
    assert.equal((await reprogramarCitaCliente(m.deps, params(m.deps, [{ id }], { allowed: false }))).ok, false);
    assert.deepEqual(m.movidos, []);
    const s = await mundo({ sinUpdate: true });
    const r = await reprogramarCitaCliente(s.deps, params(s.deps, await citasMostradas(s.deps)));
    assert.equal(r.ok === false && r.motivo, "sin_soporte");
  });
});
