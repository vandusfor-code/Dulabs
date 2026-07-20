import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { PDFParse } from "pdf-parse";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";

export const runtime = "nodejs";
export const maxDuration = 60;

const TAMANO_MAXIMO_BYTES = 4 * 1024 * 1024; // 4 MB
const LIMITE_CARACTERES = 100_000; // suficiente para ~200 productos o un PDF de estatutos típico
// .xls (binario legacy) ya no se soporta — exceljs no lo lee. Cualquiera con
// un .xls real lo puede volver a guardar como .xlsx en un clic.
const EXTENSIONES_PLANILLA = ["xlsx", "csv"];

function extension(nombre: string): string {
  return nombre.split(".").pop()?.toLowerCase() ?? "";
}

function celdaATexto(valor: ExcelJS.CellValue): string {
  if (valor == null) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === "object") {
    if ("result" in valor) return celdaATexto((valor as { result?: ExcelJS.CellValue }).result ?? "");
    if ("text" in valor) return String((valor as { text?: unknown }).text ?? "");
    if ("richText" in valor) {
      return (valor as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    }
  }
  return String(valor);
}

function filaACsv(valores: ExcelJS.CellValue[]): string {
  // exceljs indexa las filas desde 1; el índice 0 de row.values viene vacío.
  return valores
    .slice(1)
    .map((v) => {
      const texto = celdaATexto(v);
      return /[,"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
    })
    .join(",");
}

async function extraerTexto(archivo: File, buffer: Buffer): Promise<string> {
  const ext = extension(archivo.name);
  if (ext === "pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const resultado = await parser.getText();
      return resultado.text;
    } finally {
      await parser.destroy();
    }
  }
  if (EXTENSIONES_PLANILLA.includes(ext)) {
    if (ext === "csv") {
      return `# ${archivo.name}\n${buffer.toString("utf8")}`;
    }
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    return libro.worksheets
      .map((hoja) => {
        const filas: string[] = [];
        hoja.eachRow((fila) => filas.push(filaACsv(fila.values as ExcelJS.CellValue[])));
        return `# ${hoja.name}\n${filas.join("\n")}`;
      })
      .join("\n\n");
  }
  throw new Error("Formato no soportado. Sube un archivo .xlsx, .csv o .pdf");
}

// Sube y extrae el texto de un listado de precios/productos (Excel/CSV) o un
// documento (PDF) para que la IA lo use como contexto adicional al responder.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  const form = await request.formData();
  const phoneNumberId = form.get("phone_number_id");
  const archivo = form.get("archivo");
  if (typeof phoneNumberId !== "string" || !phoneNumberId) {
    return Response.json({ error: "Falta 'phone_number_id'" }, { status: 400 });
  }
  if (!(archivo instanceof File) || archivo.size === 0) {
    return Response.json({ error: "Falta el archivo" }, { status: 400 });
  }
  if (archivo.size > TAMANO_MAXIMO_BYTES) {
    return Response.json({ error: "El archivo supera el límite de 4 MB" }, { status: 400 });
  }

  let texto: string;
  try {
    const buffer = Buffer.from(await archivo.arrayBuffer());
    texto = await extraerTexto(archivo, buffer);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "No se pudo leer el archivo" },
      { status: 400 }
    );
  }

  const truncado = texto.length > LIMITE_CARACTERES;
  if (truncado) texto = texto.slice(0, LIMITE_CARACTERES);

  const { error } = await supabase
    .from("dulabs_clientes_config")
    .update({
      base_conocimiento: texto,
      base_conocimiento_nombre_archivo: archivo.name,
      base_conocimiento_actualizado_at: new Date().toISOString(),
    })
    .eq("phone_number_id", phoneNumberId)
    .eq("id_tenant", miembro.tenantId);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true, nombre_archivo: archivo.name, caracteres: texto.length, truncado });
}

// Quita la base de conocimiento (vuelve a responder solo con las instrucciones).
export async function DELETE(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  let body: { phone_number_id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.phone_number_id) {
    return Response.json({ error: "Falta 'phone_number_id'" }, { status: 400 });
  }

  const { error } = await supabase
    .from("dulabs_clientes_config")
    .update({ base_conocimiento: null, base_conocimiento_nombre_archivo: null, base_conocimiento_actualizado_at: null })
    .eq("phone_number_id", body.phone_number_id)
    .eq("id_tenant", miembro.tenantId);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
