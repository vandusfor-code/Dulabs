/**
 * Inicio del catálogo público y vitrina por negocio — puro.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DESTACADOS_MAX, armarInicio, esListado } from "@/lib/catalogo/inicio";
import type { PublicCatalogProduct } from "@/lib/catalogo/publicacion";
import { vitrinaDe } from "@/lib/catalogo/vitrina";

function producto(ref: string, extra: Partial<PublicCatalogProduct> = {}): PublicCatalogProduct {
  return { reference: ref, name: `Pieza ${ref}`, description: null, material: null, color: null, categoryName: null, price: 10_000, imageUrl: null, thumbUrl: null, ...extra };
}
const foto = (ref: string) => ({ imageUrl: `/f/${ref}/main.webp`, thumbUrl: `/f/${ref}/thumb.webp` });

describe("destacados", () => {
  it("con foto primero, conservando el orden de recientes, y con tope", () => {
    const products = [producto("DL-000001"), producto("DL-000002", foto("2")), producto("DL-000003"), producto("DL-000004", foto("4"))];
    assert.deepEqual(
      armarInicio({ products, categories: [] }).destacados.map((p) => p.reference),
      ["DL-000002", "DL-000004", "DL-000001", "DL-000003"],
    );
    const muchos = Array.from({ length: 20 }, (_, i) => producto(`DL-${String(i).padStart(6, "0")}`));
    assert.equal(armarInicio({ products: muchos, categories: [] }).destacados.length, DESTACADOS_MAX);
  });

  it("sin productos: vacío (la vista muestra su estado vacío, nada inventado)", () => {
    assert.deepEqual(armarInicio({ products: [], categories: [] }), { destacados: [], categorias: [] });
  });
});

describe("categorías", () => {
  it("todas las reales, con la foto de uno de sus productos cuando existe", () => {
    const categories = [
      { id: "c1", name: "Anillos" },
      { id: "c2", name: "Dijes" },
      { id: "c3", name: "Pulseras" },
    ];
    const products = [
      producto("DL-000001", { categoryName: "anillos ", ...foto("1") }),
      producto("DL-000002", { categoryName: "Anillos", ...foto("2") }),
      producto("DL-000003", { categoryName: "Dijes" }),
    ];
    assert.deepEqual(armarInicio({ products, categories }).categorias, [
      { id: "c1", name: "Anillos", imageUrl: "/f/1/thumb.webp" },
      { id: "c2", name: "Dijes", imageUrl: null },
      { id: "c3", name: "Pulseras", imageUrl: null },
    ]);
  });
});

describe("vista", () => {
  it("inicio sin parámetros; listado con búsqueda, categoría, página o 'ver todo'", () => {
    assert.equal(esListado({}), false);
    for (const p of [{ q: "anillo" }, { categoria: "c1" }, { pagina: "2" }, { todo: "1" }]) assert.equal(esListado(p), true);
  });
});

describe("vitrina por negocio", () => {
  it("configuración editorial por slug; un negocio sin configurar obtiene una vitrina vacía (sin datos inventados)", () => {
    const d = vitrinaDe("delacour");
    assert.equal(d.hero?.cta, "Ver catálogo");
    assert.ok(d.hero?.imagen.src.startsWith("/catalogo/delacour/"));
    assert.ok(d.banner?.imagen.src.startsWith("/catalogo/delacour/"));
    assert.deepEqual(vitrinaDe("otro-negocio"), {});
  });
});
