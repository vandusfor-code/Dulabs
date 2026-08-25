import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo } from "@/lib/team";
import { planDelTenant } from "@/lib/plan-limits";
import { esSinPlan } from "@/lib/planes";

export const runtime = "nodejs";

export type Notificacion = {
  id: string;
  tono: "critico" | "aviso" | "info";
  titulo: string;
  detalle: string;
  href: string;
};

// Avisos reales del tenant para la campanita del Topbar. Antes el botón no
// tenía onClick: era un ícono sin función. Todo lo que se lista aquí sale de
// datos vivos (suscripción, fallos de IA, cupo del plan) -- si no hay nada
// que decir, se devuelve una lista vacía y la UI lo dice honestamente, en
// vez de inventar notificaciones de relleno.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });

  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!miembro) return Response.json({ notificaciones: [] });

  const notificaciones: Notificacion[] = [];

  // --- Suscripción
  const { data: suscripcion } = await supabase
    .from("dulabs_suscripciones")
    .select("estado, cancelar_al_vencer, fecha_proximo_cobro, plan")
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();

  const plan = await planDelTenant(supabase, miembro.tenantId);

  if (!suscripcion) {
    notificaciones.push({
      id: "sin-suscripcion",
      tono: "critico",
      titulo: "Todavía no tienes un plan activo",
      detalle: "Actívalo para conectar tu número y empezar a responder con IA.",
      href: "/checkout",
    });
  } else if (suscripcion.estado === "pendiente_pago") {
    notificaciones.push({
      id: "pago-pendiente",
      tono: "critico",
      titulo: "Tu pago está pendiente",
      detalle: "Tu plan se activa en cuanto se confirme el pago.",
      href: "/dashboard/cuenta",
    });
  } else if (suscripcion.estado === "cancelada") {
    notificaciones.push({
      id: "suscripcion-cancelada",
      tono: "critico",
      titulo: "Tu suscripción venció",
      detalle: "Reactívala para volver a usar la plataforma.",
      href: "/checkout",
    });
  } else if (suscripcion.cancelar_al_vencer) {
    notificaciones.push({
      id: "cancelacion-programada",
      tono: "aviso",
      titulo: "Tu plan no se renovará",
      detalle: `Conservas el servicio hasta el ${suscripcion.fecha_proximo_cobro}. Puedes reactivarlo antes de esa fecha.`,
      href: "/dashboard/cuenta",
    });
  }

  // --- Fallos de IA de las últimas 24 h (que sí se alertaron, para no
  // repetir en la campanita cada reintento fallido del mismo problema).
  const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: fallos } = await supabase
    .from("dulabs_fallos_ia")
    .select("tipo, created_at")
    .eq("id_tenant", miembro.tenantId)
    .not("alertado_at", "is", null)
    .gte("created_at", hace24h)
    .order("created_at", { ascending: false })
    .limit(1);

  if (fallos && fallos.length > 0) {
    const legible: Record<string, string> = {
      sin_saldo: "El servicio de IA se quedó sin saldo",
      key_invalida: "La clave del servicio de IA es inválida",
      sin_key: "Falta configurar el servicio de IA",
      rate_limit: "El servicio de IA está saturado",
      sobrecarga: "El servicio de IA está sobrecargado",
      otro: "La IA tuvo un error inesperado",
    };
    notificaciones.push({
      id: "fallo-ia",
      tono: "critico",
      titulo: legible[fallos[0].tipo] ?? legible.otro,
      detalle: "Tu asistente dejó de responder. El equipo de Du Labs ya fue notificado.",
      href: "/dashboard/agentes",
    });
  }

  // --- Cupo mensual de mensajes de IA
  if (!esSinPlan(plan) && plan.limites.mensajesIAMes !== null) {
    const mesActual = new Date().toISOString().slice(0, 7);
    const { data: numeros } = await supabase
      .from("dulabs_clientes_config")
      .select("mensajes_usados_mes, mes_actual")
      .eq("id_tenant", miembro.tenantId);
    const usados = (numeros ?? []).reduce(
      (acc, n) => acc + (n.mes_actual === mesActual ? (n.mensajes_usados_mes ?? 0) : 0),
      0
    );
    const tope = plan.limites.mensajesIAMes;
    if (usados >= tope) {
      notificaciones.push({
        id: "cupo-agotado",
        tono: "critico",
        titulo: "Agotaste tu cupo de mensajes del mes",
        detalle: `Usaste ${usados} de ${tope}. Tu IA no responderá hasta el próximo mes o hasta que mejores tu plan.`,
        href: "/checkout",
      });
    } else if (usados >= tope * 0.8) {
      notificaciones.push({
        id: "cupo-cerca",
        tono: "aviso",
        titulo: "Te queda poco cupo de mensajes",
        detalle: `Usaste ${usados} de ${tope} mensajes de IA este mes.`,
        href: "/checkout",
      });
    }
  }

  // --- Números sin agente configurado (la IA no puede responder bien)
  const { data: sinPrompt } = await supabase
    .from("dulabs_clientes_config")
    .select("nombre_negocio")
    .eq("id_tenant", miembro.tenantId)
    .is("agente_id", null)
    .is("prompt_sistema", null);

  if (sinPrompt && sinPrompt.length > 0) {
    notificaciones.push({
      id: "sin-agente",
      tono: "aviso",
      titulo:
        sinPrompt.length === 1
          ? "Un número no tiene agente configurado"
          : `${sinPrompt.length} números no tienen agente configurado`,
      detalle: "Sin instrucciones, la IA responde de forma genérica. Entrénala con la información de tu negocio.",
      href: "/dashboard/agentes",
    });
  }

  return Response.json({ notificaciones });
}
