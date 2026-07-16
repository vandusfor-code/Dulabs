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

  // Consumo real por plantilla (enviados y % de lectura), a partir de las
  // campañas que la usaron y el estado de entrega real de esos mensajes.
  const idsPlantillas = (plantillas ?? []).map((p) => p.id);
  const estadisticas = new Map<number, { enviados: number; leidos: number }>();
  if (idsPlantillas.length > 0) {
    const { data: campanas } = await supabase
      .from("dulabs_campanas")
      .select("id, plantilla_id")
      .in("plantilla_id", idsPlantillas);
    const plantillaPorCampana = new Map((campanas ?? []).map((c) => [c.id, c.plantilla_id as number]));
    const idsCampanas = (campanas ?? []).map((c) => c.id);

    if (idsCampanas.length > 0) {
      const { data: mensajes } = await supabase
        .from("dulabs_mensajes_log")
        .select("campana_id, estado_entrega")
        .in("campana_id", idsCampanas);
      for (const m of mensajes ?? []) {
        const plantillaId = plantillaPorCampana.get(m.campana_id);
        if (!plantillaId) continue;
        const acc = estadisticas.get(plantillaId) ?? { enviados: 0, leidos: 0 };
        acc.enviados++;
        if (m.estado_entrega === "leido") acc.leidos++;
        estadisticas.set(plantillaId, acc);
      }
    }
  }

  const plantillasConStats = (plantillas ?? []).map((p) => {
    const stats = estadisticas.get(p.id) ?? { enviados: 0, leidos: 0 };
    return {
      ...p,
      enviados: stats.enviados,
      tasaLectura: stats.enviados > 0 ? stats.leidos / stats.enviados : 0,
    };
  });

  return Response.json({ plantillas: plantillasConStats });
}

// Crea una plantilla nueva (o la somete a revisión si ya existía como
// borrador local) y la envía a la API de Meta para aprobación, salvo que se
// pida guardarla como borrador (sin tocar Meta todavía).
export async function POST(request: NextRequest) {
  const user = await usuarioDeSesion(request);
  if (!user) return Response.json({ error: "Sesión inválida" }, { status: 401 });

  let body: {
    id?: number;
    phone_number_id?: string;
    nombre?: string;
    categoria?: string;
    idioma?: string;
    cuerpo?: string;
    borrador?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { id, phone_number_id, nombre, categoria, cuerpo, borrador } = body;
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

  const nombreNormalizado = normalizarNombrePlantilla(nombre);

  // Guardar (o actualizar) como borrador local: no se toca Meta todavía.
  if (borrador) {
    if (id) {
      const { error: updateError } = await supabase
        .from("dulabs_plantillas")
        .update({ nombre: nombreNormalizado, categoria, idioma, cuerpo })
        .eq("id", id)
        .eq("id_tenant", user.id)
        .eq("borrador", true);
      if (updateError) return Response.json({ error: updateError.message }, { status: 500 });
      return Response.json({ success: true, estado: "borrador" });
    }
    const { error: insertError } = await supabase.from("dulabs_plantillas").insert({
      id_tenant: user.id,
      phone_number_id,
      whatsapp_business_account_id: cliente.whatsapp_business_account_id,
      nombre: nombreNormalizado,
      categoria,
      idioma,
      cuerpo,
      estado: "borrador",
      borrador: true,
    });
    if (insertError) return Response.json({ error: insertError.message }, { status: 500 });
    return Response.json({ success: true, estado: "borrador" });
  }

  const token = cliente.meta_permanent_token || process.env.META_ACCESS_TOKEN;
  if (!token) {
    return Response.json({ error: "Sin token de Meta configurado para este número" }, { status: 500 });
  }

  try {
    const resultado = await crearPlantillaMeta({
      wabaId: cliente.whatsapp_business_account_id,
      token,
      nombre: nombreNormalizado,
      categoria,
      idioma,
      cuerpo,
    });

    // Promover un borrador existente en vez de insertar una fila duplicada.
    if (id) {
      const { error: promoteError } = await supabase
        .from("dulabs_plantillas")
        .update({
          nombre: nombreNormalizado,
          categoria,
          idioma,
          cuerpo,
          meta_template_id: resultado.id,
          estado: resultado.status,
          borrador: false,
        })
        .eq("id", id)
        .eq("id_tenant", user.id)
        .eq("borrador", true);
      if (promoteError) throw new Error(promoteError.message);
      return Response.json({ success: true, estado: resultado.status });
    }

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
