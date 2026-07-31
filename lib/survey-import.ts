import Anthropic from "@anthropic-ai/sdk";
import type { SurveyQuestion, QuestionType } from "@/lib/survey-builder";

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

  return { preguntas, destinatarios };
}
