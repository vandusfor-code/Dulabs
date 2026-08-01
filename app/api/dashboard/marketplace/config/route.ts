import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { cargarLibroExcel, TAMANO_MAXIMO_BYTES } from "@/lib/archivo-texto";
import { parseConfigAgente } from "@/lib/agente-config";

export const runtime = "nodejs";
export const maxDuration = 30;

// Actualiza la configuración de un agente del Marketplace ya activo (número
// admin + info del negocio) desde una nueva plantilla, SIN cobrar de nuevo.
// Multipart: campo phone_number_id + archivo "config".
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
    const phoneNumberId = String(form.get("phone_number_id") ?? "");
    const archivo = form.get("config");
    if (!phoneNumberId) return Response.json({ error: "Falta el número" }, { status: 400 });
    if (!(archivo instanceof File) || archivo.size === 0) {
      return Response.json({ error: "Falta la plantilla de configuración" }, { status: 400 });
    }
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return Response.json({ error: "El archivo supera el límite de 4 MB" }, { status: 400 });
    }

    const { data: cliente } = await supabase
      .from("dulabs_clientes_config")
      .select("marketplace_activacion_id")
      .eq("phone_number_id", phoneNumberId)
      .eq("id_tenant", miembro.tenantId)
      .maybeSingle();
    if (!cliente?.marketplace_activacion_id) {
      return Response.json({ error: "Este número no tiene un agente del marketplace activo" }, { status: 400 });
    }

    const buffer = Buffer.from(await archivo.arrayBuffer());
    const libro = await cargarLibroExcel(archivo.name, buffer);
    if (!libro) return Response.json({ error: "Sube la plantilla oficial en formato .xlsx." }, { status: 400 });
    const config = parseConfigAgente(libro);
    if (!config) {
      return Response.json({ error: "No pudimos leer la plantilla. Usa la plantilla oficial sin cambiar las columnas." }, { status: 400 });
    }

    const { error: updateError } = await supabase
      .from("dulabs_marketplace_activaciones")
      .update({
        numero_admin: config.numeroAdmin,
        nombre_admin: config.nombreAdmin,
        config_texto: config.textoNegocio,
        config_nombre_archivo: archivo.name,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cliente.marketplace_activacion_id)
      .eq("id_tenant", miembro.tenantId);
    if (updateError) {
      return Response.json({ error: `No se pudo actualizar: ${updateError.message}` }, { status: 503 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("[marketplace/config] error inesperado:", err instanceof Error ? err.stack ?? err.message : err);
    return Response.json({ error: err instanceof Error ? err.message : "Error inesperado" }, { status: 500 });
  }
}
