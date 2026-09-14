/**
 * FASE 10 (Analytics, autorizado) — tests puros de lib/analytics/periodo.ts.
 * Sin Supabase, sin red: solo parseo/validación de fechas.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolverPeriodo } from "@/lib/analytics/periodo";

function sp(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

describe("resolverPeriodo", () => {
  it("default (sin parámetro) es 30d", () => {
    const r = resolverPeriodo(sp({}));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.periodo.etiqueta, "30d");
    const diasRango = (r.periodo.hasta.getTime() - r.periodo.desde.getTime()) / (24 * 60 * 60 * 1000);
    assert.ok(Math.abs(diasRango - 30) < 0.01);
  });

  it("today acota al inicio del día actual", () => {
    const r = resolverPeriodo(sp({ periodo: "today" }));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.periodo.desde.getHours(), 0);
    assert.equal(r.periodo.desde.getMinutes(), 0);
  });

  it("7d cubre exactamente 7 días", () => {
    const r = resolverPeriodo(sp({ periodo: "7d" }));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const diasRango = (r.periodo.hasta.getTime() - r.periodo.desde.getTime()) / (24 * 60 * 60 * 1000);
    assert.ok(Math.abs(diasRango - 7) < 0.01);
  });

  it("custom con desde/hasta válidos funciona", () => {
    const r = resolverPeriodo(sp({ periodo: "custom", desde: "2026-01-01", hasta: "2026-01-31" }));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.periodo.etiqueta, "custom");
    assert.equal(r.periodo.desde.toISOString().slice(0, 10), "2026-01-01");
    assert.equal(r.periodo.hasta.toISOString().slice(0, 10), "2026-01-31");
  });

  it("custom sin desde/hasta es un error 400, no un crash", () => {
    const r = resolverPeriodo(sp({ periodo: "custom" }));
    assert.equal(r.ok, false);
  });

  it("custom con desde posterior a hasta es un error", () => {
    const r = resolverPeriodo(sp({ periodo: "custom", desde: "2026-02-01", hasta: "2026-01-01" }));
    assert.equal(r.ok, false);
  });

  it("custom con fechas inválidas es un error, no NaN silencioso", () => {
    const r = resolverPeriodo(sp({ periodo: "custom", desde: "no-es-fecha", hasta: "2026-01-01" }));
    assert.equal(r.ok, false);
  });

  it("custom con un rango absurdo (>366 días) se rechaza -- nunca un scan sin techo", () => {
    const r = resolverPeriodo(sp({ periodo: "custom", desde: "2000-01-01", hasta: "2026-01-01" }));
    assert.equal(r.ok, false);
  });

  it("periodo inválido es un error explícito", () => {
    const r = resolverPeriodo(sp({ periodo: "siglo" }));
    assert.equal(r.ok, false);
  });
});
