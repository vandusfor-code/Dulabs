/**
 * Catálogo — formulario (puro), escalado de imagen del navegador y visibilidad
 * del módulo en el nav.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CatalogProduct } from "@/lib/catalogo/domain";
import { diffProductForm, emptyProductForm, productFormFrom, toProductDraft, validateProductForm } from "@/lib/catalogo/form";
import { fitWithin } from "@/lib/catalogo/image-processing";
import { esModuloId, MODULOS } from "@/lib/tenant-modulos";
import { navItemVisible, navSections } from "@/components/dashboard/shell/nav";

const PRODUCTO: CatalogProduct = {
  id: "p1",
  reference: "DL-000184",
  name: "Dije corazón",
  description: null,
  categoryId: "c1",
  categoryName: "Dijes",
  material: "Oro laminado",
  color: null,
  pricing: { retail: 35_000, wholesale: 18_000 },
  status: "ACTIVE",
  tracksStock: false,
  stock: 0,
  primaryImage: null,
  createdAt: "2026-09-22T00:00:00Z",
  updatedAt: "2026-09-22T00:00:00Z",
};

describe("formulario de producto", () => {
  it("exige nombre, precio detal y stock; el mayor es opcional", () => {
    assert.deepEqual(Object.keys(validateProductForm(emptyProductForm())).sort(), ["name", "retailPrice", "stock"]);
    assert.deepEqual(validateProductForm({ ...emptyProductForm(), name: "Dije", retailPrice: 35_000, stock: 4 }), {});
  });

  it("stock: 0 es válido (agotado); negativo, decimal o excesivo no", () => {
    const base = { ...emptyProductForm(), name: "Dije", retailPrice: 35_000 };
    assert.deepEqual(validateProductForm({ ...base, stock: 0 }), {});
    for (const stock of [-1, 1.5, 2_000_000]) assert.ok(validateProductForm({ ...base, stock }).stock, String(stock));
  });

  it("producto legado sin control de inventario: el stock es opcional hasta definirlo", () => {
    const legado = productFormFrom(PRODUCTO);
    assert.equal(legado.stock, null);
    assert.deepEqual(validateProductForm(legado, { requireStock: false }), {});
    assert.ok(validateProductForm(legado, { requireStock: true }).stock);
    assert.equal(productFormFrom({ ...PRODUCTO, tracksStock: true, stock: 7 }).stock, 7);
  });

  it("el borrador nunca lleva referencia y convierte vacíos en null", () => {
    const draft = toProductDraft({ ...emptyProductForm(), name: "  Dije  ", retailPrice: 35_000, stock: 3, material: "  ", color: " Dorado " });
    assert.deepEqual(draft, { name: "Dije", categoryId: null, description: null, material: null, color: "Dorado", retailPrice: 35_000, wholesalePrice: null, stock: 3 });
    assert.equal("reference" in draft, false);
  });

  it("el PATCH lleva solo lo que cambió (nada si no hubo cambios)", () => {
    const original = productFormFrom(PRODUCTO);
    assert.deepEqual(diffProductForm(original, original), {});
    assert.deepEqual(diffProductForm(original, { ...original, wholesalePrice: null, color: "Dorado" }), { wholesalePrice: null, color: "Dorado" });
    assert.deepEqual(diffProductForm(original, { ...original, material: "  Oro laminado  " }), {}, "espacios no cuentan como cambio");
  });

  it("el stock viaja solo si se definió y cambió (nunca la referencia)", () => {
    const legado = productFormFrom(PRODUCTO);
    assert.deepEqual(diffProductForm(legado, legado), {});
    assert.deepEqual(diffProductForm(legado, { ...legado, stock: 0 }), { stock: 0 });
    const conStock = productFormFrom({ ...PRODUCTO, tracksStock: true, stock: 5 });
    assert.deepEqual(diffProductForm(conStock, { ...conStock, stock: 2 }), { stock: 2 });
    assert.equal("reference" in diffProductForm(conStock, { ...conStock, stock: 2 }), false);
  });
});

describe("fitWithin — escalado de imagen en el navegador", () => {
  it("reduce al lado máximo conservando proporción y nunca agranda", () => {
    assert.deepEqual(fitWithin(4032, 3024, 2048), { width: 2048, height: 1536 });
    assert.deepEqual(fitWithin(3024, 4032, 400), { width: 300, height: 400 });
    assert.deepEqual(fitWithin(800, 600, 2048), { width: 800, height: 600 });
    assert.deepEqual(fitWithin(0, 100, 400), { width: 0, height: 0 });
  });
});

describe("módulo Catálogo en el nav", () => {
  const item = navSections.flatMap((s) => s.items).find((i) => i.href === "/dashboard/catalogo");

  it("existe como módulo registrado", () => {
    assert.ok(item);
    assert.equal(item.modulo, "catalogo");
    assert.ok(MODULOS.includes("catalogo"));
    assert.equal(esModuloId("catalogo"), true);
    assert.equal(esModuloId("inventario"), false);
  });

  it("solo es visible si el tenant tiene el módulo habilitado", () => {
    assert.ok(item);
    assert.equal(navItemVisible(item, "admin", []), false);
    assert.equal(navItemVisible(item, "admin", ["catalogo"]), true);
    assert.equal(navItemVisible(item, "lectura", ["catalogo"]), true);
  });

  it("los ítems existentes no cambian de visibilidad", () => {
    const equipo = navSections.flatMap((s) => s.items).find((i) => i.href === "/dashboard/equipo");
    assert.ok(equipo);
    assert.equal(navItemVisible(equipo, "admin", []), true);
    assert.equal(navItemVisible(equipo, "agente", []), false);
    const mensajes = navSections.flatMap((s) => s.items).find((i) => i.href === "/dashboard/mensajes");
    assert.ok(mensajes);
    assert.equal(navItemVisible(mensajes, "lectura", []), true);
  });
});
