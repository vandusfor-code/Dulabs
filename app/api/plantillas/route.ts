import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  crearPlantillaMeta,
  consultarEstadoPlantilla,
  normalizarNombrePlantilla,
} from "@/lib/meta-templates";

export const runtime = "nodejs";

async function usuarioDeSesion(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

// Lista las plantillas del tenant, refrescando el estado real desde Meta
// para las que siguen "pendiente" (Meta las revisa de forma asíncrona).
export async function GET(request: NextRequest) {
  const user = await usuarioDeSesion(request);
  if (!user) return Response.json({ error: "Sesión inválida" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: plantillas, error } = await supabase
    .from("dulabs_plantillas")
    .select("*")
    .eq("id_tenant", user.id)
    .order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const pendientes = (plantillas ?? []).filter((p) => p.estado === "pendiente" || p.estado === "PENDING");
  if (pendientes.length > 0) {
    const { data: negocios } = await supabase
      .from("dulabs_clientes_config")
      .select("phone_number_id, meta_permanent_token")
      .eq("id_tenant", user.id);
    const tokenPorNumero = new Map(
      (negocios ?? []).map((n) => [n.phone_number_id, n.meta_permanent_token as string | null])
    );

    await Promise.all(
      pendientes.map(async (p) => {
        const token = tokenPorNumero.get(p.phone_number_id) || process.env.META_ACCESS_TOKEN;
        if (!token) return;
        const estadoReal = await consultarEstadoPlantilla({
          wabaId: p.whatsapp_business_account_id,
          token,
          nombre: p.nombre,
        });
        if (estadoReal && estadoReal !== p.estado) {
          await supabase.from("dulabs_plantillas").update({ estado: estadoReal }).eq("id", p.id);
          p.estado = estadoReal;
        }
      })
    );
  }

  return Response.json({ plantillas });
}

// Crea una plantilla nueva y la somete a la API de Meta para aprobación.
export async function POST(request: NextRequest) {
  const user = await usuarioDeSesion(request);
  if (!user) return Response.json({ error: "Sesión inválida" }, { status: 401 });

  let body: {
    phone_number_id?: string;
    nombre?: string;
    categoria?: string;
    idioma?: string;
    cuerpo?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { phone_number_id, nombre, categoria, cuerpo } = body;
  const idioma = body.idioma || "es_CO";
  if (!phone_number_id || !nombre || !categoria || !cuerpo) {
    return Response.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }
  if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(categoria)) {
    return Response.json({ error: "Categoría inválida" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { data: cliente, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select("whatsapp_business_account_id, meta_permanent_token")
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", user.id)
    .maybeSingle();
  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const token = cliente.meta_permanent_token || process.env.META_ACCESS_TOKEN;
  if (!token) {
    return Response.json({ error: "Sin token de Meta configurado para este número" }, { status: 500 });
  }

  const nombreNormalizado = normalizarNombrePlantilla(nombre);

  try {
    const resultado = await crearPlantillaMeta({
      wabaId: cliente.whatsapp_business_account_id,
      token,
      nombre: nombreNormalizado,
      categoria,
      idioma,
      cuerpo,
    });

    const { error: dbError } = await supabase.from("dulabs_plantillas").insert({
      id_tenant: user.id,
      phone_number_id,
      whatsapp_business_account_id: cliente.whatsapp_business_account_id,
      nombre: nombreNormalizado,
      categoria,
      idioma,
      cuerpo,
      meta_template_id: resultado.id,
      estado: resultado.status,
    });
    if (dbError) throw new Error(dbError.message);

    return Response.json({ success: true, estado: resultado.status });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
