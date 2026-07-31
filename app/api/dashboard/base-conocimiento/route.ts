import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { extraerTexto, TAMANO_MAXIMO_BYTES } from "@/lib/archivo-texto";

export const runtime = "nodejs";
export const maxDuration = 60;

const LIMITE_CARACTERES = 100_000; // suficiente para ~200 productos o un PDF de estatutos típico

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
  const agenteId = form.get("agente_id");
  const archivo = form.get("archivo");
  if ((typeof phoneNumberId !== "string" || !phoneNumberId) && (typeof agenteId !== "string" || !agenteId)) {
    return Response.json({ error: "Falta 'phone_number_id' o 'agente_id'" }, { status: 400 });
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

  const cambios = {
    base_conocimiento: texto,
    base_conocimiento_nombre_archivo: archivo.name,
    base_conocimiento_actualizado_at: new Date().toISOString(),
  };

  const { error } =
    typeof agenteId === "string" && agenteId
      ? await supabase.from("dulabs_agentes").update(cambios).eq("id", agenteId).eq("id_tenant", miembro.tenantId)
      : await supabase
          .from("dulabs_clientes_config")
          .update(cambios)
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

  let body: { phone_number_id?: string; agente_id?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.phone_number_id && !body.agente_id) {
    return Response.json({ error: "Falta 'phone_number_id' o 'agente_id'" }, { status: 400 });
  }

  const cambios = { base_conocimiento: null, base_conocimiento_nombre_archivo: null, base_conocimiento_actualizado_at: null };
  const { error } = body.agente_id
    ? await supabase.from("dulabs_agentes").update(cambios).eq("id", body.agente_id).eq("id_tenant", miembro.tenantId)
    : await supabase
        .from("dulabs_clientes_config")
        .update(cambios)
        .eq("phone_number_id", body.phone_number_id)
        .eq("id_tenant", miembro.tenantId);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
