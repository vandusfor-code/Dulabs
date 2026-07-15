import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { enviarPlantilla } from "@/lib/meta-templates";

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

  const { data: plantilla, error: plantillaError } = await supabase
    .from("dulabs_plantillas")
    .select("*")
    .eq("id", plantilla_id)
    .eq("id_tenant", userData.user.id)
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
    .maybeSingle();
  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const metaToken = cliente.meta_permanent_token || process.env.META_ACCESS_TOKEN;
  if (!metaToken) {
    return Response.json({ error: "Sin token de Meta para este número" }, { status: 500 });
  }

  const { data: campana, error: campanaError } = await supabase
    .from("dulabs_campanas")
    .insert({
      id_tenant: userData.user.id,
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

  for (const destinatario of destinatarios) {
    const numero = destinatario.replace(/\D/g, "");
    try {
      const { wamid } = await enviarPlantilla({
        phoneNumberId: plantilla.phone_number_id,
        token: metaToken,
        para: numero,
        nombrePlantilla: plantilla.nombre,
        idioma: plantilla.idioma,
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
}
