/**
 * Módulo Inventario (autorizado) — pruebas de dominio: validación
 * (nombre/precio/stock) y CRUD contra un fake de Supabase en memoria (mismo
 * patrón que lib/comunicaciones/config.test.ts) -- ningún test toca
 * Supabase real ni el bucket real de Storage.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  validarNombreProducto,
  validarPrecioProducto,
  validarStockProducto,
  listarProductos,
  listarProductosActivos,
  obtenerProducto,
  buscarProductoPorNombre,
  crearProducto,
  actualizarProducto,
  ajustarStockProducto,
  extensionFotoPermitida,
  mapearProductosParaTienda,
  type ProductoInventario,
} from "@/lib/amore-inventario";

type FilaDb = {
  id: string;
  id_tenant: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  stock: number;
  categoria: string | null;
  foto_url: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

function coincide(fila: FilaDb, filtros: [string, unknown][]): boolean {
  return filtros.every(([campo, valor]) => (fila as unknown as Record<string, unknown>)[campo] === valor);
}

function crearFakeSupabaseInventario(seed: FilaDb[] = []) {
  const filas: FilaDb[] = [...seed];

  function from(tabla: string) {
    if (tabla !== "dulabs_inventario_productos") throw new Error(`fake de prueba: tabla inesperada "${tabla}"`);

    const filtros: [string, unknown][] = [];
    let ilikeFiltro: [string, string] | null = null;
    let ordenCampo: string | null = null;

    function filtradas(): FilaDb[] {
      let resultado = filas.filter((f) => coincide(f, filtros));
      if (ilikeFiltro) {
        const [campo, valor] = ilikeFiltro;
        resultado = resultado.filter((f) => String((f as unknown as Record<string, unknown>)[campo]).toLowerCase() === valor.toLowerCase());
      }
      if (ordenCampo) {
        const campo = ordenCampo;
        resultado = [...resultado].sort((a, b) =>
          String((a as unknown as Record<string, unknown>)[campo]).localeCompare(String((b as unknown as Record<string, unknown>)[campo])),
        );
      }
      return resultado;
    }

    const builder = {
      select() {
        return builder;
      },
      eq(campo: string, valor: unknown) {
        filtros.push([campo, valor]);
        return builder;
      },
      ilike(campo: string, valor: string) {
        ilikeFiltro = [campo, valor];
        return builder;
      },
      order(campo: string) {
        ordenCampo = campo;
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data: filtradas()[0] ?? null, error: null });
      },
      then(resolve: (r: { data: FilaDb[]; error: null }) => unknown) {
        return resolve({ data: filtradas(), error: null });
      },
      insert(payload: Record<string, unknown>) {
        const nueva: FilaDb = {
          id: randomUUID(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...payload,
        } as FilaDb;
        filas.push(nueva);
        return {
          select() {
            return { single: () => Promise.resolve({ data: nueva, error: null }) };
          },
        };
      },
      update(payload: Record<string, unknown>) {
        const filtrosUpdate: [string, unknown][] = [];
        const updater = {
          eq(campo: string, valor: unknown) {
            filtrosUpdate.push([campo, valor]);
            return updater;
          },
          then(resolve: (r: { error: null }) => unknown) {
            for (const f of filas) {
              if (coincide(f, filtrosUpdate)) Object.assign(f, payload);
            }
            return resolve({ error: null });
          },
        };
        return updater;
      },
    };
    return builder;
  }

  return { from, filas } as unknown as SupabaseClient & { filas: FilaDb[] };
}

function filaBase(overrides: Partial<FilaDb> = {}): FilaDb {
  return {
    id: randomUUID(),
    id_tenant: "tenant-1",
    nombre: "Kit de Cuidado Capilar",
    descripcion: "Kit para cuidado y mantenimiento del cabello.",
    precio: 45000,
    stock: 10,
    categoria: "Cabello",
    foto_url: null,
    activo: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// --- Validación -------------------------------------------------------

describe("validarNombreProducto", () => {
  it("acepta un nombre con texto real y lo recorta", () => {
    assert.equal(validarNombreProducto("  Crema Hidratante  "), "Crema Hidratante");
  });
  it("rechaza vacío/solo espacios", () => {
    assert.equal(validarNombreProducto(""), null);
    assert.equal(validarNombreProducto("   "), null);
  });
  it("rechaza null/undefined/no-string", () => {
    assert.equal(validarNombreProducto(null), null);
    assert.equal(validarNombreProducto(undefined), null);
    assert.equal(validarNombreProducto(123), null);
  });
});

describe("validarPrecioProducto", () => {
  it("acepta un entero >= 0", () => {
    assert.equal(validarPrecioProducto(45000), 45000);
    assert.equal(validarPrecioProducto(0), 0);
  });
  it("acepta string numérica entera", () => {
    assert.equal(validarPrecioProducto("30000"), 30000);
  });
  it("rechaza negativos", () => {
    assert.equal(validarPrecioProducto(-1), null);
  });
  it("rechaza decimales (el negocio no maneja centavos)", () => {
    assert.equal(validarPrecioProducto(45000.5), null);
  });
  it("rechaza no-numérico/vacío", () => {
    assert.equal(validarPrecioProducto("abc"), null);
    assert.equal(validarPrecioProducto(""), null);
    assert.equal(validarPrecioProducto(null), null);
    assert.equal(validarPrecioProducto(undefined), null);
  });
});

describe("validarStockProducto", () => {
  it("acepta un entero >= 0", () => {
    assert.equal(validarStockProducto(10), 10);
    assert.equal(validarStockProducto(0), 0);
  });
  it("rechaza negativos", () => {
    assert.equal(validarStockProducto(-5), null);
  });
  it("rechaza decimales", () => {
    assert.equal(validarStockProducto(2.5), null);
  });
  it("rechaza no-numérico", () => {
    assert.equal(validarStockProducto("diez"), null);
  });
});

describe("extensionFotoPermitida", () => {
  it("acepta jpg/png/webp", () => {
    assert.equal(extensionFotoPermitida("image/jpeg"), "jpg");
    assert.equal(extensionFotoPermitida("image/png"), "png");
    assert.equal(extensionFotoPermitida("image/webp"), "webp");
  });
  it("rechaza cualquier otro tipo (nunca ejecutables)", () => {
    assert.equal(extensionFotoPermitida("application/x-msdownload"), null);
    assert.equal(extensionFotoPermitida("text/html"), null);
    assert.equal(extensionFotoPermitida("application/pdf"), null);
  });
});

// --- CRUD ---------------------------------------------------------------

describe("crearProducto / listarProductos / obtenerProducto", () => {
  it("crea un producto y lo puede listar y obtener por id", async () => {
    const supabase = crearFakeSupabaseInventario();
    const creado = await crearProducto(supabase, "tenant-1", {
      nombre: "Aretes de plata",
      descripcion: null,
      precio: 25000,
      stock: 3,
      categoria: null,
      activo: true,
    });
    assert.equal(creado.nombre, "Aretes de plata");
    assert.equal(creado.idTenant, "tenant-1");

    const lista = await listarProductos(supabase, "tenant-1");
    assert.equal(lista.length, 1);

    const obtenido = await obtenerProducto(supabase, "tenant-1", creado.id);
    assert.equal(obtenido?.id, creado.id);
  });

  it("listarProductos/obtenerProducto NUNCA devuelven productos de otro tenant", async () => {
    const supabase = crearFakeSupabaseInventario([filaBase({ id_tenant: "otro-tenant" })]);
    const lista = await listarProductos(supabase, "tenant-1");
    assert.equal(lista.length, 0);

    const otraFila = filaBase({ id_tenant: "otro-tenant" });
    const supabase2 = crearFakeSupabaseInventario([otraFila]);
    const obtenido = await obtenerProducto(supabase2, "tenant-1", otraFila.id);
    assert.equal(obtenido, null);
  });

  it("listarProductosActivos solo devuelve activo=true", async () => {
    const supabase = crearFakeSupabaseInventario([
      filaBase({ nombre: "A", activo: true }),
      filaBase({ nombre: "B", activo: false }),
    ]);
    const activos = await listarProductosActivos(supabase, "tenant-1");
    assert.equal(activos.length, 1);
    assert.equal(activos[0].nombre, "A");
  });
});

describe("actualizarProducto", () => {
  it("edita todos los campos", async () => {
    const fila = filaBase();
    const supabase = crearFakeSupabaseInventario([fila]);
    const actualizado = await actualizarProducto(supabase, "tenant-1", fila.id, {
      nombre: "Nuevo nombre",
      descripcion: "Nueva descripción",
      precio: 50000,
      stock: 2,
      categoria: "Nueva categoría",
      activo: false,
    });
    assert.equal(actualizado?.nombre, "Nuevo nombre");
    assert.equal(actualizado?.precio, 50000);
    assert.equal(actualizado?.stock, 2);
    assert.equal(actualizado?.activo, false);
  });

  it("activar/desactivar (activo) funciona de forma aislada", async () => {
    const fila = filaBase({ activo: true });
    const supabase = crearFakeSupabaseInventario([fila]);
    const desactivado = await actualizarProducto(supabase, "tenant-1", fila.id, { activo: false });
    assert.equal(desactivado?.activo, false);
    const reactivado = await actualizarProducto(supabase, "tenant-1", fila.id, { activo: true });
    assert.equal(reactivado?.activo, true);
  });

  it("nunca edita un producto de otro tenant (el filtro id_tenant no encuentra fila que actualizar)", async () => {
    const fila = filaBase({ id_tenant: "otro-tenant" });
    const supabase = crearFakeSupabaseInventario([fila]);
    await actualizarProducto(supabase, "tenant-1", fila.id, { nombre: "hackeado" });
    // El update no debió aplicar -- el nombre real de la fila sigue igual.
    assert.equal(fila.nombre, "Kit de Cuidado Capilar");
  });
});

describe("ajustarStockProducto", () => {
  it("incrementa (+1/+5/+10)", async () => {
    const fila = filaBase({ stock: 8 });
    const supabase = crearFakeSupabaseInventario([fila]);
    assert.equal((await ajustarStockProducto(supabase, "tenant-1", fila.id, 1))?.stock, 9);
  });
  it("decrementa (-1/-5)", async () => {
    const fila = filaBase({ stock: 8 });
    const supabase = crearFakeSupabaseInventario([fila]);
    assert.equal((await ajustarStockProducto(supabase, "tenant-1", fila.id, -5))?.stock, 3);
  });
  it("nunca deja el stock en negativo -- se satura en 0", async () => {
    const fila = filaBase({ stock: 3 });
    const supabase = crearFakeSupabaseInventario([fila]);
    assert.equal((await ajustarStockProducto(supabase, "tenant-1", fila.id, -10))?.stock, 0);
  });
  it("producto inexistente devuelve null sin lanzar", async () => {
    const supabase = crearFakeSupabaseInventario([]);
    const resultado = await ajustarStockProducto(supabase, "tenant-1", randomUUID(), 1);
    assert.equal(resultado, null);
  });
});

describe("buscarProductoPorNombre (detección de duplicados)", () => {
  it("encuentra por coincidencia exacta de nombre (sin distinguir mayúsculas)", async () => {
    const fila = filaBase({ nombre: "Crema Hidratante" });
    const supabase = crearFakeSupabaseInventario([fila]);
    const encontrado = await buscarProductoPorNombre(supabase, "tenant-1", "crema hidratante");
    assert.equal(encontrado?.id, fila.id);
  });
  it("no encuentra nada si el nombre no coincide", async () => {
    const supabase = crearFakeSupabaseInventario([filaBase({ nombre: "Crema Hidratante" })]);
    const encontrado = await buscarProductoPorNombre(supabase, "tenant-1", "Otro producto");
    assert.equal(encontrado, null);
  });
  it("nunca encuentra un producto de otro tenant", async () => {
    const supabase = crearFakeSupabaseInventario([filaBase({ nombre: "Crema Hidratante", id_tenant: "otro-tenant" })]);
    const encontrado = await buscarProductoPorNombre(supabase, "tenant-1", "Crema Hidratante");
    assert.equal(encontrado, null);
  });
});

// --- Tienda pública -------------------------------------------------------

function productoInventario(overrides: Partial<ProductoInventario> = {}): ProductoInventario {
  return {
    id: randomUUID(),
    idTenant: "tenant-1",
    nombre: "Producto",
    descripcion: "Descripción",
    precio: 10000,
    stock: 5,
    categoria: "Categoría",
    fotoUrl: null,
    activo: true,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("mapearProductosParaTienda", () => {
  it("marca agotado=true cuando stock=0, agotado=false en caso contrario", () => {
    const [a, b] = mapearProductosParaTienda([productoInventario({ nombre: "Con stock", stock: 3 }), productoInventario({ nombre: "Sin stock", stock: 0 })]);
    assert.equal(a!.agotado, false);
    assert.equal(b!.agotado, true);
  });

  it("ordena disponibles primero", () => {
    const resultado = mapearProductosParaTienda([
      productoInventario({ nombre: "Agotado 1", stock: 0 }),
      productoInventario({ nombre: "Disponible 1", stock: 2 }),
      productoInventario({ nombre: "Agotado 2", stock: 0 }),
      productoInventario({ nombre: "Disponible 2", stock: 1 }),
    ]);
    assert.deepEqual(
      resultado.map((p) => p.agotado),
      [false, false, true, true],
    );
  });

  it("preserva foto_url cuando existe y null cuando no hay foto", () => {
    const [conFoto, sinFoto] = mapearProductosParaTienda([
      productoInventario({ nombre: "Con foto", fotoUrl: "https://ejemplo.com/foto.jpg" }),
      productoInventario({ nombre: "Sin foto", fotoUrl: null }),
    ]);
    assert.equal(conFoto!.fotoUrl, "https://ejemplo.com/foto.jpg");
    assert.equal(sinFoto!.fotoUrl, null);
  });

  it("NUNCA expone el stock numérico exacto ni el id_tenant (sección SEGURIDAD del pedido)", () => {
    const [publico] = mapearProductosParaTienda([productoInventario({ stock: 37 })]);
    assert.equal((publico as unknown as { stock?: number }).stock, undefined);
    assert.equal((publico as unknown as { idTenant?: string }).idTenant, undefined);
  });
});
