/**
 * Portal público de reservas — normalización de la lista de servicios de UNA cita (manos + pies). Solo la limpieza de la entrada: sin vacíos ni repetidos, en el
 * orden pedido, de 1 a 3, y rechazo claro de lo que no es un id.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizarServicioIds, servicioIdsDeBusqueda, servicioIdsDeCuerpo } from "@/lib/reserva-portal-servicios";

describe("normalizarServicioIds", () => {
  it("conserva el orden pedido y recorta espacios", () => {
    assert.deepEqual(normalizarServicioIds([" b ", "a"]), { ok: true, ids: ["b", "a"] });
  });

  it("ignora vacíos, null/undefined y repetidos", () => {
    assert.deepEqual(normalizarServicioIds(["a", "", "  ", undefined, null, "a", "b"]), { ok: true, ids: ["a", "b"] });
  });

  it("sin ningún servicio -> faltan", () => {
    for (const entrada of [[], [""], [undefined], [null, "  "]]) {
      const r = normalizarServicioIds(entrada);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "faltan");
    }
  });

  it("máximo 3 servicios distintos; con 4 -> demasiados (pero 4 con repetidos que quedan en 3 sí vale)", () => {
    assert.deepEqual(normalizarServicioIds(["a", "b", "c"]), { ok: true, ids: ["a", "b", "c"] });
    const r = normalizarServicioIds(["a", "b", "c", "d"]);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.motivo, "demasiados");
      assert.match(r.error, /3/);
    }
    assert.deepEqual(normalizarServicioIds(["a", "b", "c", "a"]), { ok: true, ids: ["a", "b", "c"] });
  });

  it("algo que no es texto, o un id gigante -> invalidos", () => {
    for (const entrada of [[123], [{ id: "a" }], [["a"]], ["x".repeat(65)]]) {
      const r = normalizarServicioIds(entrada);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "invalidos");
    }
  });
});

describe("servicioIdsDeBusqueda (GET)", () => {
  it("servicioIds=a,b separa por comas", () => {
    assert.deepEqual(servicioIdsDeBusqueda(new URLSearchParams("servicioIds=a,b")), { ok: true, ids: ["a", "b"] });
  });

  it("servicioId=a (forma original, un solo servicio) sigue funcionando", () => {
    assert.deepEqual(servicioIdsDeBusqueda(new URLSearchParams("servicioId=a")), { ok: true, ids: ["a"] });
  });

  it("servicioId repetido también se acepta", () => {
    assert.deepEqual(servicioIdsDeBusqueda(new URLSearchParams("servicioId=a&servicioId=b")), { ok: true, ids: ["a", "b"] });
  });

  it("si vienen ambos, manda servicioIds", () => {
    assert.deepEqual(servicioIdsDeBusqueda(new URLSearchParams("servicioIds=a,b&servicioId=z")), { ok: true, ids: ["a", "b"] });
  });

  it("sin nada, o con comas sueltas -> faltan", () => {
    for (const q of ["", "servicioIds=", "servicioIds=,,", "servicioId="]) {
      const r = servicioIdsDeBusqueda(new URLSearchParams(q));
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "faltan");
    }
  });
});

describe("servicioIdsDeCuerpo (POST)", () => {
  it("servicioIds: [a, b]", () => {
    assert.deepEqual(servicioIdsDeCuerpo({ servicioIds: ["a", "b"] }), { ok: true, ids: ["a", "b"] });
  });

  it("solo servicioId (forma original)", () => {
    assert.deepEqual(servicioIdsDeCuerpo({ servicioId: "a" }), { ok: true, ids: ["a"] });
  });

  it("servicioIds vacío cae al servicioId", () => {
    assert.deepEqual(servicioIdsDeCuerpo({ servicioIds: [], servicioId: "a" }), { ok: true, ids: ["a"] });
  });

  it("si vienen ambos, manda servicioIds", () => {
    assert.deepEqual(servicioIdsDeCuerpo({ servicioIds: ["b", "c"], servicioId: "a" }), { ok: true, ids: ["b", "c"] });
  });

  it("servicioIds que no es una lista -> invalidos (nunca se interpreta)", () => {
    for (const servicioIds of ["a,b", 5, { 0: "a" }]) {
      const r = servicioIdsDeCuerpo({ servicioIds });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "invalidos");
    }
  });

  it("sin ningún servicio -> faltan; más de 3 -> demasiados", () => {
    const sin = servicioIdsDeCuerpo({});
    assert.equal(sin.ok, false);
    if (!sin.ok) assert.equal(sin.motivo, "faltan");
    const muchos = servicioIdsDeCuerpo({ servicioIds: ["a", "b", "c", "d"] });
    assert.equal(muchos.ok, false);
    if (!muchos.ok) assert.equal(muchos.motivo, "demasiados");
  });
});
