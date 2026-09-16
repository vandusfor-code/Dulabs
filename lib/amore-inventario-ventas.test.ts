/**
 * AMORE (autorizado, módulo Inventario) — "Registrar venta de producto".
 * `validarCantidadVenta` es pura (sin Supabase). `registrarVentaProducto`
 * se prueba con integración REAL contra Supabase (tenant descartable,
 * randomUUID, nunca AMORE real) -- mismo criterio que
 * lib/contabilidad/reporte.test.ts: la garantía real que hay que probar
 * (atomicidad/concurrencia/idempotencia vía FOR UPDATE + ON CONFLICT en
 * Postgres) no se puede verificar con un mock de Supabase, solo contra la
 * base real.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validarCantidadVenta, registrarVentaProducto, listarVentasProductos } from "./amore-inventario-ventas";

describe("validarCantidadVenta (pura)", () => {
  it("TEST E (obligatorio) -- entero >= 1 es válido", () => {
    assert.equal(validarCantidadVenta(1), 1);
    assert.equal(validarCantidadVenta(5), 5);
    assert.equal(validarCantidadVenta("3"), 3);
  });

  it("TEST F (obligatorio) -- cantidad 0 rechazada", () => {
    assert.equal(validarCantidadVenta(0), null);
  });

  it("TEST G (obligatorio) -- cantidad negativa rechazada", () => {
    assert.equal(validarCantidadVenta(-1), null);
    assert.equal(validarCantidadVenta(-5), null);
  });

  it("cantidad no entera (decimal) rechazada", () => {
    assert.equal(validarCantidadVenta(1.5), null);
  });

  it("cantidad no numérica/vacía/null/undefined rechazada", () => {
    for (const valor of ["", "abc", null, undefined, "1abc"]) {
      assert.equal(validarCantidadVenta(valor), null, `${JSON.stringify(valor)} nunca debe resolver`);
    }
  });
});

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "registrarVentaProducto -- integración real (atomicidad, concurrencia, idempotencia)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const productoIds: string[] = [];
    const TENANT = randomUUID();

    before(() => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (productoIds.length) {
        await supabase.from("dulabs_inventario_ventas").delete().in("producto_id", productoIds);
        await supabase.from("dulabs_inventario_productos").delete().in("id", productoIds);
      }
    });

    async function crearProducto(params: { nombre: string; precio: number; stock: number; activo?: boolean }): Promise<string> {
      const { data, error } = await supabase
        .from("dulabs_inventario_productos")
        .insert({ id_tenant: TENANT, nombre: params.nombre, precio: params.precio, stock: params.stock, activo: params.activo ?? true })
        .select("id")
        .single();
      if (error) throw error;
      productoIds.push(data!.id as string);
      return data!.id as string;
    }

    async function stockActual(productoId: string): Promise<number> {
      const { data, error } = await supabase.from("dulabs_inventario_productos").select("stock").eq("id", productoId).single();
      if (error) throw error;
      return data!.stock as number;
    }

    it("TEST E/J/K/L (obligatorios) -- cantidad válida registra la venta, obtiene el precio real del backend, calcula el total en backend, y descuenta el stock correctamente", async (t) => {
      if (!HAS_SUPABASE) return t.skip("requiere Supabase real");
      const productoId = await crearProducto({ nombre: "Shampoo Nutritivo", precio: 65000, stock: 20 });

      const resultado = await registrarVentaProducto(supabase, TENANT, { productoId, cantidad: 2, idempotencyKey: randomUUID() });

      assert.ok(resultado.ok);
      assert.equal(resultado.venta.precioUnitario, 65000, "el precio debe venir del producto real, nunca de un valor enviado por el cliente");
      assert.equal(resultado.venta.total, 130000, "el total debe calcularse en backend: precio_unitario * cantidad");
      assert.equal(resultado.venta.productoNombre, "Shampoo Nutritivo");
      assert.equal(resultado.stockRestante, 18, "20 - 2 = 18");
      assert.equal(await stockActual(productoId), 18);
    });

    it("TEST I (obligatorio) -- producto inexistente rechazado", async (t) => {
      if (!HAS_SUPABASE) return t.skip("requiere Supabase real");
      const resultado = await registrarVentaProducto(supabase, TENANT, { productoId: randomUUID(), cantidad: 1, idempotencyKey: randomUUID() });
      assert.deepEqual(resultado, { ok: false, motivo: "producto_no_encontrado" });
    });

    it("producto inactivo rechazado (sección 'producto debe estar activo' del pedido)", async (t) => {
      if (!HAS_SUPABASE) return t.skip("requiere Supabase real");
      const productoId = await crearProducto({ nombre: "Producto Inactivo", precio: 10000, stock: 50, activo: false });
      const resultado = await registrarVentaProducto(supabase, TENANT, { productoId, cantidad: 1, idempotencyKey: randomUUID() });
      assert.deepEqual(resultado, { ok: false, motivo: "producto_inactivo" });
      assert.equal(await stockActual(productoId), 50, "el stock nunca se toca si la venta se rechaza");
    });

    it("TEST H (obligatorio) -- cantidad superior al stock disponible rechazada, NUNCA descuenta parcialmente", async (t) => {
      if (!HAS_SUPABASE) return t.skip("requiere Supabase real");
      const productoId = await crearProducto({ nombre: "Crema Facial", precio: 40000, stock: 3 });
      const resultado = await registrarVentaProducto(supabase, TENANT, { productoId, cantidad: 10, idempotencyKey: randomUUID() });
      assert.deepEqual(resultado, { ok: false, motivo: "stock_insuficiente" });
      assert.equal(await stockActual(productoId), 3, "un intento rechazado nunca deja el stock a medias");
    });

    it("TEST S (obligatorio) -- stock en 0 impide nuevas ventas", async (t) => {
      if (!HAS_SUPABASE) return t.skip("requiere Supabase real");
      const productoId = await crearProducto({ nombre: "Producto Agotado", precio: 20000, stock: 0 });
      const resultado = await registrarVentaProducto(supabase, TENANT, { productoId, cantidad: 1, idempotencyKey: randomUUID() });
      assert.deepEqual(resultado, { ok: false, motivo: "stock_insuficiente" });
    });

    it("cantidad inválida (0) rechazada en backend, nunca solo confiando en la validación de frontend", async (t) => {
      if (!HAS_SUPABASE) return t.skip("requiere Supabase real");
      const productoId = await crearProducto({ nombre: "Producto Cantidad Cero", precio: 15000, stock: 10 });
      const resultado = await registrarVentaProducto(supabase, TENANT, { productoId, cantidad: 0, idempotencyKey: randomUUID() });
      assert.deepEqual(resultado, { ok: false, motivo: "cantidad_invalida" });
    });

    it("TEST P/R (obligatorios) -- doble envío con la MISMA idempotencyKey nunca genera un segundo movimiento ni descuenta el stock dos veces", async (t) => {
      if (!HAS_SUPABASE) return t.skip("requiere Supabase real");
      const productoId = await crearProducto({ nombre: "Acondicionador", precio: 50000, stock: 10 });
      const clave = randomUUID();

      const primera = await registrarVentaProducto(supabase, TENANT, { productoId, cantidad: 2, idempotencyKey: clave });
      const segunda = await registrarVentaProducto(supabase, TENANT, { productoId, cantidad: 2, idempotencyKey: clave });

      assert.ok(primera.ok && segunda.ok);
      assert.equal(primera.venta.id, segunda.venta.id, "el reintento debe devolver la MISMA venta, nunca crear una segunda");
      assert.equal(primera.yaExistia, false);
      assert.equal(segunda.yaExistia, true);
      assert.equal(await stockActual(productoId), 8, "10 - 2 = 8, NUNCA 10 - 2 - 2 = 6 (el stock no se descuenta dos veces)");

      const ventas = await listarVentasProductos(supabase, { idTenant: TENANT });
      const deEsteProducto = ventas.filter((v) => v.productoId === productoId);
      assert.equal(deEsteProducto.length, 1, "solo debe existir UNA fila de venta para esta idempotencyKey");
    });

    it("TEST Q (obligatorio) -- dos ventas CONCURRENTES del mismo producto nunca venden más stock del disponible", async (t) => {
      if (!HAS_SUPABASE) return t.skip("requiere Supabase real");
      const productoId = await crearProducto({ nombre: "Producto Concurrencia", precio: 30000, stock: 1 });

      // Dos solicitudes distintas (idempotency keys distintas -- simula dos
      // clientes/dispositivos reales, no un doble clic del mismo formulario)
      // piden la ÚNICA unidad disponible al mismo tiempo.
      const [a, b] = await Promise.all([
        registrarVentaProducto(supabase, TENANT, { productoId, cantidad: 1, idempotencyKey: randomUUID() }),
        registrarVentaProducto(supabase, TENANT, { productoId, cantidad: 1, idempotencyKey: randomUUID() }),
      ]);

      const resultados = [a, b];
      const exitosas = resultados.filter((r) => r.ok);
      const rechazadas = resultados.filter((r) => !r.ok);
      assert.equal(exitosas.length, 1, "exactamente UNA de las dos ventas concurrentes debe tener éxito");
      assert.equal(rechazadas.length, 1, "la otra debe rechazarse por falta de stock, nunca las dos tener éxito");
      assert.deepEqual(rechazadas[0], { ok: false, motivo: "stock_insuficiente" });
      assert.equal(await stockActual(productoId), 0, "el stock final nunca debe quedar negativo ni permitir sobreventa");
    });
  }
);
