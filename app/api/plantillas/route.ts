import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  crearPlantillaMeta,
  consultarEstadoPlantilla,
  normalizarNombrePlantilla,
  contarVariablesPlantilla,
  MAX_BOTONES_PLANTILLA,
  MAX_BOTONES_CTA,
  MAX_CARACTERES_BOTON,
  type FormatoHeaderPlantilla,
  type BotonCTA,
} from "@/lib/meta-templates";
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

// Lista las plantillas del tenant, refrescando el estado real desde Meta
// para las que siguen "pendiente" (Meta las revisa de forma asíncrona).
export async function GET(request: NextRequest) {
  const user = await usuarioDeSesion(request);
  if (!user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const supabase = supabaseAdmin();
  const miembro = await resolverMiembroEquipo(supabase, user.id);
  if (!miembro) return Response.json({ error: "No perteneces a ningún equipo activo" }, { status: 403 });

  const { data: plantillas, error } = await supabase
    .from("dulabs_plantillas")
    .select("*")
    .eq("id_tenant", miembro.tenantId)
    .order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const pendientes = (plantillas ?? []).filter((p) => p.estado === "pendiente" || p.estado === "PENDING");
  if (pendientes.length > 0) {
    const { data: negocios } = await supabase
      .from("dulabs_clientes_config")
      .select("phone_number_id, meta_permanent_token")
      .eq("id_tenant", miembro.tenantId);
    const tokenPorNumero = new Map(
      (negocios ?? []).map((n) => [n.phone_number_id, n.meta_permanent_token ? descifrarSecreto(n.meta_permanent_token) : null])
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
  const miembro = await resolverMiembroEquipo(supabaseAdmin(), user.id);
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  let body: {
    id?: number;
    phone_number_id?: string;
    nombre?: string;
    categoria?: string;
    idioma?: string;
    cuerpo?: string;
    footer?: string | null;
    botones?: string[];
    botones_cta?: BotonCTA[];
    header_formato?: FormatoHeaderPlantilla | null;
    header_texto?: string | null;
    header_ejemplo?: string | null;
    header_ejemplo_handle?: string | null;
    variables_ejemplo?: string[];
    borrador?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { id, phone_number_id, nombre, categoria, cuerpo, borrador } = body;
  const idioma = body.idioma || "es_CO";
  const footer = body.footer?.trim() || null;
  if (!phone_number_id || !nombre || !categoria || !cuerpo) {
    return Response.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }
  if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(categoria)) {
    return Response.json({ error: "Categoría inválida" }, { status: 400 });
  }
  const botones = (body.botones ?? []).map((b) => b.trim()).filter(Boolean).slice(0, MAX_BOTONES_PLANTILLA);
  if (botones.some((b) => b.length > MAX_CARACTERES_BOTON)) {
    return Response.json({ error: `Cada botón puede tener máximo ${MAX_CARACTERES_BOTON} caracteres` }, { status: 400 });
  }
  const botonesCta = (body.botones_cta ?? []).slice(0, MAX_BOTONES_CTA);
  if (botonesCta.some((b) => !b.texto?.trim() || !b.valor?.trim() || (b.tipo !== "URL" && b.tipo !== "PHONE_NUMBER"))) {
    return Response.json({ error: "Cada botón de llamada a la acción necesita tipo, texto y valor (URL o teléfono)" }, { status: 400 });
  }
  if (botonesCta.some((b) => b.texto.length > MAX_CARACTERES_BOTON)) {
    return Response.json({ error: `Cada botón puede tener máximo ${MAX_CARACTERES_BOTON} caracteres` }, { status: 400 });
  }

  const headerFormato = body.header_formato ?? null;
  if (headerFormato && !["TEXT", "IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormato)) {
    return Response.json({ error: "Formato de encabezado inválido" }, { status: 400 });
  }
  const headerTexto = headerFormato === "TEXT" ? (body.header_texto?.trim() ?? "") : null;
  if (headerFormato === "TEXT" && !headerTexto) {
    return Response.json({ error: "El encabezado de texto no puede estar vacío" }, { status: 400 });
  }
  const headerEjemplo = headerFormato === "TEXT" ? (body.header_ejemplo?.trim() || null) : null;
  if (headerFormato === "TEXT" && /\{\{1\}\}/.test(headerTexto ?? "") && !headerEjemplo) {
    return Response.json({ error: "El encabezado tiene una variable {{1}}: falta el valor de ejemplo" }, { status: 400 });
  }
  if (headerFormato && headerFormato !== "TEXT" && !body.header_ejemplo_handle) {
    return Response.json({ error: "Falta subir el archivo de ejemplo del encabezado" }, { status: 400 });
  }

  // Meta exige un valor de ejemplo por cada variable {{n}} del BODY para
  // poder aprobar la plantilla -- se cuentan las mismas {{n}} que ya usa el
  // envío real (contarVariablesPlantilla), nunca una cuenta inventada aparte.
  const numeroVariables = contarVariablesPlantilla(cuerpo);
  const variablesEjemplo = (body.variables_ejemplo ?? []).map((v) => v?.trim() ?? "").slice(0, numeroVariables);
  if (numeroVariables > 0 && (variablesEjemplo.length !== numeroVariables || variablesEjemplo.some((v) => !v))) {
    return Response.json(
      { error: `El mensaje tiene ${numeroVariables} variable${numeroVariables === 1 ? "" : "s"} ({{1}}${numeroVariables > 1 ? `..{{${numeroVariables}}}` : ""}): falta el valor de ejemplo de cada una` },
      { status: 400 }
    );
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

  const nombreNormalizado = normalizarNombrePlantilla(nombre);

  // Campos compartidos entre borrador y creación real -- una sola fuente
  // para no repetir (y arriesgar desincronizar) la misma lista 4 veces.
  const camposComunes = {
    nombre: nombreNormalizado,
    categoria,
    idioma,
    cuerpo,
    footer,
    botones,
    botones_cta: botonesCta,
    header_formato: headerFormato,
    header_texto: headerTexto,
    header_ejemplo: headerEjemplo,
    variables_ejemplo: variablesEjemplo,
  };

  // Guardar (o actualizar) como borrador local: no se toca Meta todavía.
  if (borrador) {
    if (id) {
      const { error: updateError } = await supabase
        .from("dulabs_plantillas")
        .update(camposComunes)
        .eq("id", id)
        .eq("id_tenant", miembro.tenantId)
        .eq("borrador", true);
      if (updateError) return Response.json({ error: updateError.message }, { status: 500 });
      return Response.json({ success: true, estado: "borrador" });
    }
    const { error: insertError } = await supabase.from("dulabs_plantillas").insert({
      id_tenant: miembro.tenantId,
      phone_number_id,
      whatsapp_business_account_id: cliente.whatsapp_business_account_id,
      ...camposComunes,
      estado: "borrador",
      borrador: true,
    });
    if (insertError) return Response.json({ error: insertError.message }, { status: 500 });
    return Response.json({ success: true, estado: "borrador" });
  }

  const token = cliente.meta_permanent_token ? descifrarSecreto(cliente.meta_permanent_token) : process.env.META_ACCESS_TOKEN;
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
      footer,
      botones,
      botonesCta,
      ejemplosVariables: variablesEjemplo,
      header: headerFormato
        ? {
            formato: headerFormato,
            texto: headerTexto ?? undefined,
            ejemploTexto: headerEjemplo ?? undefined,
            ejemploHandle: body.header_ejemplo_handle ?? undefined,
          }
        : null,
    });

    // Promover un borrador existente en vez de insertar una fila duplicada.
    if (id) {
      const { error: promoteError } = await supabase
        .from("dulabs_plantillas")
        .update({
          ...camposComunes,
          meta_template_id: resultado.id,
          estado: resultado.status,
          borrador: false,
        })
        .eq("id", id)
        .eq("id_tenant", miembro.tenantId)
        .eq("borrador", true);
      if (promoteError) throw new Error(promoteError.message);
      return Response.json({ success: true, estado: resultado.status });
    }

    const { error: dbError } = await supabase.from("dulabs_plantillas").insert({
      id_tenant: miembro.tenantId,
      phone_number_id,
      whatsapp_business_account_id: cliente.whatsapp_business_account_id,
      ...camposComunes,
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
