import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";

export const runtime = "nodejs";

async function usuarioYMiembro(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  const miembro = await resolverMiembroEquipo(supabase, data.user.id);
  return miembro ? { supabase, miembro } : null;
}

// Secuencia de UNA pregunta a la vez: teléfono -> compañía -> RUT -> transferencia.
const DEFAULTS = {
  campaign_label: "Campaña",
  yes_button_text: "SÍ",
  no_button_text: "NO",
  ask_data_template: "¡Claro! 😊 Para validar en el sistema si puedes aplicar a la oferta, confírmame tu número de teléfono.",
  ask_company_template: "Perfecto 😊 ¿Me indicas el nombre de la compañía actual?",
  ask_rut_template: "Excelente, ahora por último indícame tu número de RUT para así validar tu oferta disponible.",
  confirm_template: "Genial 🙌 Tu chat será transferido a una de nuestras ejecutivas, por favor espera un momento en línea.",
  decline_template: null as string | null,
  active: true,
};

// Config del bot de captación de leads asociada a UNA plantilla (una
// campaña con botones SÍ/NO específica) de UN número — a diferencia del bot
// de encuestas (una config por número), acá puede haber varias campañas de
// captación distintas en el mismo número, cada una con su propia plantilla.
export async function GET(request: NextRequest) {
  const ctx = await usuarioYMiembro(request);
  if (!ctx) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const { supabase, miembro } = ctx;

  const phoneNumberId = request.nextUrl.searchParams.get("phone_number_id");
  const plantillaId = request.nextUrl.searchParams.get("plantilla_id");
  if (!phoneNumberId || !plantillaId) {
    return Response.json({ error: "Faltan 'phone_number_id' o 'plantilla_id'" }, { status: 400 });
  }

  const { data: cliente } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id")
    .eq("phone_number_id", phoneNumberId)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  try {
    const { data, error } = await supabase
      .from("dulabs_campaign_bot_config")
      .select("*")
      .eq("phone_number_id", phoneNumberId)
      .eq("plantilla_id", Number(plantillaId))
      .eq("id_tenant", miembro.tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ phone_number_id: phoneNumberId, plantilla_id: Number(plantillaId), ...DEFAULTS, existe: false });
    return Response.json({ ...data, existe: true });
  } catch {
    // Tabla todavía no existe (migración pendiente): degradar a defaults sin romper el dashboard.
    return Response.json({ phone_number_id: phoneNumberId, plantilla_id: Number(plantillaId), ...DEFAULTS, existe: false });
  }
}

type Body = {
  phone_number_id?: string;
  plantilla_id?: number;
  campaign_label?: string;
  yes_button_text?: string;
  no_button_text?: string;
  ask_data_template?: string;
  ask_company_template?: string;
  ask_rut_template?: string;
  confirm_template?: string;
  decline_template?: string | null;
  active?: boolean;
};

export async function PATCH(request: NextRequest) {
  const ctx = await usuarioYMiembro(request);
  if (!ctx) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const { supabase, miembro } = ctx;
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id, plantilla_id } = body;
  if (!phone_number_id || !plantilla_id) {
    return Response.json({ error: "Faltan 'phone_number_id' o 'plantilla_id'" }, { status: 400 });
  }

  const { data: cliente } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id")
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const { data: plantilla } = await supabase
    .from("dulabs_plantillas")
    .select("id")
    .eq("id", plantilla_id)
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (!plantilla) return Response.json({ error: "Plantilla no encontrada para este número" }, { status: 404 });

  const CAMPOS_PERMITIDOS = [
    "campaign_label",
    "yes_button_text",
    "no_button_text",
    "ask_data_template",
    "ask_company_template",
    "ask_rut_template",
    "confirm_template",
    "decline_template",
    "active",
  ] as const satisfies readonly (keyof Body)[];
  const cambios: Partial<Body> = {};
  for (const campo of CAMPOS_PERMITIDOS) {
    if (campo in body) cambios[campo] = body[campo] as never;
  }

  try {
    const { error } = await supabase.from("dulabs_campaign_bot_config").upsert(
      {
        id_tenant: miembro.tenantId,
        phone_number_id,
        plantilla_id,
        ...cambios,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number_id,plantilla_id" }
    );
    if (error) {
      return Response.json({ error: `No se pudo guardar: ${error.message}` }, { status: 503 });
    }
    return Response.json({ success: true });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `No se pudo guardar: ${mensaje}` }, { status: 503 });
  }
}
