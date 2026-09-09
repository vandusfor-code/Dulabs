/**
 * Módulo Inventario (autorizado) — pruebas del parser de Excel. Construye
 * workbooks de ExcelJS en memoria con EXACTAMENTE las columnas de la
 * plantilla oficial (Plantilla_Inventario_AMORE.xlsx, hoja "Productos"):
 * Nombre del producto | Descripción | Precio | Stock | Categoría |
 * Foto (opcional) | Activo.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseInventarioExcel, marcarDuplicados } from "@/lib/amore-inventario-excel";

const ENCABEZADOS_OFICIALES = ["Nombre del producto", "Descripción", "Precio", "Stock", "Categoría", "Foto (opcional)", "Activo"];

function libroConFilas(filas: unknown[][], encabezados: string[] = ENCABEZADOS_OFICIALES, nombreHoja = "Productos"): ExcelJS.Workbook {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet(nombreHoja);
  hoja.addRow(encabezados);
  for (const fila of filas) hoja.addRow(fila);
  return libro;
}

describe("parseInventarioExcel -- plantilla válida", () => {
  it("lee filas válidas con todas las columnas completas", () => {
    const libro = libroConFilas([
      ["Kit de Cuidado Capilar", "Kit para cuidado y mantenimiento del cabello.", 45000, 10, "Cabello", null, "SI"],
      ["Crema Hidratante", "Crema hidratante para uso diario.", 30000, 5, "Cuidado personal", null, "SI"],
    ]);
    const resultado = parseInventarioExcel(libro);
    assert.ok(resultado);
    assert.equal(resultado.totalFilas, 2);
    assert.equal(resultado.validos, 2);
    assert.equal(resultado.conErrores, 0);
    assert.equal(resultado.filas[0].nombre, "Kit de Cuidado Capilar");
    assert.equal(resultado.filas[0].precio, 45000);
    assert.equal(resultado.filas[0].stock, 10);
    assert.equal(resultado.filas[0].activo, true);
  });

  it("la foto es opcional -- una fila sin foto es igual de válida", () => {
    const libro = libroConFilas([["Producto sin foto", "", 10000, 1, "", null, "SI"]]);
    const resultado = parseInventarioExcel(libro);
    assert.equal(resultado?.validos, 1);
    assert.equal(resultado?.filas[0].foto, null);
  });

  it("ignora filas completamente vacías (comunes al final de la hoja) sin contarlas como error", () => {
    const libro = libroConFilas([
      ["Producto real", "", 10000, 1, "", null, "SI"],
      [null, null, null, null, null, null, null],
      ["", "", "", "", "", "", ""],
    ]);
    const resultado = parseInventarioExcel(libro);
    assert.equal(resultado?.totalFilas, 1);
  });
});

describe("parseInventarioExcel -- columnas faltantes", () => {
  it("devuelve null si falta la columna Precio", () => {
    const libro = libroConFilas([["Producto", "desc", 10]], ["Nombre del producto", "Descripción", "Stock"]);
    assert.equal(parseInventarioExcel(libro), null);
  });

  it("devuelve null si falta la columna Stock", () => {
    const libro = libroConFilas([["Producto", "desc", 10000]], ["Nombre del producto", "Descripción", "Precio"]);
    assert.equal(parseInventarioExcel(libro), null);
  });

  it("devuelve null si falta la columna Nombre del producto", () => {
    const libro = libroConFilas([["desc", 10000, 5]], ["Descripción", "Precio", "Stock"]);
    assert.equal(parseInventarioExcel(libro), null);
  });

  it("devuelve null si la hoja está completamente vacía", () => {
    const libro = new ExcelJS.Workbook();
    libro.addWorksheet("Productos");
    assert.equal(parseInventarioExcel(libro), null);
  });
});

describe("parseInventarioExcel -- filas inválidas", () => {
  it("Fila con precio negativo -- error específico", () => {
    const libro = libroConFilas([["Producto", "", -5000, 1, "", null, "SI"]]);
    const resultado = parseInventarioExcel(libro);
    assert.equal(resultado?.filas[0].estado, "error");
    assert.ok(resultado?.filas[0].errores.some((e) => e.includes("precio")));
  });

  it("Fila con precio no numérico -- error específico", () => {
    const libro = libroConFilas([["Producto", "", "gratis", 1, "", null, "SI"]]);
    const resultado = parseInventarioExcel(libro);
    assert.equal(resultado?.filas[0].estado, "error");
  });

  it("Fila con stock no entero -- error específico", () => {
    const libro = libroConFilas([["Producto", "", 10000, 2.5, "", null, "SI"]]);
    const resultado = parseInventarioExcel(libro);
    assert.equal(resultado?.filas[0].estado, "error");
    assert.ok(resultado?.filas[0].errores.some((e) => e.includes("stock")));
  });

  it("Fila con stock negativo -- error específico", () => {
    const libro = libroConFilas([["Producto", "", 10000, -1, "", null, "SI"]]);
    const resultado = parseInventarioExcel(libro);
    assert.equal(resultado?.filas[0].estado, "error");
  });

  it("Fila sin nombre -- error específico", () => {
    const libro = libroConFilas([["", "", 10000, 1, "", null, "SI"]]);
    const resultado = parseInventarioExcel(libro);
    assert.equal(resultado?.filas[0].estado, "error");
    assert.ok(resultado?.filas[0].errores.some((e) => e.toLowerCase().includes("nombre")));
  });

  it("filas parcialmente inválidas: solo las filas con error se marcan, las válidas siguen válidas", () => {
    const libro = libroConFilas([
      ["Producto válido", "", 10000, 1, "", null, "SI"],
      ["", "", 10000, 1, "", null, "SI"], // sin nombre
      ["Otro válido", "", 20000, 3, "", null, "SI"],
      ["Producto con precio malo", "", -1, 1, "", null, "SI"],
    ]);
    const resultado = parseInventarioExcel(libro);
    assert.equal(resultado?.totalFilas, 4);
    assert.equal(resultado?.validos, 2);
    assert.equal(resultado?.conErrores, 2);
  });

  it("'Activo' vacío o 'SI' -> true; 'NO' -> false (por defecto TRUE salvo indicación contraria)", () => {
    const libro = libroConFilas([
      ["Producto 1", "", 10000, 1, "", null, ""],
      ["Producto 2", "", 10000, 1, "", null, "SI"],
      ["Producto 3", "", 10000, 1, "", null, "NO"],
    ]);
    const resultado = parseInventarioExcel(libro);
    assert.equal(resultado?.filas[0].activo, true);
    assert.equal(resultado?.filas[1].activo, true);
    assert.equal(resultado?.filas[2].activo, false);
  });
});

describe("marcarDuplicados", () => {
  function crearFakeSupabaseNombres(nombresExistentes: string[]) {
    const from = () => ({
      select: () => ({
        eq: () => ({
          ilike: (_campo: string, valor: string) => ({
            maybeSingle: () =>
              Promise.resolve({
                data: nombresExistentes.some((n) => n.toLowerCase() === valor.toLowerCase()) ? { id: "existente-1" } : null,
                error: null,
              }),
          }),
        }),
      }),
    });
    return { from } as unknown as SupabaseClient;
  }

  it("marca como 'existente' las filas válidas cuyo nombre ya está en la base", async () => {
    const libro = libroConFilas([
      ["Producto Nuevo", "", 10000, 1, "", null, "SI"],
      ["Producto Repetido", "", 20000, 2, "", null, "SI"],
    ]);
    const resultado = parseInventarioExcel(libro);
    assert.ok(resultado);
    const supabase = crearFakeSupabaseNombres(["Producto Repetido"]);
    const final = await marcarDuplicados(supabase, "tenant-1", resultado);
    assert.equal(final.filas.find((f) => f.nombre === "Producto Nuevo")?.estado, "valido");
    assert.equal(final.filas.find((f) => f.nombre === "Producto Repetido")?.estado, "existente");
    assert.equal(final.existentes, 1);
    assert.equal(final.validos, 1);
  });

  it("nunca marca como existente una fila que ya tenía error (no se le hace ni siquiera la consulta)", async () => {
    const libro = libroConFilas([["", "", -1, 1, "", null, "SI"]]);
    const resultado = parseInventarioExcel(libro);
    assert.ok(resultado);
    const supabase = crearFakeSupabaseNombres(["cualquier cosa"]);
    const final = await marcarDuplicados(supabase, "tenant-1", resultado);
    assert.equal(final.filas[0].estado, "error");
  });
});
