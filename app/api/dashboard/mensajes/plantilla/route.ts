import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { enviarPlantilla, contarVariablesPlantilla } from "@/lib/meta-templates";
import { descifrarSecreto } from "@/lib/crypto";
import { resolverClienteDeNumero, MENSAJE_PLANTILLA_DESCONECTADA } from "@/lib/plantilla-conexion";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Fase 11 (Completion & Debt Zero, autorizado) — envía una plantilla
// APROBADA a UN cliente puntual desde el composer del Inbox (a diferencia
// de POST /api/dashboard/mensajes, que solo funciona dentro de la ventana
// de 24h: una plantilla es justamente el camino para escribirle a un
// cliente FUERA de esa ventana, o para el primer contacto). Reutiliza
// enviarPlantilla/contarVariablesPlantilla (lib/meta-templates.ts, ya
// probado por campañas) y resolverClienteDeNumero (protección contra
// plantillas huérfanas tras una reconexión, mismo caso real de Soluciones
// Financieras/Charlotte) -- ningún pipeline nuevo, ninguna llamada a Meta
// reinventada.
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

  // "costosa": llamada real a Meta, igual que el envío de texto/media.
  const limiteExcedido = await respuestaSiLimiteTasaExcedido(supabase, {
    recurso: "mensajes-plantilla",
    tenantId: miembro.tenantId,
    categoria: "costosa",
  });
  if (limiteExcedido) return limiteExcedido;

  let body: { phone_number_id?: string; telefono_cliente?: string; plantilla_id?: number; variables?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id, telefono_cliente, plantilla_id } = body;
  const variables = Array.isArray(body.variables) ? body.variables.map((v) => String(v ?? "")) : [];
  if (!phone_number_id || !telefono_cliente || !plantilla_id) {
    return Response.json({ error: "Faltan 'phone_number_id', 'telefono_cliente' o 'plantilla_id'" }, { status: 400 });
  }

  // La plantilla debe pertenecer al MISMO tenant Y al MISMO número de la
  // conversación -- nunca se confía en que el frontend mande el nombre
  // "correcto"; se resuelve siempre contra la fila real en DB.
  const { data: plantilla, error: plantillaError } = await supabase
    .from("dulabs_plantillas")
    .select("*")
    .eq("id", plantilla_id)
    .eq("id_tenant", miembro.tenantId)
    .eq("phone_number_id", phone_number_id)
    .maybeSingle();
  if (plantillaError) return Response.json({ error: plantillaError.message }, { status: 500 });
  if (!plantilla) return Response.json({ error: "Plantilla no encontrada" }, { status: 404 });
  if (plantilla.estado !== "APPROVED") {
    return Response.json({ error: `La plantilla todavía no está aprobada (estado: ${plantilla.estado})` }, { status: 400 });
  }

  const variablesEsperadas = contarVariablesPlantilla(plantilla.cuerpo);
  if (variables.length !== variablesEsperadas) {
    return Response.json({ error: `Esta plantilla necesita ${variablesEsperadas} variable(s), llegaron ${variables.length}` }, { status: 400 });
  }
  if (variables.some((v) => !v.trim())) {
    return Response.json({ error: "Ninguna variable puede quedar vacía" }, { status: 400 });
  }

  const cliente = await resolverClienteDeNumero(supabase, { phoneNumberId: phone_number_id, idTenant: miembro.tenantId });
  if (!cliente) return Response.json({ error: MENSAJE_PLANTILLA_DESCONECTADA }, { status: 409 });

  const metaToken = cliente.meta_permanent_token ? descifrarSecreto(cliente.meta_permanent_token) : process.env.META_ACCESS_TOKEN;
  if (!metaToken) return Response.json({ error: "Sin token de Meta para este número" }, { status: 500 });

  let wamid: string | null = null;
  try {
    ({ wamid } = await enviarPlantilla({
      phoneNumberId: phone_number_id,
      token: metaToken,
      para: telefono_cliente,
      nombrePlantilla: plantilla.nombre,
      idioma: plantilla.idioma,
      parametrosPosicionales: variables.length > 0 ? variables : undefined,
    }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }

  // Cuerpo interpolado real (para el historial del Inbox) -- misma lógica
  // simple que ya usa contarVariablesPlantilla: reemplaza {{1}}, {{2}}... en
  // orden. Nunca reinterpreta el cuerpo con nada más que texto plano.
  const cuerpoInterpolado = variables.reduce(
    (acc, valor, i) => acc.replaceAll(`{{${i + 1}}}`, valor),
    plantilla.cuerpo as string,
  );

  await supabase.from("dulabs_mensajes_log").insert({
    phone_number_id,
    telefono_cliente,
    direccion: "saliente",
    contenido: `[Plantilla: ${plantilla.nombre}] ${cuerpoInterpolado}`,
    origen: "agente",
    wamid,
  });

  const mesHoy = new Date().toISOString().slice(0, 7);
  const nuevoUsados = cliente.mes_actual === mesHoy ? cliente.mensajes_usados_mes + 1 : 1;
  await supabase.from("dulabs_clientes_config").update({ mensajes_usados_mes: nuevoUsados, mes_actual: mesHoy }).eq("id", cliente.id);

  // Autoasignación (mismo criterio/misma corrección de carrera que
  // app/api/dashboard/mensajes/route.ts) -- nunca le quita la conversación a
  // otro compañero que ya la tuviera.
  const { data: asignacionExistente } = await supabase
    .from("dulabs_conversacion_asignaciones")
    .select("id, miembro_id")
    .eq("phone_number_id", phone_number_id)
    .eq("telefono_cliente", telefono_cliente)
    .maybeSingle();
  if (!asignacionExistente) {
    const { error: insertError } = await supabase.from("dulabs_conversacion_asignaciones").insert({
      phone_number_id,
      telefono_cliente,
      miembro_id: miembro.miembroId,
      asignado_por: miembro.miembroId,
    });
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
  }

  await supabase.from("dulabs_conversacion_eventos").insert({
    phone_number_id,
    telefono_cliente,
    tipo: "mensaje_enviado",
    miembro_id: miembro.miembroId,
    detalle: { wamid, plantilla: plantilla.nombre },
  });

  return Response.json({ success: true, wamid });
}
