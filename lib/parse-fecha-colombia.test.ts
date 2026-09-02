import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFechaColombia } from "@/lib/parse-fecha-colombia";

// Ancla fija para que los tests sean deterministas sin depender del reloj
// real: 2026-09-02 es un miércoles.
const HOY = "2026-09-02";

describe("parseFechaColombia — relativas simples", () => {
  it("hoy", () => {
    const r = parseFechaColombia("hoy", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-02");
  });

  it("mañana", () => {
    const r = parseFechaColombia("mañana", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-03");
  });

  it("manana (sin tilde)", () => {
    const r = parseFechaColombia("manana", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-03");
  });

  it("pasado mañana", () => {
    const r = parseFechaColombia("pasado mañana", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-04");
  });
});

describe("parseFechaColombia — días de la semana", () => {
  it("el sábado (próximo sábado desde miércoles 2 de sept)", () => {
    const r = parseFechaColombia("el sábado", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-05");
  });

  it("este sábado -- mismo resultado que 'el sábado'", () => {
    const r = parseFechaColombia("este sábado", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-05");
  });

  it("sábado a secas", () => {
    const r = parseFechaColombia("sabado", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-05");
  });

  it("el lunes (próximo lunes desde miércoles)", () => {
    const r = parseFechaColombia("el lunes", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-07");
  });

  it("próximo lunes -- igual que 'el lunes' cuando hoy NO es lunes", () => {
    const r = parseFechaColombia("próximo lunes", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-07");
  });

  it("'el miércoles' dicho un miércoles == hoy", () => {
    const r = parseFechaColombia("el miercoles", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-02");
  });

  it("'próximo miércoles' dicho un miércoles == la semana siguiente, NO hoy", () => {
    const r = parseFechaColombia("proximo miercoles", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-09");
  });

  it("domingo", () => {
    const r = parseFechaColombia("el domingo", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-06");
  });
});

describe("parseFechaColombia — fecha explícita", () => {
  it("4 de septiembre", () => {
    const r = parseFechaColombia("4 de septiembre", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-04");
  });

  it("4 de sept (abreviado)", () => {
    const r = parseFechaColombia("4 de sept", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-04");
  });

  it("septiembre 4", () => {
    const r = parseFechaColombia("septiembre 4", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-04");
  });

  it("04/09", () => {
    const r = parseFechaColombia("04/09", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-04");
  });

  it("04-09", () => {
    const r = parseFechaColombia("04-09", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-04");
  });

  it("4/9 (sin ceros)", () => {
    const r = parseFechaColombia("4/9", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-04");
  });

  it("YYYY-MM-DD tal cual", () => {
    const r = parseFechaColombia("2026-09-20", HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-09-20");
  });
});

describe("parseFechaColombia — fechas pasadas, nunca se aceptan", () => {
  it("1 de septiembre (ya pasó, hoy es 2)", () => {
    const r = parseFechaColombia("1 de septiembre", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.kind, "past");
  });

  it("01/09 (ya pasó)", () => {
    const r = parseFechaColombia("01/09", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.kind, "past");
  });

  it("2026-08-15 (mes pasado)", () => {
    const r = parseFechaColombia("2026-08-15", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.kind, "past");
  });
});

describe("parseFechaColombia — fechas inválidas, nunca se inventan", () => {
  it("31 de febrero -- no existe, NO se redondea a marzo", () => {
    const r = parseFechaColombia("31 de febrero", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.kind, "invalid");
  });

  it("32/09 -- día inválido", () => {
    const r = parseFechaColombia("32/09", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.kind, "invalid");
  });

  it("13 de miamor -- mes inexistente", () => {
    const r = parseFechaColombia("13 de miamor", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.kind, "invalid");
  });

  it("texto incomprensible", () => {
    const r = parseFechaColombia("quiero uñas bonitas por favor", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.kind, "invalid");
  });

  it("cadena vacía", () => {
    const r = parseFechaColombia("", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.kind, "invalid");
  });

  it("cancela -- nunca se interpreta como fecha (defensivo; el escape hatch ya lo intercepta antes)", () => {
    const r = parseFechaColombia("cancela", HOY);
    assert.equal(r.ok, false);
  });
});

describe("parseFechaColombia — ambiguo, nunca adivina", () => {
  it("el otro sábado -- no se sabe cuál 'otro'", () => {
    const r = parseFechaColombia("el otro sabado", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.kind, "ambiguous");
  });

  it("este fin de semana -- sábado o domingo, no se asume", () => {
    const r = parseFechaColombia("este fin de semana", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.kind, "ambiguous");
  });
});
