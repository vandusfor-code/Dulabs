import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { desuscribirWaba } from "@/lib/meta-numero";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { descifrarSecreto } from "@/lib/crypto";

export const runtime = "nodejs";

// Elimina la cuenta por completo: desconecta cada número de Meta, borra
// todos los mensajes/campañas/configuración de cada número, cancela la
// suscripción y borra el usuario de autenticación. Irreversible.
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
  const tenantId = miembro.tenantId;

  // Cualquier admin del equipo puede borrar la cuenta completa — incluye a
  // TODOS los miembros del equipo, no solo a quien la borra.
  const { data: miembrosTenant } = await supabase
    .from("dulabs_miembros_equipo")
    .select("user_id")
    .eq("tenant_id", tenantId);

  const { data: negocios, error: negociosError } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, whatsapp_business_account_id, meta_permanent_token")
    .eq("id_tenant", tenantId);
  if (negociosError) return Response.json({ error: negociosError.message }, { status: 500 });

  for (const negocio of negocios ?? []) {
    const metaToken = negocio.meta_permanent_token ? descifrarSecreto(negocio.meta_permanent_token) : process.env.META_ACCESS_TOKEN;
    if (metaToken) {
      await desuscribirWaba({ wabaId: negocio.whatsapp_business_account_id, token: metaToken });
    }
    await supabase.from("dulabs_mensajes_log").delete().eq("phone_number_id", negocio.phone_number_id);
    // Tablas más nuevas keyeadas por phone_number_id, no por id_tenant —
    // "eliminar cuenta" debe borrarlas también, no solo el historial de
    // mensajes (ver /eliminacion-de-datos-whatsapp).
    await supabase.from("dulabs_pausas_chat").delete().eq("phone_number_id", negocio.phone_number_id);
    await supabase.from("dulabs_conversacion_asignaciones").delete().eq("phone_number_id", negocio.phone_number_id);
    await supabase.from("dulabs_conversacion_eventos").delete().eq("phone_number_id", negocio.phone_number_id);
    await supabase.from("dulabs_conversacion_etiquetas").delete().eq("phone_number_id", negocio.phone_number_id);
  }

  const { error: campanasError } = await supabase.from("dulabs_campanas").delete().eq("id_tenant", tenantId);
  if (campanasError) return Response.json({ error: campanasError.message }, { status: 500 });

  const { error: plantillasError } = await supabase.from("dulabs_plantillas").delete().eq("id_tenant", tenantId);
  if (plantillasError) return Response.json({ error: plantillasError.message }, { status: 500 });

  // Catálogos propios del tenant (no del número individual): etiquetas y
  // respuestas rápidas. Borrar etiquetas también hace cascade sobre
  // dulabs_conversacion_etiquetas restante, si algo quedó.
  await supabase.from("dulabs_etiquetas").delete().eq("tenant_id", tenantId);
  await supabase.from("dulabs_respuestas_rapidas").delete().eq("tenant_id", tenantId);

  const { error: configError } = await supabase.from("dulabs_clientes_config").delete().eq("id_tenant", tenantId);
  if (configError) return Response.json({ error: configError.message }, { status: 500 });

  const { error: suscripcionError } = await supabase.from("dulabs_suscripciones").delete().eq("id_tenant", tenantId);
  if (suscripcionError) return Response.json({ error: suscripcionError.message }, { status: 500 });

  const { error: miembrosError } = await supabase.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
  if (miembrosError) return Response.json({ error: miembrosError.message }, { status: 500 });

  // Borra el login de CADA miembro del equipo, no solo el de quien ejecuta
  // la acción — "eliminar cuenta" borra el tenant completo.
  for (const m of miembrosTenant ?? []) {
    const { error: deleteUserError } = await supabase.auth.admin.deleteUser(m.user_id);
    if (deleteUserError) {
      console.error("[dashboard/cuenta] error borrando usuario", m.user_id, deleteUserError.message);
    }
  }

  return Response.json({ success: true });
}
