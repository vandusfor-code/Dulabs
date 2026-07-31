import Anthropic from "@anthropic-ai/sdk";
import type ExcelJS from "exceljs";
import type { SurveyQuestion, QuestionType } from "@/lib/survey-builder";
import { celdaATexto } from "@/lib/archivo-texto";

const MODELO = "claude-opus-4-8";

const TIPOS_VALIDOS: QuestionType[] = [
  "single_choice",
  "multiple_choice",
  "yes_no",
  "rating_1_5",
  "rating_1_10",
  "nps_0_10",
  "open_text",
];

export interface DestinatarioExtraido {
  telefono: string;
  nombre: string | null;
}

export interface EncuestaExtraida {
  preguntas: SurveyQuestion[];
  destinatarios: DestinatarioExtraido[];
  /** "estructurado" = se leyó por columnas fijas (100% confiable, sin IA); "ia" = interpretado. */
  metodo: "estructurado" | "ia";
}

// ---------------------------------------------------------------------------
// Formato oficial (determinista, sin IA): un .xlsx con hasta dos hojas.
//
//   Hoja "Preguntas": columnas Pregunta | Tipo | Obligatoria | Opción 1..N
//     Tipo acepta (sin distinguir mayúsculas/acentos): Opción única,
//     Opción múltiple, Sí/No, Calificación 1-5, Calificación 1-10, NPS,
//     Texto libre (o los nombres internos: single_choice, multiple_choice,
//     yes_no, rating_1_5, rating_1_10, nps_0_10, open_text).
//     "Opción 1", "Opción 2", ... solo se usan si Tipo es de opción.
//
//   Hoja "Contactos": columnas Teléfono | Nombre
//
// Plantilla descargable: public/plantillas/encuesta-plantilla.xlsx
// (generada por scripts/generar-plantilla-encuesta.mjs).
// ---------------------------------------------------------------------------

function normalizarEncabezado(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const TIPO_POR_ETIQUETA: Record<string, QuestionType> = {
  "opcion unica": "single_choice",
  single_choice: "single_choice",
  "opcion multiple": "multiple_choice",
  multiple_choice: "multiple_choice",
  "si/no": "yes_no",
  "si / no": "yes_no",
  yes_no: "yes_no",
  "calificacion 1-5": "rating_1_5",
  rating_1_5: "rating_1_5",
  "calificacion 1-10": "rating_1_10",
  rating_1_10: "rating_1_10",
  nps: "nps_0_10",
  "nps 0-10": "nps_0_10",
  nps_0_10: "nps_0_10",
  "texto libre": "open_text",
  "texto abierto": "open_text",
  open_text: "open_text",
};

function buscarHoja(libro: ExcelJS.Workbook, contiene: string): ExcelJS.Worksheet | undefined {
  return libro.worksheets.find((h) => normalizarEncabezado(h.name).includes(contiene));
}

/** Mapea encabezado normalizado (fila 1) -> número de columna. */
function mapearColumnas(hoja: ExcelJS.Worksheet): Map<string, number> {
  const mapa = new Map<string, number>();
  hoja.getRow(1).eachCell({ includeEmpty: false }, (celda, colNumber) => {
    const texto = normalizarEncabezado(celdaATexto(celda.value));
    if (texto) mapa.set(texto, colNumber);
  });
  return mapa;
}

function parsearHojaPreguntas(hoja: ExcelJS.Worksheet): SurveyQuestion[] {
  const columnas = mapearColumnas(hoja);
  const colPregunta = columnas.get("pregunta");
  const colTipo = columnas.get("tipo");
  if (!colPregunta || !colTipo) return []; // no coincide con el formato oficial

  const colObligatoria = columnas.get("obligatoria");
  const columnasOpcion = [...columnas.entries()]
    .filter(([clave]) => clave.startsWith("opcion"))
    .sort((a, b) => a[1] - b[1])
    .map(([, indice]) => indice);

  const preguntas: SurveyQuestion[] = [];
  let contador = 0;
  hoja.eachRow((fila, numeroFila) => {
    if (numeroFila === 1) return;
    const texto = celdaATexto(fila.getCell(colPregunta).value).trim();
    if (!texto) return;
    const tipo = TIPO_POR_ETIQUETA[normalizarEncabezado(celdaATexto(fila.getCell(colTipo).value))];
    if (!tipo) return;

    contador += 1;
    const pregunta: SurveyQuestion = {
      id: `import-${Date.now().toString(36)}-${contador}`,
      type: tipo,
      text: texto,
      required: colObligatoria ? !/^no$/i.test(celdaATexto(fila.getCell(colObligatoria).value).trim()) : true,
    };
    if (tipo === "single_choice" || tipo === "multiple_choice") {
      const opciones = columnasOpcion.map((c) => celdaATexto(fila.getCell(c).value).trim()).filter(Boolean);
      pregunta.options = opciones.length > 0 ? opciones : ["", ""];
    }
    preguntas.push(pregunta);
  });
  return preguntas;
}

// Google Sheets/Excel muestran un teléfono largo tecleado en una celda
// numérica en notación científica (ej. "5,73182E+11") si la columna no está
// formateada como texto — el valor interno sigue siendo el número exacto,
// así que String(numero) ya da el teléfono completo. El riesgo real es si la
// celda llega como STRING con esa misma notación (algunos exportadores
// "hornean" el texto mostrado en vez del número): un simple
// `.replace(/\D/g, "")` ahí mezclaría mantisa y exponente en un teléfono
// distinto y válido en apariencia (ej. "5.73182E+11" -> "57318211"), en vez
// de fallar visiblemente. Se detecta ese patrón y se reconstruye el número
// real antes de limpiar dígitos.
function telefonoDeCelda(valor: ExcelJS.CellValue): string {
  if (typeof valor === "number") return String(Math.trunc(valor));
  const texto = celdaATexto(valor).trim();
  if (/^\d+(\.\d+)?[eE][+-]?\d+$/.test(texto)) {
    const numero = Number(texto);
    if (Number.isFinite(numero)) return String(Math.trunc(numero));
  }
  return texto;
}

function parsearHojaContactos(hoja: ExcelJS.Worksheet): DestinatarioExtraido[] {
  const columnas = mapearColumnas(hoja);
  const colTelefono = columnas.get("telefono");
  if (!colTelefono) return []; // no coincide con el formato oficial
  const colNombre = columnas.get("nombre");

  const destinatarios: DestinatarioExtraido[] = [];
  hoja.eachRow((fila, numeroFila) => {
    if (numeroFila === 1) return;
    const telefono = telefonoDeCelda(fila.getCell(colTelefono).value).replace(/\D/g, "");
    if (telefono.length < 8) return;
    const nombre = colNombre ? celdaATexto(fila.getCell(colNombre).value).trim() || null : null;
    destinatarios.push({ telefono, nombre });
  });
  return destinatarios;
}

// Lee el .xlsx buscando las hojas "Preguntas"/"Contactos" del formato
// oficial. Determinista, sin llamar a la IA — devuelve null si el archivo no
// tiene ninguna de las dos hojas reconocibles, para que el llamador recurra
// a la interpretación por IA (archivos más libres/desordenados).
export function parseEncuestaEstructurada(libro: ExcelJS.Workbook): EncuestaExtraida | null {
  const hojaPreguntas = buscarHoja(libro, "pregunta");
  const hojaContactos = buscarHoja(libro, "contacto");
  const preguntas = hojaPreguntas ? parsearHojaPreguntas(hojaPreguntas) : [];
  const destinatarios = hojaContactos ? parsearHojaContactos(hojaContactos) : [];
  if (preguntas.length === 0 && destinatarios.length === 0) return null;
  return { preguntas, destinatarios, metodo: "estructurado" };
}

// Interpreta el texto crudo de un Excel/CSV subido (ya aplanado por
// lib/archivo-texto.ts) y separa dos cosas que pueden convivir en el mismo
// archivo: una lista de preguntas (con sus opciones si aplica) y una lista
// de contactos a invitar. Usa tool-use forzado — la respuesta es JSON
// válido garantizado por el schema, nunca texto libre a parsear a mano. El
// resultado se entrega para revisión/edición del usuario, nunca se guarda
// directo: es una interpretación de IA sobre un archivo desestructurado.
export async function extraerEncuestaDeTexto(textoArchivo: string, apiKey: string): Promise<EncuestaExtraida> {
  const anthropic = new Anthropic({ apiKey });

  const response = await anthropic.messages.create({
    model: MODELO,
    max_tokens: 4096,
    tools: [
      {
        name: "registrar_encuesta",
        description:
          "Registra las preguntas de encuesta y la lista de destinatarios encontrados en un archivo subido por el usuario.",
        input_schema: {
          type: "object",
          properties: {
            preguntas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  texto: { type: "string" },
                  tipo: { type: "string", enum: TIPOS_VALIDOS },
                  opciones: { type: "array", items: { type: "string" } },
                  obligatoria: { type: "boolean" },
                },
                required: ["texto", "tipo"],
              },
            },
            destinatarios: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  telefono: { type: "string" },
                  nombre: { type: "string" },
                },
                required: ["telefono"],
              },
            },
          },
          required: ["preguntas", "destinatarios"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "registrar_encuesta" },
    messages: [
      {
        role: "user",
        content: `Este es el contenido crudo (aplanado a texto/CSV) de un archivo subido para crear una encuesta de WhatsApp. Identifica:
1. Cualquier lista de preguntas (y sus opciones de respuesta si son de opción única/múltiple) — infiere el tipo más adecuado entre: single_choice (opción única), multiple_choice (opción múltiple), yes_no (sí/no), rating_1_5, rating_1_10, nps_0_10, u open_text (texto libre).
2. Cualquier lista de contactos (teléfono con indicativo de país + nombre si aparece).

No inventes preguntas ni contactos que no estén en el archivo. Si el archivo solo trae uno de los dos, deja el otro arreglo vacío.

--- CONTENIDO DEL ARCHIVO ---
${textoArchivo.slice(0, 50_000)}`,
      },
    ],
  });

  const bloque = response.content.find((b) => b.type === "tool_use");
  if (!bloque || bloque.type !== "tool_use") {
    throw new Error("La IA no pudo interpretar el archivo");
  }
  const datos = bloque.input as {
    preguntas: { texto: string; tipo: string; opciones?: string[]; obligatoria?: boolean }[];
    destinatarios: { telefono: string; nombre?: string }[];
  };

  let idCounter = 0;
  const preguntas: SurveyQuestion[] = datos.preguntas
    .filter((p) => p.texto?.trim() && TIPOS_VALIDOS.includes(p.tipo as QuestionType))
    .map((p) => {
      idCounter += 1;
      const tipo = p.tipo as QuestionType;
      const q: SurveyQuestion = {
        id: `import-${Date.now().toString(36)}-${idCounter}`,
        type: tipo,
        text: p.texto.trim(),
        required: p.obligatoria ?? true,
      };
      if (tipo === "single_choice" || tipo === "multiple_choice") {
        q.options = p.opciones?.map((o) => o.trim()).filter(Boolean) ?? ["", ""];
      }
      return q;
    });

  const destinatarios: DestinatarioExtraido[] = datos.destinatarios
    .map((d) => ({ telefono: (d.telefono ?? "").replace(/\D/g, ""), nombre: d.nombre?.trim() || null }))
    .filter((d) => d.telefono.length >= 8);

  return { preguntas, destinatarios, metodo: "ia" };
}
