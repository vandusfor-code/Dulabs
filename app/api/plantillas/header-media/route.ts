import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { subirEjemploHeaderMeta } from "@/lib/meta-templates";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { descifrarSecreto } from "@/lib/crypto";

export const runtime = "nodejs";

async function usuarioDeSesion(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

// Sube el archivo de EJEMPLO de un encabezado de imagen/video/documento para
// poder CREAR una plantilla (distinto de /api/campanas/media, que sube el
// archivo real para ENVIAR una plantilla ya aprobada) -- Meta exige el flujo
// de "resumable upload" para el example.header_handle. Devuelve el handle
// que /api/plantillas debe mandar al crear la plantilla.
export async function POST(request: NextRequest) {
  const user = await usuarioDeSesion(request);
  if (!user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const miembro = await resolverMiembroEquipo(supabaseAdmin(), user.id);
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  if (!appId) return Response.json({ error: "Falta NEXT_PUBLIC_META_APP_ID en el servidor" }, { status: 500 });

  const form = await request.formData();
  const phoneNumberId = form.get("phone_number_id");
  const archivo = form.get("archivo");
  if (typeof phoneNumberId !== "string" || !(archivo instanceof File)) {
    return Response.json({ error: "Falta 'phone_number_id' o 'archivo'" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { data: cliente, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select("meta_permanent_token")
    .eq("phone_number_id", phoneNumberId)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const token = cliente.meta_permanent_token ? descifrarSecreto(cliente.meta_permanent_token) : process.env.META_ACCESS_TOKEN;
  if (!token) return Response.json({ error: "Sin token de Meta configurado para este número" }, { status: 500 });

  try {
    const buffer = Buffer.from(await archivo.arrayBuffer());
    const handle = await subirEjemploHeaderMeta({
      appId,
      token,
      archivo: buffer,
      mimeType: archivo.type || "application/octet-stream",
      nombreArchivo: archivo.name || "archivo",
    });
    return Response.json({ handle });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Error subiendo el ejemplo del encabezado a Meta" }, { status: 500 });
  }
}
