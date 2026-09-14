import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { obtenerCicloActivo, reclamarCicloParaReintento } from "@/lib/dunning/dunning-domain";
import { procesarReintentoCobro } from "@/lib/dunning/procesar-reintento";
import { enviarNotificacionEmail } from "@/lib/dunning/email-provider";

export const runtime = "nodejs";

// FASE F16.1 (Commercial Scale — Dunning, autorizado) — visibilidad y
// acciones administrativas del ciclo de dunning de UN cliente. Mismo patrón
// que el resto de app/api/dashboard/admin/clientes/[idTenant]/* (F15):
// verificarAccesoAdminDulabs como única puerta, idTenant siempre de la URL
// (nunca del body), toda acción sensible auditada tanto en
// dulabs_auditoria_admin (historial general de acciones de operador, igual
// que el resto de /admin) como en dulabs_dunning_eventos (historial
// específico del ciclo, lo que ve esta misma pantalla).
export async function GET(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  const ciclo = await obtenerCicloActivo(supabase, idTenant);
  const { data: eventos, error } = await supabase
    .from("dulabs_dunning_eventos")
    .select("id, tipo, metadata, actor_user_id, created_at")
    .eq("id_tenant", idTenant)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ciclo, eventos: eventos ?? [] });
}

type Body = { accion?: "reintentar" | "reenviar_notificacion"; tipo_notificacion?: "payment_failed" | "reminder" | "expired" | "recovered" };

export async function POST(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "admin_dunning", tenantId: acceso.miembro.userId, categoria: "costosa" });
  if (limite) return limite;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const ciclo = await obtenerCicloActivo(supabase, idTenant);
  if (!ciclo) return Response.json({ error: "Este cliente no tiene ningún ciclo de dunning activo." }, { status: 404 });

  if (body.accion === "reintentar") {
    const reclamo = await reclamarCicloParaReintento(supabase, idTenant, { ignorarHorario: true });
    if (!reclamo) {
      return Response.json({ error: "Ya hay un reintento en curso para este cliente. Espera un momento e inténtalo de nuevo." }, { status: 409 });
    }
    await supabase.from("dulabs_dunning_eventos").insert({ id_tenant: idTenant, ciclo_id: reclamo.id, tipo: "manual_retry", actor_user_id: acceso.miembro.userId });
    await registrarAuditoriaAdmin(supabase, { operador: acceso.miembro, accion: "DUNNING_MANUAL_RETRY", idTenant, recurso: String(reclamo.id) });

    const resultado = await procesarReintentoCobro(supabase, { idTenant, cicloId: reclamo.id, intentosActuales: reclamo.intentos, primerFalloAt: ciclo.primer_fallo_at });
    return Response.json({ success: true, resultado: resultado.resultado });
  }

  if (body.accion === "reenviar_notificacion") {
    const tipo = body.tipo_notificacion;
    if (!tipo || !["payment_failed", "reminder", "expired", "recovered"].includes(tipo)) {
      return Response.json({ error: "Falta o es inválido 'tipo_notificacion'" }, { status: 400 });
    }
    const { data: authUser } = await supabase.auth.admin.getUserById(idTenant);
    const destinatario = authUser?.user?.email ?? null;
    if (!destinatario) return Response.json({ error: "No se encontró un correo para este cliente" }, { status: 404 });

    // Reenvío manual: a propósito NO pasa por enviarNotificacionDunning
    // (esa función es idempotente A PROPÓSITO -- un tipo por ciclo, nunca
    // dos). El operador está pidiendo explícitamente un reenvío, así que se
    // manda directo y se deja constancia como manual_notification (fuera
    // del índice único de "una vez por ciclo").
    const textos: Record<string, { asunto: string; texto: string }> = {
      payment_failed: { asunto: "No pudimos procesar tu pago en DuLabs", texto: "Reenvío manual del aviso de pago rechazado. Revisa tu cuenta en /dashboard/cuenta." },
      reminder: { asunto: "Recordatorio: actualiza tu método de pago en DuLabs", texto: "Reenvío manual del recordatorio. Revisa tu cuenta en /dashboard/cuenta." },
      expired: { asunto: "Tu suscripción de DuLabs quedó vencida", texto: "Reenvío manual del aviso de vencimiento. Revisa tu cuenta en /dashboard/cuenta." },
      recovered: { asunto: "¡Listo! Tu pago fue confirmado", texto: "Reenvío manual de la confirmación de pago." },
    };
    const contenido = textos[tipo];
    const resultado = await enviarNotificacionEmail({ destinatario, asunto: contenido.asunto, textoPlano: contenido.texto, html: `<p>${contenido.texto}</p>` });

    await supabase.from("dulabs_dunning_eventos").insert({
      id_tenant: idTenant,
      ciclo_id: ciclo.id,
      tipo: "manual_notification",
      actor_user_id: acceso.miembro.userId,
      metadata: { tipo_notificacion: tipo, enviado: resultado.enviado, motivo: resultado.enviado ? null : resultado.motivo },
    });
    await registrarAuditoriaAdmin(supabase, { operador: acceso.miembro, accion: "DUNNING_MANUAL_NOTIFICATION", idTenant, recurso: tipo, metadata: { enviado: resultado.enviado } });

    return Response.json({ success: true, enviado: resultado.enviado });
  }

  return Response.json({ error: "Acción inválida. Usa 'reintentar' o 'reenviar_notificacion'." }, { status: 400 });
}
