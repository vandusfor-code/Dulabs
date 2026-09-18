/**
 * Agent Compiler (Fase 1) — Pilar 1, Step 3: persistencia idempotente.
 * Tests obligatorios: inserción válida, recompilación sin duplicar,
 * actualización de precio, aislamiento entre tenants, rechazo de ambiguo,
 * rechazo de precio inválido, error parcial/transacción. Sin Supabase: repo
 * en memoria (inyección de dependencias).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { persistCatalog } from "@/lib/agent-compiler/catalog-persister";
import {
  normalizeCatalogName,
  type CatalogRepository,
  type ExistingCatalogEntry,
  type PersistableCatalogItem,
} from "@/lib/agent-compiler/catalog-repository";
import type { CatalogExtractionResult, ExtractedCatalogItem } from "@/lib/agent-compiler/types";

// --- Repo en memoria, estrictamente tenant-scoped -------------------------
class FakeRepo implements CatalogRepository {
  private store = new Map<string, ExistingCatalogEntry[]>();
  private seq = 0;
  failOn: ((item: PersistableCatalogItem) => boolean) | null = null;

  private lista(tenantId: string): ExistingCatalogEntry[] {
    return this.store.get(tenantId) ?? [];
  }
  async listExisting(tenantId: string): Promise<ExistingCatalogEntry[]> {
    return this.lista(tenantId).map((e) => ({ ...e })); // copia: nadie muta el store por fuera
  }
  async insert(tenantId: string, item: PersistableCatalogItem): Promise<{ id: string }> {
    if (this.failOn?.(item)) throw new Error("insert forzado a fallar");
    const id = `id-${++this.seq}`;
    const list = this.lista(tenantId).slice();
    list.push({ id, type: item.type, name: item.name, priceCop: item.priceCop ?? null });
    this.store.set(tenantId, list);
    return { id };
  }
  async updatePrice(tenantId: string, ref: { id: string; type: "service" | "product" }, priceCop: number | null): Promise<void> {
    const list = this.lista(tenantId).map((e) => (e.id === ref.id ? { ...e, priceCop: priceCop ?? null } : e));
    this.store.set(tenantId, list);
  }
  snapshot(tenantId: string): ExistingCatalogEntry[] {
    return this.lista(tenantId);
  }
}

function servicio(name: string, priceCop: number, extra: Partial<ExtractedCatalogItem> = {}): ExtractedCatalogItem {
  return { name, type: "service", currency: "COP", priceCop, durationMin: 60, sourceEvidence: `${name}: $${priceCop}`, confidence: 0.95, ...extra };
}
function extraccion(items: ExtractedCatalogItem[], issues: CatalogExtractionResult["issues"] = []): CatalogExtractionResult {
  return { items, issues };
}

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("Agent Compiler — persistencia idempotente del catálogo", () => {
  it("inserción válida", async () => {
    const repo = new FakeRepo();
    const r = await persistCatalog(repo, A, extraccion([servicio("Manicure", 40000)]));
    assert.equal(r.inserted, 1);
    assert.equal(r.rejected, 0);
    assert.equal(repo.snapshot(A).length, 1);
    assert.equal(repo.snapshot(A)[0]!.priceCop, 40000);
  });

  it("recompilar el mismo elemento NO duplica (idempotente)", async () => {
    const repo = new FakeRepo();
    await persistCatalog(repo, A, extraccion([servicio("Manicure", 40000)]));
    const r2 = await persistCatalog(repo, A, extraccion([servicio("Manicure", 40000)]));
    assert.equal(r2.inserted, 0);
    assert.equal(r2.unchanged, 1);
    assert.equal(repo.snapshot(A).length, 1, "sigue habiendo un solo registro");
  });

  it("actualización de precio (mismo ítem, precio distinto)", async () => {
    const repo = new FakeRepo();
    await persistCatalog(repo, A, extraccion([servicio("Manicure", 40000)]));
    const r2 = await persistCatalog(repo, A, extraccion([servicio("Manicure", 55000)]));
    assert.equal(r2.updated, 1);
    assert.equal(r2.inserted, 0);
    assert.equal(repo.snapshot(A).length, 1);
    assert.equal(repo.snapshot(A)[0]!.priceCop, 55000);
  });

  it("aislamiento entre tenants: B no ve ni afecta datos de A", async () => {
    const repo = new FakeRepo();
    await persistCatalog(repo, A, extraccion([servicio("Manicure", 40000)]));
    // Antes de escribir, B no tiene nada.
    assert.equal((await repo.listExisting(B)).length, 0);
    // B inserta un ítem con el MISMO nombre => registro separado, no toca A.
    const rb = await persistCatalog(repo, B, extraccion([servicio("Manicure", 99000)]));
    assert.equal(rb.inserted, 1);
    assert.equal(repo.snapshot(A).length, 1);
    assert.equal(repo.snapshot(A)[0]!.priceCop, 40000, "el precio de A no cambió");
    assert.equal(repo.snapshot(B)[0]!.priceCop, 99000);
  });

  it("rechazo de elemento ambiguo (bloqueado por la extracción)", async () => {
    const repo = new FakeRepo();
    const amb = extraccion(
      [servicio("Paquete 1", 350000)],
      [{ code: "AMBIGUOUS_CATALOG_ITEM", severity: "block", message: "ambiguo", subject: normalizeCatalogName("Paquete 1") }],
    );
    const r = await persistCatalog(repo, A, amb);
    assert.equal(r.rejected, 1);
    assert.equal(r.inserted, 0);
    assert.equal(repo.snapshot(A).length, 0, "no se persiste un ambiguo");
  });

  it("rechazo de precio inválido (negativo / no entero)", async () => {
    const repo = new FakeRepo();
    const r = await persistCatalog(repo, A, extraccion([servicio("Corte", -5), servicio("Peinado", 1234.5)]));
    assert.equal(r.rejected, 2);
    assert.equal(r.inserted, 0);
    assert.equal(repo.snapshot(A).length, 0);
  });

  it("conflicto de identidad: mismo nombre, otro tipo => rechazo", async () => {
    const repo = new FakeRepo();
    await persistCatalog(repo, A, extraccion([{ name: "Kit", type: "product", currency: "COP", priceCop: 20000, stock: 10, sourceEvidence: "Kit: $20.000", confidence: 0.95 }]));
    const r = await persistCatalog(repo, A, extraccion([servicio("Kit", 30000)])); // ahora como service
    assert.equal(r.rejected, 1);
    assert.equal(repo.snapshot(A).length, 1, "no se crea un segundo 'Kit' de otro tipo");
  });

  it("error parcial: un fallo no aborta el resto y re-ejecutar converge sin duplicar", async () => {
    const repo = new FakeRepo();
    repo.failOn = (item) => item.name === "Falla";
    const r1 = await persistCatalog(repo, A, extraccion([servicio("Ok", 10000), servicio("Falla", 20000)]));
    assert.equal(r1.inserted, 1);
    assert.equal(r1.failed, 1);
    assert.equal(repo.snapshot(A).length, 1);
    // Se corrige la causa del fallo y se re-ejecuta el MISMO batch.
    repo.failOn = null;
    const r2 = await persistCatalog(repo, A, extraccion([servicio("Ok", 10000), servicio("Falla", 20000)]));
    assert.equal(r2.unchanged, 1, "'Ok' ya existía, no se duplica");
    assert.equal(r2.inserted, 1, "'Falla' se inserta ahora");
    assert.equal(repo.snapshot(A).length, 2);
  });
});
