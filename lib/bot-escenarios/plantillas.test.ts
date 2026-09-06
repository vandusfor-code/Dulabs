import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { elegirYRenderizarPlantilla } from "@/lib/bot-escenarios/plantillas";

describe("elegirYRenderizarPlantilla — selección determinista + interpolación real", () => {
  it("interpola variables reales con lib/flow/message-interpolation.ts (sin reimplementar el motor)", () => {
    const texto = elegirYRenderizarPlantilla({
      respuestas: ["El {{servicio}} cuesta {{precioTexto}}."],
      tenantId: "t1",
      escenarioCodigo: "x",
      turno: 0,
      variables: { servicio: "Dipping", precioTexto: "$60.000" },
    });
    assert.equal(texto, "El Dipping cuesta $60.000.");
  });

  it("mismo turno + misma conversación -> siempre la misma plantilla (reproducible)", () => {
    const params = { respuestas: ["A", "B", "C"], tenantId: "t1", escenarioCodigo: "x", turno: 3, variables: {} };
    assert.equal(elegirYRenderizarPlantilla(params), elegirYRenderizarPlantilla(params));
  });

  it("turnos distintos rotan entre las plantillas configuradas (no siempre la misma frase)", () => {
    const resultados = new Set(
      Array.from({ length: 6 }, (_, turno) =>
        elegirYRenderizarPlantilla({ respuestas: ["A", "B", "C"], tenantId: "t1", escenarioCodigo: "x", turno, variables: {} }),
      ),
    );
    assert.ok(resultados.size > 1, "debería haber usado más de una variante entre 6 turnos distintos");
  });

  it("sin ninguna respuesta configurada, devuelve undefined (nunca una IA elige por defecto)", () => {
    assert.equal(elegirYRenderizarPlantilla({ respuestas: [], tenantId: "t1", escenarioCodigo: "x", turno: 0, variables: {} }), undefined);
  });
});
