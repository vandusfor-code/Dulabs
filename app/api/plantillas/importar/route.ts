import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { importarPlantillaMeta } from "@/lib/meta-templates";
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

// Trae una plantilla que ya existe en Meta (creada directamente en el
// Administrador de WhatsApp de Meta, por fuera del editor de DuLabs -- por
// ejemplo cualquier plantilla con encabezado de imagen/video, que el editor
// de DuLabs todavía no sabe crear) y la registra en dulabs_plantillas para
// poder usarla en campañas desde el panel.
export async function POST(request: NextRequest) {
  const user = await usuarioDeSesion(request);
  if (!user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const miembro = await resolverMiembroEquipo(supabaseAdmin(), user.id);
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  let body: { phone_number_id?: string; nombre?: string; idioma?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id, nombre } = body;
  if (!phone_number_id || !nombre?.trim()) {
    return Response.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { data: cliente, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select("whatsapp_business_account_id, meta_permanent_token")
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const token = cliente.meta_permanent_token ? descifrarSecreto(cliente.meta_permanent_token) : process.env.META_ACCESS_TOKEN;
  if (!token) return Response.json({ error: "Sin token de Meta configurado para este número" }, { status: 500 });

  let importada;
  try {
    importada = await importarPlantillaMeta({
      wabaId: cliente.whatsapp_business_account_id,
      token,
      nombre: nombre.trim(),
      idioma: body.idioma?.trim() || undefined,
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Error consultando Meta" }, { status: 500 });
  }
  if (!importada) {
    return Response.json({ error: `No se encontró ninguna plantilla llamada "${nombre.trim()}" en Meta` }, { status: 404 });
  }

  const { data: fila, error: upsertError } = await supabase
    .from("dulabs_plantillas")
    .upsert(
      {
        id_tenant: miembro.tenantId,
        phone_number_id,
        whatsapp_business_account_id: cliente.whatsapp_business_account_id,
        nombre: nombre.trim(),
        categoria: importada.categoria,
        idioma: importada.idioma,
        cuerpo: importada.cuerpo,
        footer: importada.footer,
        botones: importada.botones,
        meta_template_id: importada.metaTemplateId,
        estado: importada.estado,
        header_formato: importada.headerFormato,
        borrador: false,
      },
      { onConflict: "whatsapp_business_account_id,nombre,idioma" }
    )
    .select("id")
    .single();
  if (upsertError) return Response.json({ error: upsertError.message }, { status: 500 });

  return Response.json({ success: true, id: fila.id, estado: importada.estado, header_formato: importada.headerFormato });
}
