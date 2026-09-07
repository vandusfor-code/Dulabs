import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  construirOpcionesProfesional,
  renderizarMenuProfesional,
  textoSeleccionInvalidaProfesional,
  resolverSeleccionProfesional,
  esOpcionProfesional,
} from "@/lib/agenda-v2/profesionales";
import type { EspecialistaElegible } from "@/lib/asignacion-categoria";

const ESPECIALISTAS: EspecialistaElegible[] = [
  { especialistaId: 1262, nombre: "Mary" },
  { especialistaId: 1265, nombre: "Jessica" },
];

describe("construirOpcionesProfesional -- exclusivamente los especialistas elegibles ya resueltos, nunca inventados", () => {
  it("numera en orden y conserva el id real de cada especialista (nunca hardcodeado)", () => {
    const opciones = construirOpcionesProfesional(ESPECIALISTAS);
    assert.deepEqual(
      opciones.map((o) => [o.numero, o.profesionalId, o.nombre]),
      [
        [1, 1262, "Mary"],
        [2, 1265, "Jessica"],
      ],
    );
  });

  it("lista vacía -> opciones vacías, nunca inventa un profesional", () => {
    assert.deepEqual(construirOpcionesProfesional([]), []);
  });

  it("conserva el orden de prioridad que ya decidió resolverEspecialistasElegiblesParaServicio, nunca reordena", () => {
    const opciones = construirOpcionesProfesional([
      { especialistaId: 1264, nombre: "Nata" },
      { especialistaId: 1263, nombre: "Cristal" },
    ]);
    assert.deepEqual(opciones.map((o) => o.nombre), ["Nata", "Cristal"]);
  });
});

describe("renderizarMenuProfesional / textoSeleccionInvalidaProfesional -- texto siempre reconstruido desde datos reales", () => {
  it("incluye el encabezado y cada profesional numerado", () => {
    const texto = renderizarMenuProfesional(construirOpcionesProfesional(ESPECIALISTAS));
    assert.match(texto, /¿Con quién deseas realizarte el servicio\?/);
    assert.match(texto, /1\. Mary/);
    assert.match(texto, /2\. Jessica/);
  });

  it("el texto de selección inválida reenvía EXACTAMENTE las mismas opciones, sin reordenar", () => {
    const opciones = construirOpcionesProfesional(ESPECIALISTAS);
    const texto = textoSeleccionInvalidaProfesional(opciones);
    assert.match(texto, /No reconocí esa opción/);
    assert.match(texto, /1\. Mary/);
    assert.match(texto, /2\. Jessica/);
  });
});

describe("resolverSeleccionProfesional -- SOLO número exacto contra las opciones ya mostradas, nunca fuzzy ni nombre libre", () => {
  const OPCIONES = construirOpcionesProfesional(ESPECIALISTAS);

  it("número exacto resuelve el profesional real correspondiente", () => {
    assert.equal(resolverSeleccionProfesional("1", OPCIONES)?.profesionalId, 1262);
    assert.equal(resolverSeleccionProfesional("2", OPCIONES)?.profesionalId, 1265);
  });

  it("número con espacios alrededor también resuelve (trim, nunca falla por formato)", () => {
    assert.equal(resolverSeleccionProfesional("  1  ", OPCIONES)?.profesionalId, 1262);
  });

  it("número fuera de rango -> undefined, nunca aproxima a la más cercana", () => {
    assert.equal(resolverSeleccionProfesional("999", OPCIONES), undefined);
    assert.equal(resolverSeleccionProfesional("0", OPCIONES), undefined);
  });

  it("texto no numérico, incluido el nombre real exacto del profesional -> siempre undefined en esta fase", () => {
    for (const texto of ["hola", "quiero a mary", "Mary", "no sé", "1 por favor", "uno", "cualquiera"]) {
      assert.equal(resolverSeleccionProfesional(texto, OPCIONES), undefined, `"${texto}" nunca debe resolver -- solo número exacto`);
    }
  });

  it("nunca extrae dígitos de en medio de un texto ('999abc', 'opción 1')", () => {
    assert.equal(resolverSeleccionProfesional("999abc", OPCIONES), undefined);
    assert.equal(resolverSeleccionProfesional("opción 1", OPCIONES), undefined);
  });
});

describe("esOpcionProfesional -- discrimina la forma guardada en opcionesMostradas", () => {
  it("una opción de profesional (con profesionalId) se reconoce como tal", () => {
    assert.equal(esOpcionProfesional({ numero: 1, profesionalId: 1262, nombre: "Mary" }), true);
  });

  it("una opción de servicio o de categoría NUNCA se confunde con una de profesional", () => {
    assert.equal(esOpcionProfesional({ numero: 1, servicioId: "s-dipping", nombre: "Dipping", precio: 60000, duracionMin: 120 }), false);
    assert.equal(esOpcionProfesional({ numero: 1, categoria: "Uñas" }), false);
  });

  it("valores no-objeto (null, string, número) nunca se confunden con una opción de profesional", () => {
    assert.equal(esOpcionProfesional(null), false);
    assert.equal(esOpcionProfesional("Mary"), false);
    assert.equal(esOpcionProfesional(1), false);
  });
});
