/**
 * Servicios del Business Agent -- validación pura (precio/duración estructurados).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rowToService, validateServiceInput, SERVICE_LIMITS, type ServicioRow } from "@/lib/business-agent-services";

describe("validateServiceInput", () => {
  it("acepta un servicio completo válido y normaliza", () => {
    const r = validateServiceInput({ nombre: "  Manicure básica ", categoria: " Uñas ", descripcion: " x ", duracionMin: 30, precio: 30000, activo: true });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.value.nombre, "Manicure básica");
      assert.equal(r.value.categoria, "Uñas");
      assert.equal(r.value.duracionMin, 30);
      assert.equal(r.value.precio, 30000);
      assert.equal(r.value.activo, true);
    }
  });

  it("rechaza sin nombre", () => {
    const r = validateServiceInput({ nombre: "   ", duracionMin: 30 });
    assert.equal(r.ok, false);
  });

  it("rechaza duración inválida (0, negativa, no entera)", () => {
    for (const d of [0, -5, 12.5, "abc"]) {
      const r = validateServiceInput({ nombre: "X", duracionMin: d });
      assert.equal(r.ok, false, `duración ${d} debe rechazarse`);
    }
  });

  it("acepta el alias duracion_min (snake_case del body)", () => {
    const r = validateServiceInput({ nombre: "X", duracion_min: 45 });
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.value.duracionMin, 45);
  });

  it("precio vacío/null => null (servicio sin precio fijo); negativo => error", () => {
    const vacio = validateServiceInput({ nombre: "X", duracionMin: 30, precio: "" });
    assert.ok(vacio.ok && vacio.value.precio === null);
    const nulo = validateServiceInput({ nombre: "X", duracionMin: 30, precio: null });
    assert.ok(nulo.ok && nulo.value.precio === null);
    const neg = validateServiceInput({ nombre: "X", duracionMin: 30, precio: -1 });
    assert.equal(neg.ok, false);
  });

  it("aplica topes de tamaño (nombre demasiado largo)", () => {
    const r = validateServiceInput({ nombre: "a".repeat(SERVICE_LIMITS.nombre + 1), duracionMin: 30 });
    assert.equal(r.ok, false);
  });

  it("rowToService mapea la fila de dulabs_servicios a la proyección pública", () => {
    const row: ServicioRow = { id: "s1", nombre: "Pedicure", categoria: null, descripcion: null, duracion_min: 45, precio: 40000, activo: true };
    assert.deepEqual(rowToService(row), { id: "s1", nombre: "Pedicure", categoria: null, descripcion: null, duracionMin: 45, precio: 40000, activo: true });
  });
});
