import type ExcelJS from "exceljs";
import { celdaATexto, buscarHoja, mapearColumnas, telefonoDeCelda } from "@/lib/archivo-texto";

export interface ContactoImportado {
  telefono: string;
  nombre: string | null;
}

// Formato oficial (determinista, sin IA): un .xlsx con una hoja "Contactos"
// (o la primera hoja, si no hay ninguna con ese nombre) — columnas
// Teléfono | Nombre. Plantilla descargable:
// public/plantillas/contactos-plantilla.xlsx (generada por
// scripts/generar-plantilla-contactos.mjs).
export function parseContactosEstructurado(libro: ExcelJS.Workbook): ContactoImportado[] | null {
  const hoja = buscarHoja(libro, "contacto") ?? libro.worksheets[0];
  if (!hoja) return null;
  const columnas = mapearColumnas(hoja);
  const colTelefono = columnas.get("telefono");
  if (!colTelefono) return null; // no coincide con el formato oficial

  const colNombre = columnas.get("nombre");
  const contactos: ContactoImportado[] = [];
  hoja.eachRow((fila, numeroFila) => {
    if (numeroFila === 1) return;
    const telefono = telefonoDeCelda(fila.getCell(colTelefono).value).replace(/\D/g, "");
    if (telefono.length < 8) return;
    const nombre = colNombre ? celdaATexto(fila.getCell(colNombre).value).trim() || null : null;
    contactos.push({ telefono, nombre });
  });
  return contactos.length > 0 ? contactos : null;
}
