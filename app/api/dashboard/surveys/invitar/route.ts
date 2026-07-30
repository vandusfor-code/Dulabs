import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { descifrarSecreto } from "@/lib/crypto";
import { enviarTexto, dentroVentana24h } from "@/lib/whatsapp";
import { enviarPlantilla } from "@/lib/meta-templates";
import { getSurveyBot, createSessionRow } from "@/lib/survey-bot-store";
import { inviteSurvey } from "@/lib/survey-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

function soloDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

/**
 * Envía la invitación inicial de la encuesta predeterminada a una lista de
 * destinatarios: crea (o reinicia) su sesión y entrega el primer mensaje.
 *
 * - Si el contacto escribió en las últimas 24h, se envía el saludo
 *   personalizado en texto libre directamente (más rico, con el nombre real
 *   de la marca).
 * - Si no, WhatsApp exige una plantilla aprobada: se usa la configurada en
 *   `invite_template_name` (ver /dashboard/plantillas). Si esa plantilla
 *   todavía no está aprobada, ese destinatario queda marcado como fallido con
 *   un motivo claro — no se inventa un envío.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  let body: { phone_number_id?: string; destinatarios?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id, destinatarios } = body;
  if (!phone_number_id || !destinatarios?.length) {
    return Response.json({ error: "Faltan 'phone_number_id' o 'destinatarios'" }, { status: 400 });
  }

  const { data: cliente, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select("*")
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const bot = await getSurveyBot(supabase, phone_number_id);
  if (!bot) {
    return Response.json(
      { error: "Este número no tiene el bot de encuestas activo. Configúralo en Agentes de IA → Bot de encuestas." },
      { status: 400 }
    );
  }

  const metaToken = cliente.meta_permanent_token ? descifrarSecreto(cliente.meta_permanent_token) : process.env.META_ACCESS_TOKEN;
  if (!metaToken) return Response.json({ error: "Sin token de Meta para este número" }, { status: 500 });

  // La plantilla de invitación solo hace falta para quien esté FUERA de la
  // ventana de 24h; se resuelve una vez y se reutiliza para todo el lote.
  const { data: plantillaInvitacion } = await supabase
    .from("dulabs_plantillas")
    .select("nombre, idioma, estado")
    .eq("phone_number_id", phone_number_id)
    .eq("nombre", bot.inviteTemplateName)
    .maybeSingle();

  let enviados = 0;
  const fallidos: { destinatario: string; error: string }[] = [];

  for (const destinatario of destinatarios) {
    const numero = soloDigitos(destinatario);
    if (!numero) continue;
    try {
      const dentroVentana = await dentroVentana24h(supabase, phone_number_id, numero);

      const session = await createSessionRow(supabase, phone_number_id, numero, bot.closeDate);
      if (!session) {
        throw new Error(
          "La tabla de sesiones del bot de encuestas no existe todavía (falta correr la migración 20260730090000_survey_bot.sql)."
        );
      }

      if (dentroVentana) {
        const resultado = inviteSurvey(bot.config, bot.questions, session);
        for (const texto of resultado.messages) {
          const { wamid } = await enviarTexto({ phoneNumberId: phone_number_id, token: metaToken, para: numero, texto });
          await supabase.from("dulabs_mensajes_log").insert({
            phone_number_id,
            telefono_cliente: numero,
            direccion: "saliente",
            contenido: texto,
            origen: "agente",
            wamid,
          });
        }
      } else {
        if (!plantillaInvitacion || plantillaInvitacion.estado !== "APPROVED") {
          throw new Error(
            `Fuera de la ventana de 24h y la plantilla "${bot.inviteTemplateName}" aún no está aprobada por Meta (créala en Plantillas).`
          );
        }
        const { wamid } = await enviarPlantilla({
          phoneNumberId: phone_number_id,
          token: metaToken,
          para: numero,
          nombrePlantilla: plantillaInvitacion.nombre,
          idioma: plantillaInvitacion.idioma,
        });
        await supabase.from("dulabs_mensajes_log").insert({
          phone_number_id,
          telefono_cliente: numero,
          direccion: "saliente",
          contenido: `[Invitación de encuesta] ${plantillaInvitacion.nombre}`,
          origen: "agente",
          wamid,
        });
      }
      enviados++;
    } catch (err) {
      fallidos.push({ destinatario: numero, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return Response.json({ enviados, fallidos });
}
