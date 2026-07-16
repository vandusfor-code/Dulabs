import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { desuscribirWaba } from "@/lib/meta-numero";

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
  const tenantId = userData.user.id;

  const { data: negocios, error: negociosError } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, whatsapp_business_account_id, meta_permanent_token")
    .eq("id_tenant", tenantId);
  if (negociosError) return Response.json({ error: negociosError.message }, { status: 500 });

  for (const negocio of negocios ?? []) {
    const metaToken = negocio.meta_permanent_token || process.env.META_ACCESS_TOKEN;
    if (metaToken) {
      await desuscribirWaba({ wabaId: negocio.whatsapp_business_account_id, token: metaToken });
    }
    await supabase.from("dulabs_mensajes_log").delete().eq("phone_number_id", negocio.phone_number_id);
  }

  const { error: campanasError } = await supabase.from("dulabs_campanas").delete().eq("id_tenant", tenantId);
  if (campanasError) return Response.json({ error: campanasError.message }, { status: 500 });

  const { error: plantillasError } = await supabase.from("dulabs_plantillas").delete().eq("id_tenant", tenantId);
  if (plantillasError) return Response.json({ error: plantillasError.message }, { status: 500 });

  const { error: configError } = await supabase.from("dulabs_clientes_config").delete().eq("id_tenant", tenantId);
  if (configError) return Response.json({ error: configError.message }, { status: 500 });

  const { error: suscripcionError } = await supabase.from("dulabs_suscripciones").delete().eq("id_tenant", tenantId);
  if (suscripcionError) return Response.json({ error: suscripcionError.message }, { status: 500 });

  const { error: deleteUserError } = await supabase.auth.admin.deleteUser(tenantId);
  if (deleteUserError) return Response.json({ error: deleteUserError.message }, { status: 500 });

  return Response.json({ success: true });
}
