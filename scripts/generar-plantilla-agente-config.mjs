// Genera public/plantillas/agente-config-plantilla.xlsx: la plantilla de
// configuración que el cliente llena y sube al activar un agente del
// Marketplace (ver lib/agente-config.ts para el parser que la lee).
//
// Correr de nuevo solo si cambian los campos oficiales:
//   node scripts/generar-plantilla-agente-config.mjs

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import ExcelJS from "exceljs";

const RUTA_SALIDA = "public/plantillas/agente-config-plantilla.xlsx";

const libro = new ExcelJS.Workbook();
libro.creator = "Du Labs";

const hoja = libro.addWorksheet("Configuración");
hoja.columns = [
  { header: "Campo", key: "campo", width: 34 },
  { header: "Valor", key: "valor", width: 70 },
];
hoja.getRow(1).font = { bold: true };
hoja.addRows([
  { campo: "Nombre del negocio", valor: "Peluquería Estilo" },
  { campo: "Dirección", valor: "Cra 5 # 10-20, Montería" },
  { campo: "Horario de atención", valor: "Lunes a sábado, 9am a 6pm" },
  { campo: "Métodos de pago aceptados", valor: "Efectivo, Nequi, Tarjeta" },
  { campo: "Número admin", valor: "+57 300 123 4567" },
  { campo: "Nombre del admin", valor: "Juan" },
  {
    campo: "Información adicional (precios, servicios, políticas)",
    valor: "Cortes desde $25.000, tinte desde $60.000. No trabajamos con cita los domingos.",
  },
]);

mkdirSync(dirname(RUTA_SALIDA), { recursive: true });
await libro.xlsx.writeFile(RUTA_SALIDA);
console.log(`Plantilla generada en ${RUTA_SALIDA}`);
