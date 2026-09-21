import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agruparErroresPorCampana, TOPE_ERRORES_POR_CAMPANA, type FilaMensajeFallido } from "@/lib/campanas-errores";

const fila = (campana_id: number | null, telefono: string, extra: Partial<FilaMensajeFallido> = {}): FilaMensajeFallido => ({
  campana_id,
  telefono_cliente: telefono,
  wamid: null,
  error_codigo: null,
  error_detalle: null,
  ...extra,
});

describe("agruparErroresPorCampana", () => {
  it("agrupa por campaña con el código y el detalle que reportó Meta", () => {
    const m = agruparErroresPorCampana([
      fila(19, "573001112233", { wamid: "wamid.A", error_codigo: 131026, error_detalle: "Message Undeliverable." }),
      fila(19, "573004445566", { error_codigo: 131049, error_detalle: "no entregado" }),
      fila(20, "573007778899", { error_codigo: 130472 }),
    ]);
    assert.equal(m.get(19)?.length, 2);
    assert.deepEqual(m.get(19)?.[0], { telefono: "573001112233", wamid: "wamid.A", errorCodigo: 131026, errorDetalle: "Message Undeliverable." });
    assert.equal(m.get(20)?.[0].errorCodigo, 130472);
  });

  it("el código puede venir como texto o faltar: nunca revienta ni inventa un número", () => {
    const m = agruparErroresPorCampana([fila(1, "573001", { error_codigo: "131049" }), fila(1, "573002", { error_codigo: null }), fila(1, "573003", { error_codigo: "abc" })]);
    assert.deepEqual(m.get(1)?.map((e) => e.errorCodigo), [131049, null, null]);
  });

  it("ignora filas sin campaña y una campaña sin fallos no aparece (la página usa [] por defecto)", () => {
    const m = agruparErroresPorCampana([fila(null, "573001")]);
    assert.equal(m.size, 0);
    assert.deepEqual(m.get(5) ?? [], []);
  });

  it("acota el tamaño por campaña", () => {
    const filas = Array.from({ length: TOPE_ERRORES_POR_CAMPANA + 25 }, (_, i) => fila(7, `57300${i}`));
    assert.equal(agruparErroresPorCampana(filas).get(7)?.length, TOPE_ERRORES_POR_CAMPANA);
    assert.equal(agruparErroresPorCampana(filas, 3).get(7)?.length, 3);
  });
});
