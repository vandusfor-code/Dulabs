/**
 * R6 — persistencia de productos: AISLAMIENTO POR TENANT. Un fake de Supabase con dos tenants
 * verifica que cada operación filtra por id_tenant (un admin de A jamás lee, edita ni borra el
 * producto de B) y que el tope por tenant se respeta.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countActiveProducts, createProduct, deleteProduct, listProducts, MAX_PRODUCTS_PER_TENANT, updateProduct } from "@/lib/business-agent-products-store";
import type { NormalizedProductInput } from "@/lib/business-agent-products";

type Fila = Record<string, unknown>;

function fakeSupabase(tabla: Fila[]): SupabaseClient {
  let seq = 0;
  const from = (name: string) => {
    if (name !== "dulabs_inventario_productos") throw new Error(`tabla inesperada: ${name}`);
    const filtros: Array<(f: Fila) => boolean> = [];
    let modo: "select" | "insert" | "update" | "delete" = "select";
    let payload: Fila = {};
    let head = false;
    const ejecutar = (): { data: Fila[]; error: null; count?: number } => {
      if (modo === "insert") {
        const fila = { id: `p-${++seq}`, ...payload };
        tabla.push(fila);
        return { data: [fila], error: null };
      }
      const objetivo = tabla.filter((f) => filtros.every((fn) => fn(f)));
      if (modo === "update") {
        for (const f of objetivo) Object.assign(f, payload);
        return { data: objetivo, error: null };
      }
      if (modo === "delete") {
        for (const f of objetivo) tabla.splice(tabla.indexOf(f), 1);
        return { data: [], error: null };
      }
      return { data: head ? [] : objetivo, error: null, count: objetivo.length };
    };
    const b: Record<string, unknown> = {
      select: (_c?: string, opts?: { head?: boolean }) => ((head = !!opts?.head), b),
      insert: (f: Fila) => ((modo = "insert"), (payload = f), b),
      update: (f: Fila) => ((modo = "update"), (payload = f), b),
      delete: () => ((modo = "delete"), b),
      eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), b),
      order: () => b,
      single: async () => ({ data: ejecutar().data[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: ejecutar().data[0] ?? null, error: null }),
      then: (resolve: (r: unknown) => unknown) => resolve(ejecutar()),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const PROD: NormalizedProductInput = { nombre: "Esmalte", categoria: null, descripcion: null, precio: 12000, stock: 3, activo: true };

describe("productos del Business Agent — aislamiento por tenant", () => {
  it("1. cada tenant lista SOLO lo suyo (y la proyección no expone id_tenant)", async () => {
    const tabla: Fila[] = [];
    const sb = fakeSupabase(tabla);
    await createProduct(sb, A, { ...PROD, nombre: "De A" });
    await createProduct(sb, B, { ...PROD, nombre: "De B" });
    const deA = await listProducts(sb, A);
    assert.deepEqual(deA.map((p) => p.nombre), ["De A"]);
    assert.equal("id_tenant" in (deA[0] as object), false);
    assert.deepEqual((await listProducts(sb, B)).map((p) => p.nombre), ["De B"]);
  });

  it("2. crear siempre escribe el tenant de la SESIÓN (aunque el input traiga otro id_tenant)", async () => {
    const tabla: Fila[] = [];
    const sb = fakeSupabase(tabla);
    const hostil = { ...PROD, id_tenant: B, tenantId: B } as unknown as NormalizedProductInput;
    await createProduct(sb, A, hostil);
    assert.equal(tabla[0]!.id_tenant, A);
  });

  it("3. un admin de A NO puede editar el producto de B (404: null) ni borrarlo", async () => {
    const tabla: Fila[] = [];
    const sb = fakeSupabase(tabla);
    const r = await createProduct(sb, B, { ...PROD, nombre: "Solo de B" });
    assert.ok(r.ok);
    const idB = r.ok ? r.product.id : "";
    assert.equal(await updateProduct(sb, A, idB, { ...PROD, nombre: "Hackeado", precio: 1 }), null);
    await deleteProduct(sb, A, idB);
    assert.equal(tabla.length, 1, "el producto de B sigue existiendo");
    assert.equal(tabla[0]!.nombre, "Solo de B");
    assert.equal(tabla[0]!.precio, 12000);
    // El dueño sí puede.
    const ok = await updateProduct(sb, B, idB, { ...PROD, nombre: "Editado", precio: 9999 });
    assert.equal(ok?.nombre, "Editado");
    await deleteProduct(sb, B, idB);
    assert.equal(tabla.length, 0);
  });

  it("4. tope por tenant: no se crean más de MAX_PRODUCTS_PER_TENANT", async () => {
    const tabla: Fila[] = Array.from({ length: MAX_PRODUCTS_PER_TENANT }, (_, i) => ({ id: `x${i}`, id_tenant: A, activo: true }));
    const sb = fakeSupabase(tabla);
    const r = await createProduct(sb, A, PROD);
    assert.deepEqual(r, { ok: false, code: "LIMIT_REACHED" });
    // Otro tenant no se ve afectado por el tope de A.
    assert.equal((await createProduct(sb, B, PROD)).ok, true);
  });

  it("5. countActiveProducts cuenta solo activos DEL tenant (gate de publicación)", async () => {
    const tabla: Fila[] = [
      { id: "1", id_tenant: A, activo: true },
      { id: "2", id_tenant: A, activo: false },
      { id: "3", id_tenant: B, activo: true },
    ];
    const sb = fakeSupabase(tabla);
    assert.equal(await countActiveProducts(sb, A), 1);
    assert.equal(await countActiveProducts(sb, B), 1);
    assert.equal(await countActiveProducts(sb, "33333333-3333-4333-8333-333333333333"), 0);
  });
});
