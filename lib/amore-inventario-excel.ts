/**
 * AMORE (autorizado, módulo Inventario) — parseo/validación de la carga
 * masiva de productos. Usa EXACTAMENTE las columnas de la plantilla oficial
 * ya existente en el proyecto (Plantilla_Inventario_AMORE.xlsx, hoja
 * "Productos"): Nombre del producto* | Descripción | Precio* | Stock* |
 * Categoría | Foto (opcional) | Activo. Mismo patrón de
 * lib/contactos-import.ts (buscarHoja + mapearColumnas + eachRow), pero con
 * preview fila-por-fila (esa función original es "todo o nada"; acá el
 * pedido exige mostrar cada fila con su estado antes de importar nada).
 */
import type ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { celdaATexto, buscarHoja, mapearColumnas, normalizarEncabezado } from "@/lib/archivo-texto";
import { validarNombreProducto, validarPrecioProducto, validarStockProducto, buscarProductoPorNombre } from "@/lib/amore-inventario";

export type EstadoFilaImportacion = "valido" | "error" | "existente";

export interface FilaImportacionProducto {
  fila: number; // número real de fila del Excel (para que el mensaje de error sea accionable)
  nombre: string | null;
  descripcion: string | null;
  precio: number | null;
  stock: number | null;
  categoria: string | null;
  foto: string | null;
  activo: boolean;
  errores: string[];
  estado: EstadoFilaImportacion;
}

export interface ResultadoImportacionExcel {
  filas: FilaImportacionProducto[];
  totalFilas: number;
  validos: number;
  conErrores: number;
  existentes: number;
}

/** true si la celda numérica viene vacía (null/undefined, o "" -- Excel puede guardar una celda "en blanco" como cadena vacía en vez de null). */
function celdaNumericaVacia(valor: ExcelJS.CellValue): boolean {
  return valor == null || valor === "";
}

/** true si la fila viene completamente vacía (Excel suele traer cientos de filas en blanco hasta el final de la hoja) -- se ignora sin contar ni como válida ni como error. */
function filaVacia(valores: { nombre: string; precio: ExcelJS.CellValue; stock: ExcelJS.CellValue; descripcion: string; categoria: string }): boolean {
  return !valores.nombre && celdaNumericaVacia(valores.precio) && celdaNumericaVacia(valores.stock) && !valores.descripcion && !valores.categoria;
}

/**
 * Parsea la hoja "Productos" (o la primera hoja, si no hay ninguna con ese
 * nombre) de la plantilla oficial. Devuelve `null` si el archivo no trae las
 * 3 columnas obligatorias (Nombre del producto / Precio / Stock) -- eso
 * significa que no es la plantilla oficial, no que todas las filas tengan
 * errores.
 */
export function parseInventarioExcel(libro: ExcelJS.Workbook): ResultadoImportacionExcel | null {
  const hoja = buscarHoja(libro, "producto") ?? libro.worksheets[0];
  if (!hoja) return null;

  const columnas = mapearColumnas(hoja);
  const colNombre = columnas.get("nombre del producto");
  const colPrecio = columnas.get("precio");
  const colStock = columnas.get("stock");
  if (!colNombre || !colPrecio || !colStock) return null; // no coincide con el formato oficial

  const colDescripcion = columnas.get("descripcion");
  const colCategoria = columnas.get("categoria");
  const colFoto = columnas.get("foto (opcional)");
  const colActivo = columnas.get("activo");

  const filas: FilaImportacionProducto[] = [];

  hoja.eachRow({ includeEmpty: false }, (fila, numeroFila) => {
    if (numeroFila === 1) return; // encabezado

    const nombreTexto = celdaATexto(fila.getCell(colNombre).value).trim();
    const precioCelda = fila.getCell(colPrecio).value;
    const stockCelda = fila.getCell(colStock).value;
    const descripcionTexto = colDescripcion ? celdaATexto(fila.getCell(colDescripcion).value).trim() : "";
    const categoriaTexto = colCategoria ? celdaATexto(fila.getCell(colCategoria).value).trim() : "";
    const fotoTexto = colFoto ? celdaATexto(fila.getCell(colFoto).value).trim() : "";
    const activoTexto = colActivo ? celdaATexto(fila.getCell(colActivo).value).trim() : "";

    if (filaVacia({ nombre: nombreTexto, precio: precioCelda, stock: stockCelda, descripcion: descripcionTexto, categoria: categoriaTexto })) {
      return;
    }

    const errores: string[] = [];
    const nombre = validarNombreProducto(nombreTexto);
    if (!nombre) errores.push("Falta el nombre del producto.");

    const precio = validarPrecioProducto(precioCelda);
    if (precio === null) errores.push("El precio debe ser un número entero mayor o igual a 0.");

    const stock = validarStockProducto(stockCelda);
    if (stock === null) errores.push("El stock debe ser un número entero mayor o igual a 0.");

    // "Activo": vacío o "SI" -> true (por defecto, sección ACTIVO del
    // pedido); "NO" -> false; cualquier otra cosa se trata como vacío
    // (permisivo -- nunca bloquea la fila por este campo opcional).
    const activoNormalizado = normalizarEncabezado(activoTexto);
    const activo = activoNormalizado === "no" ? false : true;

    filas.push({
      fila: numeroFila,
      nombre,
      descripcion: descripcionTexto || null,
      precio,
      stock,
      categoria: categoriaTexto || null,
      foto: fotoTexto || null,
      activo,
      errores,
      estado: errores.length > 0 ? "error" : "valido",
    });
  });

  return {
    filas,
    totalFilas: filas.length,
    validos: filas.filter((f) => f.estado === "valido").length,
    conErrores: filas.filter((f) => f.estado === "error").length,
    existentes: 0,
  };
}

/**
 * Marca como "existente" las filas válidas cuyo nombre ya está registrado
 * para este tenant (sección DUPLICADOS del pedido: nunca se crea un
 * duplicado silencioso). Las filas "existente" NUNCA se insertan ni se
 * actualizan automáticamente en `confirmarImportacionInventario` -- solo se
 * informan, para que el negocio las edite manualmente si quiere cambiarlas.
 */
export async function marcarDuplicados(supabase: SupabaseClient, idTenant: string, resultado: ResultadoImportacionExcel): Promise<ResultadoImportacionExcel> {
  const filas = await Promise.all(
    resultado.filas.map(async (fila) => {
      if (fila.estado !== "valido" || !fila.nombre) return fila;
      const existente = await buscarProductoPorNombre(supabase, idTenant, fila.nombre);
      return existente ? { ...fila, estado: "existente" as const } : fila;
    }),
  );
  return {
    filas,
    totalFilas: resultado.totalFilas,
    validos: filas.filter((f) => f.estado === "valido").length,
    conErrores: filas.filter((f) => f.estado === "error").length,
    existentes: filas.filter((f) => f.estado === "existente").length,
  };
}
