import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { enviarPlantilla, contarVariablesPlantilla } from "@/lib/meta-templates";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { descifrarSecreto } from "@/lib/crypto";
import { planDelTenant } from "@/lib/plan-limits";
import { esSinPlan, MENSAJE_SIN_PLAN } from "@/lib/planes";
import { parseDestinatario } from "@/lib/destinatarios";
import { getCampaignBotConfig, crearCampaignLeadRow } from "@/lib/campaign-lead-store";
import { obtenerCreditosMasivos, consumirCreditosMasivos, reembolsarCreditosMasivos, mensajeSaldoInsuficiente } from "@/lib/campanas-creditos";

export const runtime = "nodejs";
// El envío es secuencial (una llamada real a Meta por destinatario) y una
// campaña grande completa igual se puede acercar a este límite -- por eso
// el frontend (app/dashboard/campanas/page.tsx) manda la lista en LOTES
// chicos (ver `campana_id`/`es_ultimo_lote` abajo) en vez de todo de una
// sola llamada: así cada request individual termina rápido y sobra margen,
// sin importar cuántos destinatarios tenga la campaña completa. maxDuration
// se deja alto igual, como colchón para un lote inusualmente lento.
export const maxDuration = 300;

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

  let body: {
    plantilla_id?: number;
    destinatarios?: string[];
    header_media_id?: string;
    /** Si viene, este lote se suma a una campaña YA creada por un lote
     * anterior, en vez de crear una fila nueva -- ver el envío por lotes
     * del frontend. */
    campana_id?: number;
    /** Total real de destinatarios de la campaña completa (todos los
     * lotes juntos), usado solo al crear la fila y validar límites del
     * plan -- si no viene, se asume que este lote ES toda la campaña
     * (compatibilidad con un envío sin lotes). */
    destinatarios_total?: number;
    /** false en todos los lotes menos el último -- controla cuándo se
     * libera el candado de concurrencia de campañas. */
    es_ultimo_lote?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { plantilla_id, destinatarios, header_media_id, campana_id, es_ultimo_lote = true } = body;
  if (!plantilla_id || !destinatarios?.length) {
    return Response.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }
  const totalCampana = body.destinatarios_total ?? destinatarios.length;

  const plan = await planDelTenant(supabase, miembro.tenantId);
  // Los límites del plan (contactos por campaña, campañas por mes) se
  // validan contra el TOTAL de la campaña completa, y solo en el primer
  // lote -- ya se validaron cuando se creó la fila, repetirlos en cada
  // lote solo agregaría trabajo sin sentido.
  if (!campana_id) {
    if (plan.limites.contactosPorCampana !== null && totalCampana > plan.limites.contactosPorCampana) {
      return Response.json(
        {
          error: esSinPlan(plan)
            ? MENSAJE_SIN_PLAN
            : `Tu plan ${plan.nombre} permite máximo ${plan.limites.contactosPorCampana.toLocaleString("es-CO")} contactos por campaña (enviaste ${totalCampana.toLocaleString("es-CO")}). Mejora tu plan para llegar a más contactos de una vez.`,
        },
        { status: 400 }
      );
    }

    // Límite de campañas por mes del plan (cuántas se pueden enviar desde el
    // panel, no cuántas simultáneas). Se cuentan las campañas del tenant
    // creadas desde el 1° del mes en curso.
    if (plan.limites.campanasPorMes !== null) {
      const inicioMes = `${mesActualISO()}-01T00:00:00`;
      const { count: campanasEsteMes } = await supabase
        .from("dulabs_campanas")
        .select("id", { count: "exact", head: true })
        .eq("id_tenant", miembro.tenantId)
        .gte("created_at", inicioMes);
      if ((campanasEsteMes ?? 0) >= plan.limites.campanasPorMes) {
        return Response.json(
          {
            error: esSinPlan(plan)
              ? MENSAJE_SIN_PLAN
              : `Tu plan ${plan.nombre} permite ${plan.limites.campanasPorMes} campaña${plan.limites.campanasPorMes === 1 ? "" : "s"} al mes y ya las usaste todas. Mejora tu plan para enviar más este mes.`,
          },
          { status: 400 }
        );
      }
    }

    // Saldo de mensajes masivos de cortesía (independiente del cupo mensual
    // de IA conversacional, ver lib/plan-limits.ts): se reserva ATÓMICAMENTE
    // el total real de la campaña completa, ANTES de crear la fila y de
    // mandar un solo mensaje -- si el saldo no alcanza, se rechaza la
    // campaña ENTERA acá mismo, nunca se envía una parte. Solo en el primer
    // lote: los lotes siguientes de la misma campaña ya están cubiertos por
    // esta misma reserva.
    const reservado = await consumirCreditosMasivos(supabase, miembro.tenantId, totalCampana);
    if (!reservado) {
      const creditos = await obtenerCreditosMasivos(supabase, miembro.tenantId);
      // null = este tenant no tiene fila de créditos (nunca se le asignó
      // cortesía/paquete) -- no está sujeto a este límite todavía, se deja
      // pasar (comportamiento de hoy, sin cambios) en vez de bloquearlo por
      // un límite que no le aplica.
      if (creditos) {
        return Response.json({ error: mensajeSaldoInsuficiente(creditos.disponibles, totalCampana) }, { status: 400 });
      }
    }
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
  if (plantilla.header_formato && !header_media_id) {
    return Response.json(
      { error: `Esta plantilla necesita un archivo de encabezado (${plantilla.header_formato.toLowerCase()}) -- súbelo antes de enviar.` },
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
  // permite el plan, se rechaza antes de crear nada. Se reserva SOLO en el
  // primer lote (campana_id vacío) -- los lotes siguientes de la misma
  // campaña ya están cubiertos por esa misma reserva, y se libera solo en
  // el último lote (ver el finally más abajo).
  const maxSimultaneas = plan.limites.campanasSimultaneas;
  if (maxSimultaneas !== null && !campana_id) {
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
    let campana: { id: number };
    if (campana_id) {
      const { data: existente, error: existenteError } = await supabase
        .from("dulabs_campanas")
        .select("id")
        .eq("id", campana_id)
        .eq("id_tenant", miembro.tenantId)
        .maybeSingle();
      if (existenteError) return Response.json({ error: existenteError.message }, { status: 500 });
      if (!existente) return Response.json({ error: "Campaña no encontrada" }, { status: 404 });
      campana = existente;
    } else {
      const { data: creada, error: campanaError } = await supabase
        .from("dulabs_campanas")
        .insert({
          id_tenant: miembro.tenantId,
          phone_number_id: plantilla.phone_number_id,
          plantilla_id: plantilla.id,
          nombre: plantilla.nombre,
          destinatarios_total: totalCampana,
        })
        .select("id")
        .single();
      if (campanaError) return Response.json({ error: campanaError.message }, { status: 500 });
      campana = creada;
    }

    // Si esta plantilla tiene un bot de captación de leads configurado (ver
    // POST /api/dashboard/campaign-bot-config), cada destinatario que reciba
    // el envío exitosamente queda con una sesión de captación esperando su
    // respuesta SÍ/NO — el webhook (atenderMensajeCampaña) la revisa antes
    // de cualquier otro flujo.
    const botConfig = await getCampaignBotConfig(supabase, plantilla.phone_number_id, plantilla.id);

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
          headerMedia:
            plantilla.header_formato && header_media_id
              ? { formato: plantilla.header_formato, mediaId: header_media_id }
              : undefined,
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
        if (botConfig) {
          await crearCampaignLeadRow(supabase, {
            idTenant: miembro.tenantId,
            phoneNumberId: plantilla.phone_number_id,
            telefonoCliente: numero,
            campanaId: campana.id,
            plantillaId: plantilla.id,
            customerName: nombre || null,
          });
        }
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

    // El saldo de mensajes masivos se reservó por el TOTAL de la campaña en
    // el primer lote (arriba); acá se devuelve lo reservado de más para los
    // destinatarios que Meta terminó rechazando en ESTE lote -- así el saldo
    // final refleja únicamente envíos realmente aceptados, nunca intentos
    // fallidos. Se hace lote por lote (no solo en el último) para no tener
    // que acumular estado entre requests.
    if (fallidos.length > 0) {
      await reembolsarCreditosMasivos(supabase, miembro.tenantId, fallidos.length);
    }
    // Auditoría: acumula (no sobreescribe) cuántos destinatarios de la
    // campaña consumieron un crédito de verdad, lote a lote.
    if (enviados > 0) {
      const { data: campanaActual } = await supabase
        .from("dulabs_campanas")
        .select("mensajes_masivos_consumidos")
        .eq("id", campana.id)
        .single();
      await supabase
        .from("dulabs_campanas")
        .update({ mensajes_masivos_consumidos: (campanaActual?.mensajes_masivos_consumidos ?? 0) + enviados })
        .eq("id", campana.id);
    }

    return Response.json({ campana_id: campana.id, enviados, fallidos });
  } finally {
    // Libera el candado solo cuando de verdad se terminó la campaña -- si
    // quedan más lotes, sigue reservado para que otra campaña no arranque
    // "encima" de esta mientras el frontend sigue mandando el resto.
    if (maxSimultaneas !== null && es_ultimo_lote) {
      await supabase.rpc("dulabs_finalizar_campana", { p_tenant: miembro.tenantId });
    }
  }
}
