import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  construirOpcionesServicio,
  renderizarMenuServicio,
  textoSeleccionInvalidaServicio,
  resolverSeleccionServicio,
  resolverSeleccionMultiServicio,
} from "@/lib/agenda-v2/servicios";
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";

const CATALOGO: ServicioCatalogoReal[] = [
  { id: "s-dipping", nombre: "Dipping", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-presson", nombre: "Press On", precio: 80000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-retoques", nombre: "Retoques", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
];

describe("construirOpcionesServicio -- exclusivamente el catálogo real recibido, nunca inventado", () => {
  it("numera en orden y conserva el UUID real de cada servicio (nunca hardcodeado)", () => {
    const opciones = construirOpcionesServicio(CATALOGO);
    assert.deepEqual(
      opciones.map((o) => [o.numero, o.servicioId, o.nombre]),
      [
        [1, "s-dipping", "Dipping"],
        [2, "s-presson", "Press On"],
        [3, "s-retoques", "Retoques"],
      ],
    );
  });

  it("conserva precio y duración reales -- necesarios en fases posteriores", () => {
    const opciones = construirOpcionesServicio(CATALOGO);
    assert.equal(opciones[0]!.precio, 60000);
    assert.equal(opciones[0]!.duracionMin, 120);
  });

  it("catálogo vacío -> lista de opciones vacía, nunca inventa un servicio", () => {
    assert.deepEqual(construirOpcionesServicio([]), []);
  });
});

describe("renderizarMenuServicio -- texto siempre reconstruido desde datos reales", () => {
  it("incluye el encabezado y cada opción numerada con precio real formateado", () => {
    const texto = renderizarMenuServicio(construirOpcionesServicio(CATALOGO));
    assert.match(texto, /¿Qué servicio deseas realizarte\?/);
    assert.match(texto, /1\. Dipping — \$60\.000/);
    assert.match(texto, /2\. Press On — \$80\.000/);
    assert.match(texto, /3\. Retoques — \$60\.000/);
  });
});

describe("resolverSeleccionServicio -- SOLO número exacto contra las opciones ya mostradas, nunca fuzzy", () => {
  const OPCIONES = construirOpcionesServicio(CATALOGO);

  it("número exacto resuelve el servicio real correspondiente", () => {
    assert.equal(resolverSeleccionServicio("1", OPCIONES)?.servicioId, "s-dipping");
    assert.equal(resolverSeleccionServicio("2", OPCIONES)?.servicioId, "s-presson");
    assert.equal(resolverSeleccionServicio("3", OPCIONES)?.servicioId, "s-retoques");
  });

  it("número con espacios alrededor también resuelve (trim, nunca falla por formato)", () => {
    assert.equal(resolverSeleccionServicio("  1  ", OPCIONES)?.servicioId, "s-dipping");
  });

  it("Test 2: número fuera de rango -> undefined, nunca aproxima a la más cercana", () => {
    assert.equal(resolverSeleccionServicio("999", OPCIONES), undefined);
    assert.equal(resolverSeleccionServicio("0", OPCIONES), undefined);
  });

  it("Test 3: texto no numérico -> siempre undefined, incluso el nombre real exacto del servicio", () => {
    for (const texto of ["hola", "quiero el dipping", "Dipping", "no sé", "1 por favor", "uno"]) {
      assert.equal(resolverSeleccionServicio(texto, OPCIONES), undefined, `"${texto}" nunca debe resolver -- solo número exacto en esta fase`);
    }
  });

  it("nunca usa parseInt(text.replace(/\\D/g, \"\")) -- '999abc' NUNCA se interpreta como '999' ni como ningún número", () => {
    assert.equal(resolverSeleccionServicio("999abc", OPCIONES), undefined);
    assert.equal(resolverSeleccionServicio("opción 1", OPCIONES), undefined, "debe ser el mensaje completo, nunca extraer dígitos de en medio");
  });
});

describe("FASE 3 (autorizado, multi-servicio) -- resolverSeleccionMultiServicio", () => {
  const OPCIONES = construirOpcionesServicio(CATALOGO);

  it("Test 1 (obligatorio) -- '1' sigue funcionando EXACTAMENTE igual (un solo elemento)", () => {
    const seleccion = resolverSeleccionMultiServicio("1", OPCIONES);
    assert.deepEqual(seleccion?.map((s) => s.servicioId), ["s-dipping"]);
  });

  it("Test 2/3/4/5 (obligatorios) -- '1 y 2', '1,2', '1 + 2', '1 y 2 y 3'", () => {
    assert.deepEqual(resolverSeleccionMultiServicio("1 y 2", OPCIONES)?.map((s) => s.servicioId), ["s-dipping", "s-presson"]);
    assert.deepEqual(resolverSeleccionMultiServicio("1,2", OPCIONES)?.map((s) => s.servicioId), ["s-dipping", "s-presson"]);
    assert.deepEqual(resolverSeleccionMultiServicio("1 + 2", OPCIONES)?.map((s) => s.servicioId), ["s-dipping", "s-presson"]);
    assert.deepEqual(resolverSeleccionMultiServicio("1 y 2 y 3", OPCIONES)?.map((s) => s.servicioId), ["s-dipping", "s-presson", "s-retoques"]);
  });

  it("acepta espacios variados y mayúsculas ('4 Y 5' estilo)", () => {
    assert.deepEqual(resolverSeleccionMultiServicio("1   y   2", OPCIONES)?.map((s) => s.servicioId), ["s-dipping", "s-presson"]);
  });

  it("Test 6 (obligatorio) -- más de 3 servicios -> rechazado", () => {
    // Con solo 3 opciones reales en este catálogo, se prueba con un cuarto número inventado -- igual debe rechazarse por exceder el máximo ANTES de validar existencia.
    assert.equal(resolverSeleccionMultiServicio("1 y 2 y 3 y 1", OPCIONES), undefined);
  });

  it("Test 7 (obligatorio) -- número duplicado ('1 y 1') -> rechazado", () => {
    assert.equal(resolverSeleccionMultiServicio("1 y 1", OPCIONES), undefined);
  });

  it("Test 8 (obligatorio) -- número inexistente ('99 y 2') -> rechazado, NUNCA inventa una opción", () => {
    assert.equal(resolverSeleccionMultiServicio("99 y 2", OPCIONES), undefined);
    assert.equal(resolverSeleccionMultiServicio("999", OPCIONES), undefined);
  });

  it("texto no numérico en la combinación -> rechazado (nunca nombres de servicio en esta fase)", () => {
    assert.equal(resolverSeleccionMultiServicio("dipping y press on", OPCIONES), undefined);
    assert.equal(resolverSeleccionMultiServicio("1 y dipping", OPCIONES), undefined);
  });

  it("mensaje vacío o solo separadores -> rechazado", () => {
    assert.equal(resolverSeleccionMultiServicio("", OPCIONES), undefined);
    assert.equal(resolverSeleccionMultiServicio("y", OPCIONES), undefined);
  });
});

describe("textoSeleccionInvalidaServicio -- reenvía EXACTAMENTE las opciones ya guardadas", () => {
  it("incluye las mismas opciones, sin re-consultar ni reordenar", () => {
    const opciones = construirOpcionesServicio(CATALOGO);
    const texto = textoSeleccionInvalidaServicio(opciones);
    assert.match(texto, /1\. Dipping/);
    assert.match(texto, /2\. Press On/);
    assert.match(texto, /3\. Retoques/);
  });
});
