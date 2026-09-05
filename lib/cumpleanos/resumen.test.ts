import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resumirResultados } from "./resumen";
import type { ResultadoClienteCumpleanos } from "./motor";

describe("resumirResultados (Fase 6B, pura)", () => {
  it("cuenta procesados/enviados/omitidos/errores correctamente", () => {
    const procesados: ResultadoClienteCumpleanos[] = [
      { clienteId: 1, nombre: "A", resultado: "enviado" },
      { clienteId: 2, nombre: "B", resultado: "simulado" },
      { clienteId: 3, nombre: "C", resultado: "ya_procesado" },
      { clienteId: 4, nombre: "D", resultado: "ya_procesado" },
      { clienteId: 5, nombre: "E", resultado: "fallido", detalle: "teléfono inválido" },
    ];
    assert.deepEqual(resumirResultados(procesados), { procesados: 5, enviados: 2, omitidos: 2, errores: 1 });
  });

  it("lote vacío -> todo en cero", () => {
    assert.deepEqual(resumirResultados([]), { procesados: 0, enviados: 0, omitidos: 0, errores: 0 });
  });
});
