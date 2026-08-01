import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { enviarPlantilla, contarVariablesPlantilla } from "@/lib/meta-templates";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { descifrarSecreto } from "@/lib/crypto";
import { planDelTenant } from "@/lib/plan-limits";
import { parseDestinatario } from "@/lib/destinatarios";

export const runtime = "nodejs";
export const maxDuration = 60;

function mesActualISO(): string {
  return new Date().toISOString().slice(0, 7);
}

// Envía una plantilla aprobada a una lista de destinatarios (campaña masiva).
// Cada envío exitoso queda en el historial y cuenta contra el límite mensual.
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

  let body: { plantilla_id?: number; destinatarios?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { plantilla_id, destinatarios } = body;
  if (!plantilla_id || !destinatarios?.length) {
    return Response.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const plan = await planDelTenant(supabase, miembro.tenantId);
  if (plan.limites.contactosPorCampana !== null && destinatarios.length > plan.limites.contactosPorCampana) {
    return Response.json(
      {
        error: `Tu plan ${plan.nombre} permite máximo ${plan.limites.contactosPorCampana.toLocaleString("es-CO")} contactos por campaña (enviaste ${destinatarios.length.toLocaleString("es-CO")}). Mejora tu plan para llegar a más contactos de una vez.`,
      },
      { status: 400 }
    );
  }

  const { data: plantilla, error: plantillaError } = await supabase
    .from("dulabs_plantillas")
    .select("*")
    .eq("id", plantilla_id)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (plantillaError) return Response.json({ error: plantillaError.message }, { status: 500 });
  if (!plantilla) return Response.json({ error: "Plantilla no encontrada" }, { status: 404 });
  if (plantilla.estado !== "APPROVED") {
    return Response.json(
      { error: `La plantilla todavía no está aprobada (estado: ${plantilla.estado})` },
      { status: 400 }
    );
  }

  const { data: cliente, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select("*")
    .eq("phone_number_id", plantilla.phone_number_id)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const metaToken = cliente.meta_permanent_token ? descifrarSecreto(cliente.meta_permanent_token) : process.env.META_ACCESS_TOKEN;
  if (!metaToken) {
    return Response.json({ error: "Sin token de Meta para este número" }, { status: 500 });
  }

  // Candado de concurrencia: reserva atómica en Postgres (evita la carrera
  // de leer-decidir-escribir que tendría hacerlo desde aquí con dos
  // llamadas REST separadas). Si ya hay tantas campañas en curso como
  // permite el plan, se rechaza antes de crear nada.
  const maxSimultaneas = plan.limites.campanasSimultaneas;
  if (maxSimultaneas !== null) {
    const { data: reservado, error: rpcError } = await supabase.rpc("dulabs_intentar_iniciar_campana", {
      p_tenant: miembro.tenantId,
      p_max: maxSimultaneas,
    });
    if (rpcError) return Response.json({ error: rpcError.message }, { status: 500 });
    if (!reservado) {
      return Response.json(
        {
          error: `Ya tienes ${maxSimultaneas} campaña${maxSimultaneas === 1 ? "" : "s"} en curso, el máximo de tu plan ${plan.nombre}. Espera a que termine${maxSimultaneas === 1 ? "" : "n"} o mejora tu plan.`,
        },
        { status: 429 }
      );
    }
  }

  try {
    const { data: campana, error: campanaError } = await supabase
      .from("dulabs_campanas")
      .insert({
        id_tenant: miembro.tenantId,
        phone_number_id: plantilla.phone_number_id,
        plantilla_id: plantilla.id,
        nombre: plantilla.nombre,
        destinatarios_total: destinatarios.length,
      })
      .select("id")
      .single();
    if (campanaError) return Response.json({ error: campanaError.message }, { status: 500 });

    let enviados = 0;
    const fallidos: { destinatario: string; error: string }[] = [];
    // Si la plantilla tiene exactamente una variable posicional ({{1}}), se
    // asume que es el nombre del cliente y se rellena con el nombre que
    // trajo cada destinatario ("teléfono, Nombre" — a mano o importado de
    // Excel). Si no trajo nombre, o la plantilla no tiene esa variable, se
    // envía sin personalizar (igual que antes).
    const tieneVariableNombre = contarVariablesPlantilla(plantilla.cuerpo) === 1;

    for (const linea of destinatarios) {
      const { telefono: numero, nombre } = parseDestinatario(linea);
      if (!numero) continue;
      try {
        const { wamid } = await enviarPlantilla({
          phoneNumberId: plantilla.phone_number_id,
          token: metaToken,
          para: numero,
          nombrePlantilla: plantilla.nombre,
          idioma: plantilla.idioma,
          parametrosPosicionales: tieneVariableNombre ? [nombre || "cliente"] : undefined,
        });
        await supabase.from("dulabs_mensajes_log").insert({
          phone_number_id: plantilla.phone_number_id,
          telefono_cliente: numero,
          direccion: "saliente",
          contenido: `[Campaña: ${plantilla.nombre}] ${plantilla.cuerpo}`,
          campana_id: campana.id,
          wamid,
          origen: "campaña",
        });
        enviados++;
      } catch (err) {
        fallidos.push({ destinatario: numero, error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (enviados > 0) {
      const mesHoy = mesActualISO();
      const nuevoUsados = cliente.mes_actual === mesHoy ? cliente.mensajes_usados_mes + enviados : enviados;
      await supabase
        .from("dulabs_clientes_config")
        .update({ mensajes_usados_mes: nuevoUsados, mes_actual: mesHoy })
        .eq("id", cliente.id);
    }

    return Response.json({ enviados, fallidos });
  } finally {
    if (maxSimultaneas !== null) {
      await supabase.rpc("dulabs_finalizar_campana", { p_tenant: miembro.tenantId });
    }
  }
}
