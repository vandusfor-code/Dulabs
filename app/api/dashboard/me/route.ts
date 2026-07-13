import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// Datos del tenant autenticado. El front nunca ve meta_permanent_token:
// solo campos de visualización + un booleano de si hay token guardado.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return Response.json({ error: "Falta el token de sesión" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .select(
      "nombre_negocio, telefono_negocio, phone_number_id, whatsapp_business_account_id, meta_permanent_token, updated_at"
    )
    .eq("id_tenant", userData.user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const negocios = (data ?? []).map((n) => ({
    nombre_negocio: n.nombre_negocio,
    telefono_negocio: n.telefono_negocio,
    phone_number_id: n.phone_number_id,
    whatsapp_business_account_id: n.whatsapp_business_account_id,
    conectado: Boolean(n.meta_permanent_token || process.env.META_ACCESS_TOKEN),
    updated_at: n.updated_at,
  }));

  return Response.json({ email: userData.user.email, negocios });
}
