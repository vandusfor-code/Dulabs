// Genera public/plantillas/contactos-plantilla.xlsx: el formato oficial para
// importar destinatarios en Campañas (/dashboard/campanas). Ver
// lib/contactos-import.ts (parseContactosEstructurado) para el parser que
// lee este mismo formato.
//
// Correr de nuevo solo si cambian las columnas oficiales:
//   node scripts/generar-plantilla-contactos.mjs

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import ExcelJS from "exceljs";

const RUTA_SALIDA = "public/plantillas/contactos-plantilla.xlsx";

const libro = new ExcelJS.Workbook();
libro.creator = "Du Labs";

const hojaContactos = libro.addWorksheet("Contactos");
hojaContactos.columns = [
  { header: "Teléfono", key: "telefono", width: 20 },
  { header: "Nombre", key: "nombre", width: 30 },
];
hojaContactos.getRow(1).font = { bold: true };
hojaContactos.addRows([
  { telefono: "573001234567", nombre: "Juan Pérez" },
  { telefono: "573007654321", nombre: "" },
]);

mkdirSync(dirname(RUTA_SALIDA), { recursive: true });
await libro.xlsx.writeFile(RUTA_SALIDA);
console.log(`Plantilla generada en ${RUTA_SALIDA}`);
