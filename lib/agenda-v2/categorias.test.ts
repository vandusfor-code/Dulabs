import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  construirOpcionesCategoria,
  renderizarMenuCategoria,
  textoSeleccionInvalidaCategoria,
  resolverSeleccionCategoria,
  esOpcionCategoria,
} from "@/lib/agenda-v2/categorias";
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";

const CATALOGO: ServicioCatalogoReal[] = [
  { id: "s-peinado", nombre: "Peinado", precio: 40000, duracionMin: 60, categoria: "Cabello", descripcion: null },
  { id: "s-dipping", nombre: "Dipping", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-presson", nombre: "Press On", precio: 80000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-sombreado", nombre: "Sombreado de Cejas", precio: 35000, duracionMin: 45, categoria: "Cejas", descripcion: null },
];

describe("construirOpcionesCategoria -- exclusivamente categorías reales del catálogo, nunca inventadas", () => {
  it("una entrada por categoría distinta, en orden de aparición, nunca repetida", () => {
    const opciones = construirOpcionesCategoria(CATALOGO);
    assert.deepEqual(
      opciones.map((o) => [o.numero, o.categoria]),
      [
        [1, "Cabello"],
        [2, "Uñas"],
        [3, "Cejas"],
      ],
    );
  });

  it("catálogo vacío -> lista de categorías vacía, nunca inventa una categoría", () => {
    assert.deepEqual(construirOpcionesCategoria([]), []);
  });

  it("nunca incluye una categoría null/vacía como opción -- si existiera, se omite en vez de inventar 'Sin clasificar'", () => {
    const conNulos: ServicioCatalogoReal[] = [
      ...CATALOGO,
      { id: "s-sin-cat", nombre: "Servicio sin categoría", precio: 1000, duracionMin: 10, categoria: null, descripcion: null },
      { id: "s-cat-vacia", nombre: "Servicio con categoría vacía", precio: 1000, duracionMin: 10, categoria: "   ", descripcion: null },
    ];
    const opciones = construirOpcionesCategoria(conNulos);
    assert.equal(opciones.length, 3, "las categorías null/vacías nunca generan una opción propia");
  });
});

describe("renderizarMenuCategoria / textoSeleccionInvalidaCategoria -- texto siempre reconstruido desde datos reales", () => {
  it("incluye el encabezado y cada categoría numerada", () => {
    const texto = renderizarMenuCategoria(construirOpcionesCategoria(CATALOGO));
    assert.match(texto, /¿Qué tipo de servicio te gustaría agendar\?/);
    assert.match(texto, /1\. Cabello/);
    assert.match(texto, /2\. Uñas/);
    assert.match(texto, /3\. Cejas/);
  });

  it("el texto de selección inválida reenvía EXACTAMENTE las mismas categorías, sin reordenar", () => {
    const opciones = construirOpcionesCategoria(CATALOGO);
    const texto = textoSeleccionInvalidaCategoria(opciones);
    assert.match(texto, /No reconocí esa opción/);
    assert.match(texto, /1\. Cabello/);
    assert.match(texto, /2\. Uñas/);
    assert.match(texto, /3\. Cejas/);
  });
});

describe("resolverSeleccionCategoria -- SOLO número exacto contra las opciones ya mostradas, nunca fuzzy ni nombre libre", () => {
  const OPCIONES = construirOpcionesCategoria(CATALOGO);

  it("número exacto resuelve la categoría real correspondiente", () => {
    assert.equal(resolverSeleccionCategoria("1", OPCIONES)?.categoria, "Cabello");
    assert.equal(resolverSeleccionCategoria("2", OPCIONES)?.categoria, "Uñas");
    assert.equal(resolverSeleccionCategoria("3", OPCIONES)?.categoria, "Cejas");
  });

  it("número con espacios alrededor también resuelve (trim, nunca falla por formato)", () => {
    assert.equal(resolverSeleccionCategoria("  2  ", OPCIONES)?.categoria, "Uñas");
  });

  it("número fuera de rango -> undefined, nunca aproxima a la más cercana", () => {
    assert.equal(resolverSeleccionCategoria("999", OPCIONES), undefined);
    assert.equal(resolverSeleccionCategoria("0", OPCIONES), undefined);
  });

  it("texto no numérico, incluido el nombre real exacto de la categoría -> siempre undefined en esta fase", () => {
    for (const texto of ["hola", "quiero uñas", "Uñas", "no sé", "2 por favor", "dos"]) {
      assert.equal(resolverSeleccionCategoria(texto, OPCIONES), undefined, `"${texto}" nunca debe resolver -- solo número exacto`);
    }
  });

  it("nunca extrae dígitos de en medio de un texto ('999abc', 'opción 1')", () => {
    assert.equal(resolverSeleccionCategoria("999abc", OPCIONES), undefined);
    assert.equal(resolverSeleccionCategoria("opción 1", OPCIONES), undefined);
  });
});

describe("esOpcionCategoria -- discrimina la forma guardada en opcionesMostradas sin necesitar un campo `tipo` nuevo", () => {
  it("una opción de categoría (sin servicioId) se reconoce como categoría", () => {
    assert.equal(esOpcionCategoria({ numero: 1, categoria: "Uñas" }), true);
  });

  it("una opción de servicio (con servicioId) NUNCA se confunde con una categoría -- compatibilidad con sesiones ya creadas antes de este ajuste", () => {
    assert.equal(esOpcionCategoria({ numero: 1, servicioId: "s-dipping", nombre: "Dipping", precio: 60000, duracionMin: 120 }), false);
  });

  it("valores no-objeto (null, string, número) nunca se confunden con una categoría", () => {
    assert.equal(esOpcionCategoria(null), false);
    assert.equal(esOpcionCategoria("Uñas"), false);
    assert.equal(esOpcionCategoria(1), false);
  });
});
