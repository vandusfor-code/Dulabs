/**
 * PILOTO AMORE + Nylas (autorizado, FASE B4) -- eventosNylasComoVentanas /
 * consultarEventosOcupadosNylas. NUNCA red real: siempre un NylasEventsClient
 * mockeado.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { consultarEventosOcupadosNylas, eventosNylasComoVentanas } from "@/lib/nylas/nylas-eventos-ocupados";
import type { NylasEvent, NylasEventsClient } from "@/lib/nylas/nylas-types";

describe("eventosNylasComoVentanas -- conversión pura, nunca inventa ocupación", () => {
  it("timespan (evento normal con hora) se convierte tal cual", () => {
    const eventos: NylasEvent[] = [{ id: "1", when: { object: "timespan", start_time: 1_700_000_000, end_time: 1_700_003_600 } }];
    const ventanas = eventosNylasComoVentanas(eventos, "2026-09-14");
    assert.equal(ventanas.length, 1);
    assert.equal(ventanas[0]!.apertura.getTime(), 1_700_000_000 * 1000);
    assert.equal(ventanas[0]!.cierre.getTime(), 1_700_003_600 * 1000);
  });

  it("evento cancelado NUNCA ocupa, aunque tenga when.timespan real", () => {
    const eventos: NylasEvent[] = [{ id: "1", when: { object: "timespan", start_time: 1_700_000_000, end_time: 1_700_003_600 }, status: "cancelled" }];
    assert.deepEqual(eventosNylasComoVentanas(eventos, "2026-09-14"), []);
  });

  it("date (día completo, un solo día) bloquea TODO el día local si coincide con la fecha consultada", () => {
    const eventos: NylasEvent[] = [{ id: "1", when: { object: "date", date: "2026-09-14" } }];
    const ventanas = eventosNylasComoVentanas(eventos, "2026-09-14");
    assert.equal(ventanas.length, 1);
    assert.equal(ventanas[0]!.apertura.toISOString(), new Date("2026-09-14T00:00:00-05:00").toISOString());
  });

  it("date de OTRO día no afecta la fecha consultada", () => {
    const eventos: NylasEvent[] = [{ id: "1", when: { object: "date", date: "2026-09-15" } }];
    assert.deepEqual(eventosNylasComoVentanas(eventos, "2026-09-14"), []);
  });

  it("datespan (varios días) bloquea si la fecha consultada cae DENTRO del rango -- end_date es EXCLUSIVO", () => {
    const eventos: NylasEvent[] = [{ id: "1", when: { object: "datespan", start_date: "2026-09-13", end_date: "2026-09-16" } }];
    assert.equal(eventosNylasComoVentanas(eventos, "2026-09-13").length, 1, "primer día del rango sí bloquea");
    assert.equal(eventosNylasComoVentanas(eventos, "2026-09-15").length, 1, "último día incluido (end_date exclusivo) sí bloquea");
    assert.equal(eventosNylasComoVentanas(eventos, "2026-09-16").length, 0, "end_date es EXCLUSIVO -- ese día ya NO está cubierto");
  });

  it("múltiples eventos reales se combinan todos, ninguno se pierde", () => {
    const eventos: NylasEvent[] = [
      { id: "1", when: { object: "timespan", start_time: 1_700_000_000, end_time: 1_700_003_600 } },
      { id: "2", when: { object: "timespan", start_time: 1_700_010_000, end_time: 1_700_013_600 } },
    ];
    assert.equal(eventosNylasComoVentanas(eventos, "2026-09-14").length, 2);
  });

  it("calendario sin eventos -> array vacío, nunca un error", () => {
    assert.deepEqual(eventosNylasComoVentanas([], "2026-09-14"), []);
  });
});

describe("consultarEventosOcupadosNylas -- nunca inventa disponibilidad si Nylas falla", () => {
  const PARAMS = { grantId: "grant-1", calendarId: "cal-mary", fechaISO: "2026-09-14", desde: new Date("2026-09-14T09:00:00-05:00"), hasta: new Date("2026-09-14T19:00:00-05:00") };

  it("Nylas responde bien con eventos reales -> ok:true con las ventanas convertidas", async () => {
    const client: NylasEventsClient = { async listEvents() { return [{ id: "1", when: { object: "timespan", start_time: 1_700_000_000, end_time: 1_700_003_600 } }]; } };
    const r = await consultarEventosOcupadosNylas(client, PARAMS);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.ocupadas.length, 1);
  });

  it("Nylas responde bien con CERO eventos -> ok:true, ocupadas vacío (nunca se confunde con un error)", async () => {
    const client: NylasEventsClient = { async listEvents() { return []; } };
    const r = await consultarEventosOcupadosNylas(client, PARAMS);
    assert.deepEqual(r, { ok: true, ocupadas: [] });
  });

  it("Nylas devuelve error (HTTP 500/calendario inexistente) -> ok:false, motivo:'error' -- NUNCA ok:true", async () => {
    const client: NylasEventsClient = {
      async listEvents() {
        throw Object.assign(new Error("nylas_http_500: server error"), { status: 500 });
      },
    };
    const r = await consultarEventosOcupadosNylas(client, PARAMS);
    assert.deepEqual(r, { ok: false, motivo: "error" });
  });

  it("Nylas hace timeout (AbortError) -> ok:false, motivo:'timeout'", async () => {
    const client: NylasEventsClient = {
      async listEvents() {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
    };
    const r = await consultarEventosOcupadosNylas(client, PARAMS);
    assert.deepEqual(r, { ok: false, motivo: "timeout" });
  });
});
