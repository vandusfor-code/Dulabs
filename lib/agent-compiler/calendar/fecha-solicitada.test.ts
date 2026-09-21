/**
 * R7 — fecha solicitada: el BACKEND resuelve "mañana"/"el sábado" contra "hoy" (Colombia);
 * la fecha que propone la IA (que no conoce la fecha actual) es solo un respaldo validado.
 * Pura, sin red.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolverFechaSolicitada } from "@/lib/agent-compiler/calendar/fecha-solicitada";

// Jueves 2030-03-14.
const HOY = "2030-03-14";

describe("resolverFechaSolicitada — el texto del cliente manda sobre la IA", () => {
  it("'mañana' => día siguiente, ignorando una fecha adivinada por la IA (otro año)", () => {
    const r = resolverFechaSolicitada({ solicitudTexto: "mañana", fechaPropuesta: "2024-05-04", hoyISO: HOY });
    assert.deepEqual(r, { ok: true, fecha: "2030-03-15", origen: "texto" });
  });

  it("'el sábado' / 'hoy' / 'pasado mañana'", () => {
    assert.deepEqual(resolverFechaSolicitada({ solicitudTexto: "el sábado", hoyISO: HOY }), { ok: true, fecha: "2030-03-16", origen: "texto" });
    assert.deepEqual(resolverFechaSolicitada({ solicitudTexto: "hoy", hoyISO: HOY }), { ok: true, fecha: HOY, origen: "texto" });
    assert.deepEqual(resolverFechaSolicitada({ solicitudTexto: "pasado mañana", hoyISO: HOY }), { ok: true, fecha: "2030-03-16", origen: "texto" });
  });

  it("texto con fecha y hora juntas ('mañana a las 10') resuelve la fecha", () => {
    assert.deepEqual(resolverFechaSolicitada({ solicitudTexto: "mañana a las 10", hoyISO: HOY }), { ok: true, fecha: "2030-03-15", origen: "texto" });
  });

  it("una fecha que el cliente escribió y ya pasó se RECHAZA (nunca se cambia por la propuesta de la IA)", () => {
    const r = resolverFechaSolicitada({ solicitudTexto: "el 13 de marzo", fechaPropuesta: "2030-04-01", hoyISO: HOY });
    assert.deepEqual(r, { ok: false, motivo: "fecha_pasada" });
  });

  it("fechas con 'el'/'para el' delante ('el 15 de marzo') se entienden", () => {
    assert.deepEqual(resolverFechaSolicitada({ solicitudTexto: "el 15 de marzo", hoyISO: HOY }), { ok: true, fecha: "2030-03-15", origen: "texto" });
    assert.deepEqual(resolverFechaSolicitada({ solicitudTexto: "para el 20 de marzo", hoyISO: HOY }), { ok: true, fecha: "2030-03-20", origen: "texto" });
  });
});

describe("resolverFechaSolicitada — respaldo: la propuesta de la IA solo si es una fecha real y no pasada", () => {
  it("el cliente HABLA de una fecha que el parser no resuelve + propuesta válida futura => se acepta (origen propuesta)", () => {
    assert.deepEqual(resolverFechaSolicitada({ solicitudTexto: "dentro de dos semanas", fechaPropuesta: "2030-03-28", hoyISO: HOY }), { ok: true, fecha: "2030-03-28", origen: "propuesta" });
    assert.deepEqual(resolverFechaSolicitada({ fechaPropuesta: HOY, hoyISO: HOY }), { ok: true, fecha: HOY, origen: "propuesta" }, "sin texto del cliente (compatibilidad)");
  });

  it("el cliente NO habló de ninguna fecha ('cuando puedas', un chiste, su nombre) => la IA NO puede elegirla (fecha_invalida)", () => {
    for (const t of ["cuando puedas", "cuéntame un chiste", "Ana Pérez", "no sé"]) {
      assert.deepEqual(resolverFechaSolicitada({ solicitudTexto: t, fechaPropuesta: "2030-03-20", hoyISO: HOY }), { ok: false, motivo: "fecha_invalida" }, t);
    }
  });

  it("nombró un día de la semana pero la propuesta cae en OTRO día => fecha_invalida (la IA no puede cambiarle el día)", () => {
    // 2030-03-20 es miércoles; 2030-03-21, jueves.
    assert.deepEqual(resolverFechaSolicitada({ solicitudTexto: "dentro de una semana, un jueves", fechaPropuesta: "2030-03-20", hoyISO: HOY }), { ok: false, motivo: "fecha_invalida" });
    assert.deepEqual(resolverFechaSolicitada({ solicitudTexto: "dentro de una semana, un jueves", fechaPropuesta: "2030-03-21", hoyISO: HOY }), { ok: true, fecha: "2030-03-21", origen: "propuesta" });
  });

  it("propuesta en el pasado (típico: la IA supone otro año) => fecha_pasada", () => {
    assert.deepEqual(resolverFechaSolicitada({ solicitudTexto: "para la semana entrante", fechaPropuesta: "2024-05-04", hoyISO: HOY }), { ok: false, motivo: "fecha_pasada" });
  });

  it("propuesta inexistente/mal formada => fecha_invalida (fail-closed)", () => {
    for (const f of ["2030-02-31", "2030-13-01", "mañana", "16/03/2030", ""]) {
      assert.deepEqual(resolverFechaSolicitada({ fechaPropuesta: f, hoyISO: HOY }), { ok: false, motivo: "fecha_invalida" }, f);
    }
    assert.deepEqual(resolverFechaSolicitada({ hoyISO: HOY }), { ok: false, motivo: "fecha_invalida" });
  });
});
