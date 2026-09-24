/**
 * Bloque 20 — resolve_product_by_attributes por ÍNDICE (dulabs_catalogo_por_nombre): no lee el
 * catálogo entero. Misma regla y mismo resultado que antes; sin la migración, el camino anterior.
 * Rendimiento medido en scripts/perf (datos sintéticos); aquí, la regla. Nada toca Supabase.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createResolucionCatalogo } from "@/lib/catalogo/resolucion";
import type { CatalogRepository } from "@/lib/catalogo/repository";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "b" };

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let llamadas: { keys: number; exact: number };
let resolucion: ReturnType<typeof createResolucionCatalogo>;

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  llamadas = { keys: 0, exact: 0 };
  const espiado: CatalogRepository = {
    ...mem.repo,
    listProductKeys: (t) => (llamadas.keys++, mem.repo.listProductKeys(t)),
    findByExactName: (t, n, l) => (llamadas.exact++, mem.repo.findByExactName(t, n, l)),
  };
  resolucion = createResolucionCatalogo({ repo: espiado });
  const aretes = await admin.createCategory(A, { name: "Aretes" });
  await admin.createProduct(A, { name: "Anillo Corazón", retailPrice: 1000, stock: 2, color: "Dorado", material: "Oro 18k" });
  await admin.createProduct(A, { name: "Anillo Corazón", retailPrice: 1000, stock: 2, color: "Plateado", material: "Plata 925" });
  await admin.createProduct(A, { name: "Luna", retailPrice: 1000, stock: 2, categoryId: aretes.id });
  await admin.createProduct(A, { name: "Anillo Corazones", retailPrice: 1000, stock: 2 });
  for (let i = 0; i < 40; i++) await admin.createProduct(A, { name: `Relleno ${i}`, retailPrice: 1000, stock: 1 });
  await admin.createProduct(B, { name: "Luna", retailPrice: 1000, stock: 2 });
});

describe("resolve_product_by_attributes por índice", () => {
  it("usa el índice por nombre y NO lee todo el catálogo; misma regla exacta", async () => {
    const amb = await resolucion.resolveByExactAttributes(A.tenantId, { name: "anillo   CORAZON" });
    assert.equal(amb.status, "ambiguous");
    assert.equal(llamadas.exact, 1);
    assert.equal(llamadas.keys, 0, "sin lectura completa");
    assert.deepEqual((amb as { candidates: Array<{ name: string }> }).candidates.map((c) => c.name), ["Anillo Corazón", "Anillo Corazón"], "no incluye 'Anillo Corazones'");

    const uno = await resolucion.resolveByExactAttributes(A.tenantId, { name: "Anillo Corazón", color: "plateado" });
    assert.equal(uno.status, "found");
    assert.equal((uno as { product: { material: string } }).product.material, "Plata 925");

    const cat = await resolucion.resolveByExactAttributes(A.tenantId, { name: "luna", category: "aretes" });
    assert.equal(cat.status, "found");
    assert.equal((await resolucion.resolveByExactAttributes(A.tenantId, { name: "luna", category: "anillos" })).status, "not_found");
  });

  it("aislado por negocio", async () => {
    const r = await resolucion.resolveByExactAttributes(B.tenantId, { name: "Luna" });
    assert.equal(r.status, "found");
    assert.equal((await resolucion.resolveByExactAttributes(B.tenantId, { name: "Anillo Corazón" })).status, "not_found");
  });

  it("sin la migración: el camino anterior, con el MISMO resultado", async () => {
    const conIndice = await resolucion.resolveByExactAttributes(A.tenantId, { name: "Anillo Corazón", color: "Dorado" });
    mem.setSearchEnabled(false);
    const sinIndice = await resolucion.resolveByExactAttributes(A.tenantId, { name: "Anillo Corazón", color: "Dorado" });
    assert.equal(llamadas.keys, 1, "lectura completa solo sin la migración");
    assert.deepEqual(sinIndice, conIndice);
  });
});
