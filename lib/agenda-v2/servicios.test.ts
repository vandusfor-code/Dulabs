import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  construirOpcionesServicio,
  renderizarMenuServicio,
  textoSeleccionInvalidaServicio,
  resolverSeleccionServicio,
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

describe("textoSeleccionInvalidaServicio -- reenvía EXACTAMENTE las opciones ya guardadas", () => {
  it("incluye las mismas opciones, sin re-consultar ni reordenar", () => {
    const opciones = construirOpcionesServicio(CATALOGO);
    const texto = textoSeleccionInvalidaServicio(opciones);
    assert.match(texto, /1\. Dipping/);
    assert.match(texto, /2\. Press On/);
    assert.match(texto, /3\. Retoques/);
  });
});
