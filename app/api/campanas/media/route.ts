import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { subirMediaMeta } from "@/lib/meta-templates";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { descifrarSecreto } from "@/lib/crypto";
import { resolverClienteDeNumero, MENSAJE_PLANTILLA_DESCONECTADA } from "@/lib/plantilla-conexion";

export const runtime = "nodejs";

async function usuarioDeSesion(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

// Sube UNA vez el archivo del encabezado (imagen/video/documento) de una
// campaña a Meta y devuelve el media_id -- se reusa para los 400 (o los que
// sean) destinatarios de esa misma campaña, ver /api/campanas/enviar.
export async function POST(request: NextRequest) {
  const user = await usuarioDeSesion(request);
  if (!user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const miembro = await resolverMiembroEquipo(supabaseAdmin(), user.id);
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  // Cualquier excepción no prevista de acá en adelante (descifrado de token
  // corrupto, un error real de Supabase, lo que sea) queda convertida en un
  // JSON limpio -- nunca debe escapar sin control y terminar en la página de
  // error HTML de Vercel (bug real reportado: "Unexpected token '<'").
  try {
    const form = await request.formData();
    const phoneNumberId = form.get("phone_number_id");
    const archivo = form.get("archivo");
    if (typeof phoneNumberId !== "string" || !(archivo instanceof File)) {
      return Response.json({ error: "Falta 'phone_number_id' o 'archivo'" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    // Misma protección contra números huérfanos que /api/campanas/enviar --
    // ver lib/plantilla-conexion.ts.
    const cliente = await resolverClienteDeNumero(supabase, { phoneNumberId, idTenant: miembro.tenantId });
    if (!cliente) return Response.json({ error: MENSAJE_PLANTILLA_DESCONECTADA }, { status: 409 });

    const token = cliente.meta_permanent_token ? descifrarSecreto(cliente.meta_permanent_token) : process.env.META_ACCESS_TOKEN;
    if (!token) return Response.json({ error: "Sin token de Meta configurado para este número" }, { status: 500 });

    try {
      const mediaId = await subirMediaMeta({
        phoneNumberId,
        token,
        archivo,
        mimeType: archivo.type || "application/octet-stream",
        nombreArchivo: archivo.name || "archivo",
      });
      return Response.json({ media_id: mediaId });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : "Error subiendo el archivo a Meta" }, { status: 500 });
    }
  } catch (err) {
    console.error("[campanas/media] error inesperado", err);
    return Response.json({ error: "Error interno al procesar la campaña." }, { status: 500 });
  }
}
