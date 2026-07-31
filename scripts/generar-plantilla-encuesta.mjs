// Genera public/plantillas/encuesta-plantilla.xlsx: el formato oficial para
// importar una encuesta (preguntas + contactos) en el Builder de
// /dashboard/surveys/new. Ver lib/survey-import.ts (parseEncuestaEstructurada)
// para el parser que lee este mismo formato.
//
// Correr de nuevo solo si cambian las columnas oficiales:
//   node scripts/generar-plantilla-encuesta.mjs

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import ExcelJS from "exceljs";

const RUTA_SALIDA = "public/plantillas/encuesta-plantilla.xlsx";

const libro = new ExcelJS.Workbook();
libro.creator = "Du Labs";

const hojaPreguntas = libro.addWorksheet("Preguntas");
hojaPreguntas.columns = [
  { header: "Pregunta", key: "pregunta", width: 50 },
  { header: "Tipo", key: "tipo", width: 20 },
  { header: "Obligatoria", key: "obligatoria", width: 14 },
  { header: "Opción 1", key: "op1", width: 20 },
  { header: "Opción 2", key: "op2", width: 20 },
  { header: "Opción 3", key: "op3", width: 20 },
  { header: "Opción 4", key: "op4", width: 20 },
];
hojaPreguntas.getRow(1).font = { bold: true };
hojaPreguntas.addRows([
  { pregunta: "¿Cómo calificas la atención recibida?", tipo: "Calificación 1-10", obligatoria: "Sí" },
  { pregunta: "¿Qué tan probable es que nos recomiendes?", tipo: "NPS", obligatoria: "Sí" },
  { pregunta: "¿Resolvimos tu solicitud?", tipo: "Sí/No", obligatoria: "Sí" },
  {
    pregunta: "¿Cómo prefieres que te contactemos?",
    tipo: "Opción única",
    obligatoria: "No",
    op1: "WhatsApp",
    op2: "Llamada",
    op3: "Correo",
  },
  { pregunta: "¿Algún comentario o sugerencia?", tipo: "Texto libre", obligatoria: "No" },
]);

const hojaTipos = libro.addWorksheet("Tipos válidos (referencia)");
hojaTipos.columns = [
  { header: "Tipo", key: "tipo", width: 22 },
  { header: "Qué hace", key: "desc", width: 55 },
];
hojaTipos.getRow(1).font = { bold: true };
hojaTipos.addRows([
  { tipo: "Opción única", desc: "El participante elige UNA opción de las que pongas en Opción 1, 2, 3…" },
  { tipo: "Opción múltiple", desc: "El participante puede elegir VARIAS opciones." },
  { tipo: "Sí/No", desc: "Respuesta de sí o no. No necesita columnas de opción." },
  { tipo: "Calificación 1-5", desc: "Número del 1 al 5." },
  { tipo: "Calificación 1-10", desc: "Número del 1 al 10." },
  { tipo: "NPS", desc: "Número del 0 al 10 (probabilidad de recomendar)." },
  { tipo: "Texto libre", desc: "El participante responde con sus propias palabras." },
]);

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
