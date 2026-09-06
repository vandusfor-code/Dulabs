import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolverEscenarioGanador } from "@/lib/bot-escenarios/matching";
import type { EntidadesDetectadas, EscenarioRow } from "@/lib/bot-escenarios/tipos";

function entidades(overrides: Partial<EntidadesDetectadas> = {}): EntidadesDetectadas {
  return { esAfirmacionCorta: false, esNegacionCorta: false, serviciosDetectados: [], ...overrides };
}

function escenario(overrides: Partial<EscenarioRow>): EscenarioRow {
  return {
    id: "x", tenantId: "t", codigo: "x", nombre: "x", modo: "deterministic", prioridad: 0, activo: true,
    variantes: [], respuestas: [], config: {}, ...overrides,
  };
}

describe("resolverEscenarioGanador — matching + prioridad", () => {
  it("mayor prioridad gana aunque ambos coincidan por texto", () => {
    const bajo = escenario({ codigo: "bajo", prioridad: 10, variantes: [{ tipo: "contains", valor: "cita" }] });
    const alto = escenario({ codigo: "alto", prioridad: 900, variantes: [{ tipo: "contains", valor: "quiero agendar" }] });
    const ganador = resolverEscenarioGanador([bajo, alto], "quiero agendar una cita", entidades());
    assert.equal(ganador?.codigo, "alto");
  });

  it("escenarios inactivos nunca ganan aunque coincidan", () => {
    const inactivo = escenario({ codigo: "inactivo", prioridad: 900, activo: false, variantes: [{ tipo: "contains", valor: "hola" }] });
    const ganador = resolverEscenarioGanador([inactivo], "hola", entidades());
    assert.equal(ganador, undefined);
  });

  it("categoria_detectada solo coincide con la categoría exacta configurada, nunca con cualquiera", () => {
    const unas = escenario({ codigo: "unas", variantes: [{ tipo: "categoria_detectada", valor: "Uñas" }] });
    const cabello = escenario({ codigo: "cabello", variantes: [{ tipo: "categoria_detectada", valor: "Cabello" }] });
    const ganador = resolverEscenarioGanador([unas, cabello], "quiero uñas", entidades({ categoria: "Uñas" }));
    assert.equal(ganador?.codigo, "unas");
  });

  it("servicio_detectado coincide solo cuando la extracción de entidades encontró un servicio real", () => {
    const especifico = escenario({ codigo: "especifico", variantes: [{ tipo: "servicio_detectado" }] });
    assert.equal(resolverEscenarioGanador([especifico], "dipping", entidades({ servicioId: "s1" }))?.codigo, "especifico");
    assert.equal(resolverEscenarioGanador([especifico], "algo random", entidades())?.codigo, undefined);
  });

  it("dos_servicios_detectados coincide solo cuando hay 2+ servicios reales detectados (comparación)", () => {
    const comparacion = escenario({ codigo: "comparacion", prioridad: 530, variantes: [{ tipo: "dos_servicios_detectados" }] });
    const info = escenario({ codigo: "info", prioridad: 500, variantes: [{ tipo: "servicio_detectado" }] });
    const ganador = resolverEscenarioGanador(
      [info, comparacion],
      "dipping vs press on",
      entidades({ serviciosDetectados: [{ id: "s1", nombre: "Dipping", categoria: "Uñas" }, { id: "s4", nombre: "Press On", categoria: "Uñas" }] }),
    );
    assert.equal(ganador?.codigo, "comparacion", "debe ganar comparación, nunca resolver como un solo servicio específico");
  });

  it("sin ningún escenario coincidente, devuelve undefined (el caller decide el fallback)", () => {
    const e = escenario({ variantes: [{ tipo: "exact", valor: "solo esto" }] });
    assert.equal(resolverEscenarioGanador([e], "otra cosa completamente distinta", entidades()), undefined);
  });
});
