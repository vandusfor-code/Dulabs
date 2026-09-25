import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { enviarTexto, enviarMedia, dentroVentana24h, type WhatsAppMediaType } from "@/lib/whatsapp";
import { descifrarSecreto } from "@/lib/crypto";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { renovarPausaPorIntervencionHumana } from "@/lib/flow/pausa-intervencion-humana";

export const runtime = "nodejs";

// Historial reciente de mensajes de todos los números del tenant, para la
// vista de actividad del dashboard. Solo se muestran los números propios
// (se filtra primero qué phone_number_id pertenecen a este id_tenant).
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
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!miembro) return Response.json({ error: "No perteneces a ningún equipo activo" }, { status: 403 });

  const { data: negocios, error: negociosError } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, nombre_negocio")
    .eq("id_tenant", miembro.tenantId);
  if (negociosError) {
    return Response.json({ error: negociosError.message }, { status: 500 });
  }

  const phoneNumberIds = (negocios ?? []).map((n) => n.phone_number_id);
  if (phoneNumberIds.length === 0) {
    return Response.json({ mensajes: [] });
  }

  // Filtro opcional a un solo hilo (vista de conversación en el inbox).
  const telefonoCliente = request.nextUrl.searchParams.get("telefono_cliente");
  const phoneNumberIdFiltro = request.nextUrl.searchParams.get("phone_number_id");

  let query = supabase
    .from("dulabs_mensajes_log")
    .select("phone_number_id, telefono_cliente, direccion, contenido, created_at")
    .in("phone_number_id", phoneNumberIds);

  if (telefonoCliente && phoneNumberIdFiltro) {
    query = query
      .eq("telefono_cliente", telefonoCliente)
      .eq("phone_number_id", phoneNumberIdFiltro)
      .order("created_at", { ascending: true })
      .limit(200);
  } else {
    query = query.order("created_at", { ascending: false }).limit(100);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const nombrePorNumero = new Map((negocios ?? []).map((n) => [n.phone_number_id, n.nombre_negocio]));
  const mensajes = (data ?? []).map((m) => ({
    ...m,
    nombre_negocio: nombrePorNumero.get(m.phone_number_id) ?? m.phone_number_id,
  }));

  return Response.json({ mensajes });
}

const MAX_TEXTO = 4096; // límite de texto libre de WhatsApp

// Responder desde el Inbox web (rol admin o agente). Solo funciona dentro de
// la ventana de servicio al cliente de 24h; fuera de ella hay que usar una
// plantilla aprobada (Plantillas y campañas). Autoasigna la conversación si
// estaba sin asignar, sin quitarle nunca la asignación a otro compañero.
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
  if (!requireRol(miembro, ["admin", "agente"])) {
    return Response.json({ error: "No tienes permiso para enviar mensajes" }, { status: 403 });
  }

  // Fase 11 (Debt Zero, autorizado) — "costosa": cada envío es una llamada
  // real a la API de Meta, no solo una escritura en Supabase.
  const limiteExcedido = await respuestaSiLimiteTasaExcedido(supabase, {
    recurso: "mensajes-enviar",
    tenantId: miembro.tenantId,
    categoria: "costosa",
  });
  if (limiteExcedido) return limiteExcedido;

  // Fase 11 (Completion & Debt Zero, autorizado) — `media` es opcional: un
  // envío del Inbox ahora puede ser texto puro (como siempre) O un archivo ya
  // subido a Meta vía POST /api/dashboard/mensajes/media (media_id real, ver
  // ese endpoint) con un caption opcional. Nunca ambos caminos a la vez
  // -- reutiliza EXACTAMENTE enviarMedia (lib/whatsapp.ts, Fase F8.4), sin
  // segundo pipeline.
  let body: {
    phone_number_id?: string;
    telefono_cliente?: string;
    texto?: string;
    media?: { tipo?: string; media_id?: string; caption?: string; filename?: string; mime_type?: string; tamano_bytes?: number };
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id, telefono_cliente, media } = body;
  const texto = body.texto?.trim();
  if (!phone_number_id || !telefono_cliente) {
    return Response.json({ error: "Faltan 'phone_number_id' o 'telefono_cliente'" }, { status: 400 });
  }
  const TIPOS_MEDIA_VALIDOS: WhatsAppMediaType[] = ["image", "video", "audio", "document", "sticker"];
  if (media) {
    if (!media.media_id || !media.tipo || !TIPOS_MEDIA_VALIDOS.includes(media.tipo as WhatsAppMediaType)) {
      return Response.json({ error: "'media' requiere 'media_id' y un 'tipo' válido" }, { status: 400 });
    }
    if (media.tipo === "document" && !media.filename) {
      return Response.json({ error: "Un documento requiere 'filename'" }, { status: 400 });
    }
  } else if (!texto) {
    return Response.json({ error: "Falta 'texto' (o 'media')" }, { status: 400 });
  }
  if (texto && texto.length > MAX_TEXTO) {
    return Response.json({ error: `El mensaje no puede superar ${MAX_TEXTO} caracteres` }, { status: 400 });
  }

  const { data: cliente, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select("*")
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const dentroVentana = await dentroVentana24h(supabase, phone_number_id, telefono_cliente);
  if (!dentroVentana) {
    return Response.json(
      {
        error: "Han pasado más de 24h desde el último mensaje del cliente. Usa una plantilla aprobada.",
        fuera_de_ventana: true,
      },
      { status: 409 }
    );
  }

  const metaToken = cliente.meta_permanent_token ? descifrarSecreto(cliente.meta_permanent_token) : process.env.META_ACCESS_TOKEN;
  if (!metaToken) return Response.json({ error: "Sin token de Meta para este número" }, { status: 500 });

  let wamid: string | null = null;
  try {
    if (media) {
      const tipo = media.tipo as WhatsAppMediaType;
      // caption solo aplica a image/video/document -- enviarMedia ya lo
      // filtra internamente, pero se evita mandar un caption a audio/sticker
      // desde acá también, mismo criterio que flowMediaRefSchema.
      const caption = tipo === "image" || tipo === "video" || tipo === "document" ? media.caption?.trim() || undefined : undefined;
      ({ wamid } = await enviarMedia({
        phoneNumberId: phone_number_id,
        token: metaToken,
        para: telefono_cliente,
        tipo,
        mediaId: media.media_id,
        caption,
        filename: tipo === "document" ? media.filename : undefined,
      }));
    } else {
      ({ wamid } = await enviarTexto({ phoneNumberId: phone_number_id, token: metaToken, para: telefono_cliente, texto: texto! }));
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }

  await supabase.from("dulabs_mensajes_log").insert({
    phone_number_id,
    telefono_cliente,
    direccion: "saliente",
    // Fase F8.4 nunca definió qué guardar en `contenido` para un mensaje de
    // media puro (sin caption) -- se usa una etiqueta legible en vez de
    // dejarlo vacío, mismo criterio que usan las campañas para su propio
    // `contenido` resumen (nunca NULL en una columna NOT NULL).
    contenido: media ? media.caption?.trim() || `[${media.tipo}]${media.filename ? ` ${media.filename}` : ""}` : texto,
    origen: "agente",
    wamid,
    ...(media
      ? {
          media_tipo: media.tipo,
          media_id: media.media_id,
          media_mime_type: media.mime_type ?? null,
          media_filename: media.tipo === "document" ? media.filename ?? null : null,
          media_tamano_bytes: media.tamano_bytes ?? null,
        }
      : {}),
  });

  // Intervención humana desde el Inbox: si el flow que atiende esta conversación declara
  // runtimePolicy.humanTakeover (genérico), la pausa se renueva a su duración desde ahora sin
  // acortarla nunca. Sin esa política no se toca la pausa (comportamiento de siempre). Nunca
  // afecta el envío: el mensaje ya salió.
  await renovarPausaPorIntervencionHumana({ supabase, cliente, telefonoCliente: telefono_cliente });

  const mesHoy = new Date().toISOString().slice(0, 7);
  const nuevoUsados = cliente.mes_actual === mesHoy ? cliente.mensajes_usados_mes + 1 : 1;
  await supabase
    .from("dulabs_clientes_config")
    .update({ mensajes_usados_mes: nuevoUsados, mes_actual: mesHoy })
    .eq("id", cliente.id);

  // Autoasignación: solo rellena si la conversación está SIN asignar; nunca
  // le quita la conversación a otro miembro del equipo.
  const { data: asignacionExistente } = await supabase
    .from("dulabs_conversacion_asignaciones")
    .select("id, miembro_id")
    .eq("phone_number_id", phone_number_id)
    .eq("telefono_cliente", telefono_cliente)
    .maybeSingle();

  if (!asignacionExistente) {
    // Fase 11 (Debt Zero, autorizado) — mismo hallazgo/corrección de
    // concurrencia que F10 aplicó en handoff/route.ts: dos agentes
    // respondiendo casi simultáneamente a una conversación SIN asignar
    // pueden chocar en este INSERT (UNIQUE real de la tabla). Antes, el
    // error se ignoraba en silencio -- ambos mensajes se enviaban bien
    // (nunca se bloqueó el envío real), pero el evento "asignado" se
    // registraba igual aunque el INSERT hubiera fallado, dejando un evento
    // sin efecto real detrás.
    const { error: insertError } = await supabase.from("dulabs_conversacion_asignaciones").insert({
      phone_number_id,
      telefono_cliente,
      miembro_id: miembro.miembroId,
      asignado_por: miembro.miembroId,
    });
    // 23505 = otro agente ganó la carrera justo antes -- el envío del
    // mensaje YA ocurrió (nunca se bloquea por esto) y esa conversación
    // quedó asignada a ese otro agente, no a este; el evento "asignado" ya
    // lo registró esa otra solicitud, así que acá no se duplica.
    if (!insertError) {
      await supabase.from("dulabs_conversacion_eventos").insert({
        phone_number_id,
        telefono_cliente,
        tipo: "asignado",
        miembro_id: miembro.miembroId,
      });
    }
  } else if (!asignacionExistente.miembro_id) {
    await supabase
      .from("dulabs_conversacion_asignaciones")
      .update({ miembro_id: miembro.miembroId, asignado_por: miembro.miembroId, updated_at: new Date().toISOString() })
      .eq("id", asignacionExistente.id);
    await supabase.from("dulabs_conversacion_eventos").insert({
      phone_number_id,
      telefono_cliente,
      tipo: "asignado",
      miembro_id: miembro.miembroId,
    });
  }

  await supabase.from("dulabs_conversacion_eventos").insert({
    phone_number_id,
    telefono_cliente,
    tipo: "mensaje_enviado",
    miembro_id: miembro.miembroId,
    detalle: media ? { wamid, media_tipo: media.tipo } : { wamid, longitud: texto!.length },
  });

  return Response.json({ success: true, wamid });
}
