/**
 * Catálogo — COMPATIBILIDAD con los consumidores existentes de
 * dulabs_inventario_productos (AMORE, Business Agent, cotización del agente).
 *
 * Prueba específicamente `controla_stock`:
 *   - productos existentes (true / columna ausente): comportamiento de stock
 *     IDÉNTICO al de hoy (agotado, stock insuficiente);
 *   - productos del Catálogo (false): nunca quedan bloqueados por stock = 0;
 *   - despliegue ANTES de la migración (columna inexistente, 42703): la
 *     cotización sigue funcionando con la consulta histórica.
 * Y que AMORE y el Business Agent no envían columnas nuevas (la BD aplica
 * defaults: controla_stock = true, referencia por trigger).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildQuote, type QuoteCatalogItem } from "@/lib/business-agent-quote";
import { createSupabaseCatalogStore, formatearProductosTexto, mapearProductosCotizables } from "@/lib/business-agent-catalog-store";
import { crearProducto, actualizarProducto, mapearProductosParaTienda, type ProductoInventario } from "@/lib/amore-inventario";
import { createProduct as crearProductoBusinessAgent } from "@/lib/business-agent-products-store";

type Llamada = { tabla: string; op: string; args: unknown[] };

/** Supabase falso y encadenable que registra cada llamada y responde según `responder`. */
function fakeSupabase(responder: (llamadas: Llamada[]) => { data: unknown; error: unknown; count?: number }) {
  const llamadas: Llamada[] = [];
  const client = {
    from(tabla: string) {
      const propias: Llamada[] = [];
      const builder: Record<string, unknown> = {};
      const registrar = (op: string) => (...args: unknown[]) => {
        const l = { tabla, op, args };
        llamadas.push(l);
        propias.push(l);
        return builder;
      };
      for (const op of ["select", "eq", "order", "insert", "update", "in", "is", "range", "or", "limit", "ilike"]) builder[op] = registrar(op);
      const resolver = () => Promise.resolve(responder(propias));
      builder.single = () => resolver();
      builder.maybeSingle = () => resolver();
      builder.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => resolver().then(ok, fail);
      return builder;
    },
  };
  return { supabase: client as unknown as SupabaseClient, llamadas };
}

describe("controla_stock en la cotización", () => {
  const filas = [
    { id: "amore-1", nombre: "Esmalte azul", precio: 12_500, stock: 0, controla_stock: true },
    { id: "cat-1", nombre: "Dije corazón", precio: 35_000, stock: 0, controla_stock: false },
    { id: "legacy-1", nombre: "Lima", precio: 3_000, stock: 0 },
  ];
  const catalogo = mapearProductosCotizables(filas);

  it("un producto del Catálogo (controla_stock=false) nunca queda bloqueado por stock = 0", () => {
    const item = catalogo.find((p) => p.id === "cat-1")!;
    assert.equal("stock" in item, false);
    const quote = buildQuote(catalogo, [{ nombre: "Dije corazón", cantidad: 3 }]);
    assert.equal(quote.hayStockInsuficiente, false);
    assert.equal(quote.total, 105_000);
    assert.equal(quote.lineas[0].stockSuficiente, undefined);
  });

  it("productos existentes (controla_stock=true o sin la columna) conservan el comportamiento de hoy", () => {
    assert.equal(catalogo.find((p) => p.id === "amore-1")?.stock, 0);
    assert.equal(catalogo.find((p) => p.id === "legacy-1")?.stock, 0);
    const quote = buildQuote(catalogo, [{ nombre: "Esmalte azul", cantidad: 1 }]);
    assert.equal(quote.hayStockInsuficiente, true);
    assert.equal(buildQuote(catalogo, [{ nombre: "Lima", cantidad: 1 }]).hayStockInsuficiente, true);
  });

  it("'(agotado)' solo aparece para productos que SÍ controlan stock", () => {
    const texto = formatearProductosTexto(catalogo);
    assert.match(texto, /Esmalte azul — \$12\.500 \(agotado\)/);
    assert.match(texto, /Lima — \$3\.000 \(agotado\)/);
    assert.match(texto, /Dije corazón — \$35\.000$/m);
  });

  it("sin controla_stock en absoluto, el resultado es idéntico al mapeo histórico", () => {
    const historico: QuoteCatalogItem[] = [{ tipo: "producto", id: "x", nombre: "X", precio: 1000, stock: 4 }];
    assert.deepEqual(mapearProductosCotizables([{ id: "x", nombre: "X", precio: 1000, stock: 4 }]), historico);
  });
});

describe("despliegue tolerante: la migración aún no se aplicó", () => {
  it("si controla_stock no existe (42703), reintenta con la consulta histórica", async () => {
    const { supabase, llamadas } = fakeSupabase((propias) => {
      const columnas = String(propias.find((l) => l.op === "select")?.args[0]);
      if (columnas.includes("controla_stock")) return { data: null, error: { code: "42703", message: "column does not exist" } };
      return { data: [{ id: "p1", nombre: "Esmalte rojo", precio: 12_000, stock: 5 }], error: null };
    });
    const productos = await createSupabaseCatalogStore(supabase).listarProductos("tenant-amore");
    assert.deepEqual(productos, [{ tipo: "producto", id: "p1", nombre: "Esmalte rojo", precio: 12_000, stock: 5 }]);
    const selects = llamadas.filter((l) => l.op === "select").map((l) => l.args[0]);
    assert.deepEqual(selects, ["id, nombre, precio, stock, controla_stock", "id, nombre, precio, stock"]);
    assert.ok(llamadas.filter((l) => l.op === "eq").every((l) => l.args[0] !== "id_tenant" || l.args[1] === "tenant-amore"));
  });

  it("cualquier OTRO error se propaga (no se oculta)", async () => {
    const { supabase } = fakeSupabase(() => ({ data: null, error: { code: "57014", message: "timeout" } }));
    await assert.rejects(createSupabaseCatalogStore(supabase).listarProductos("t"));
  });
});

describe("AMORE y Business Agent no envían columnas del Catálogo (la BD aplica los defaults)", () => {
  const COLUMNAS_CATALOGO = ["referencia", "controla_stock", "precio_mayor", "material", "color", "categoria_id", "created_by", "updated_by", "escritura_id"];
  const filaAmore = {
    id: "p1",
    id_tenant: "t",
    nombre: "Esmalte",
    descripcion: null,
    precio: 12_000,
    stock: 3,
    categoria: null,
    foto_url: null,
    activo: true,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };

  it("crearProducto (AMORE) inserta exactamente las columnas de siempre", async () => {
    const { supabase, llamadas } = fakeSupabase(() => ({ data: filaAmore, error: null }));
    await crearProducto(supabase, "t", { nombre: "Esmalte", descripcion: null, precio: 12_000, stock: 3, categoria: null, activo: true });
    const insert = llamadas.find((l) => l.op === "insert")?.args[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(insert).sort(), ["activo", "categoria", "descripcion", "id_tenant", "nombre", "precio", "stock"]);
    for (const c of COLUMNAS_CATALOGO) assert.equal(c in insert, false, c);
  });

  it("actualizarProducto (AMORE) no renueva escritura_id => la auditoría no le atribuye un usuario del Catálogo", async () => {
    const { supabase, llamadas } = fakeSupabase(() => ({ data: filaAmore, error: null }));
    await actualizarProducto(supabase, "t", "p1", { stock: 2 });
    const update = llamadas.find((l) => l.op === "update")?.args[0] as Record<string, unknown>;
    assert.equal("escritura_id" in update, false);
    assert.equal("updated_by" in update, false);
  });

  it("createProduct (Business Agent) inserta las mismas columnas de siempre", async () => {
    const { supabase, llamadas } = fakeSupabase((propias) => (propias.some((l) => l.op === "insert") ? { data: { id: "p1", nombre: "X", categoria: null, descripcion: null, precio: 1, stock: 0, activo: true }, error: null } : { data: null, error: null, count: 0 }));
    await crearProductoBusinessAgent(supabase, "t", { nombre: "X", categoria: null, descripcion: null, precio: 1, stock: 0, activo: true });
    const insert = llamadas.find((l) => l.op === "insert")?.args[0] as Record<string, unknown>;
    for (const c of COLUMNAS_CATALOGO) assert.equal(c in insert, false, c);
  });

  it("la tienda de AMORE sigue marcando agotado por stock = 0 (sin cambios)", () => {
    const producto: ProductoInventario = { id: "p", idTenant: "t", nombre: "Esmalte", descripcion: null, precio: 1, stock: 0, categoria: null, fotoUrl: null, activo: true, createdAt: "", updatedAt: "" };
    assert.equal(mapearProductosParaTienda([producto])[0].agotado, true);
  });
});
