import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { cargarLibroExcel, TAMANO_MAXIMO_BYTES } from "@/lib/archivo-texto";
import { parseContactosEstructurado } from "@/lib/contactos-import";

export const runtime = "nodejs";
export const maxDuration = 30;

// Sube un .xlsx con el formato oficial (columnas Teléfono / Nombre, ver
// lib/contactos-import.ts) y devuelve la lista de contactos leída, para que
// el usuario la revise y registre en el textarea de destinatarios antes de
// enviar la campaña — nunca envía nada por sí sola.
//
// Envuelto en try/catch de nivel superior: cualquier excepción no prevista
// debe devolver JSON igual, nunca la página de error HTML de la plataforma.
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

    const supabase = supabaseAdmin();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
    const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
    if (!requireRol(miembro, ["admin"])) {
      return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
    }

    const form = await request.formData();
    const archivo = form.get("archivo");
    if (!(archivo instanceof File) || archivo.size === 0) {
      return Response.json({ error: "Falta el archivo" }, { status: 400 });
    }
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return Response.json({ error: "El archivo supera el límite de 4 MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await archivo.arrayBuffer());
    const libro = await cargarLibroExcel(archivo.name, buffer);
    if (!libro) {
      return Response.json({ error: "Sube un archivo .xlsx con las columnas Teléfono / Nombre." }, { status: 400 });
    }

    const contactos = parseContactosEstructurado(libro);
    if (!contactos) {
      return Response.json(
        { error: "No se encontró una columna 'Teléfono' en el archivo. Descarga la plantilla oficial y usa esas columnas." },
        { status: 400 }
      );
    }

    return Response.json({ contactos });
  } catch (err) {
    console.error("[campanas/importar] error inesperado:", err instanceof Error ? err.stack ?? err.message : err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Error inesperado importando el archivo" },
      { status: 500 }
    );
  }
}
