import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { obtenerCicloActivo, reclamarCicloParaReintento } from "@/lib/dunning/dunning-domain";
import { procesarReintentoCobro } from "@/lib/dunning/procesar-reintento";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";

export const runtime = "nodejs";

// FASE F16.1 (Commercial Scale — Dunning, autorizado) — recuperación
// self-service: el cliente con un pago fallido puede reintentar SU PROPIO
// cobro sin esperar al próximo reintento automático (política de negocio
// explícita: "DÍA 1-2: permitir recuperación manual desde checkout/pago").
// Mismo patrón de auth que app/api/dashboard/suscripcion/route.ts
// (autenticarAdmin) -- el tenant SIEMPRE sale de la sesión real, nunca del
// body. Nunca crea un segundo checkout: reusa la misma fuente de pago ya
// guardada (wompi_payment_source_id) y el mismo cobro que ya usa el cron,
// vía lib/dunning/procesar-reintento.ts -- el precio real sigue siendo el
// de dulabs_suscripciones.precio_cop (ya resuelto server-side desde antes,
// nunca del body de este request, que de hecho no recibe ningún campo).
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });

  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "Solo un administrador puede gestionar la suscripción" }, { status: 403 });
  }

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "dunning_reintentar_pago", tenantId: miembro!.tenantId, categoria: "costosa" });
  if (limite) return limite;

  const ciclo = await obtenerCicloActivo(supabase, miembro!.tenantId);
  if (!ciclo) {
    return Response.json({ error: "No hay ningún pago pendiente de regularizar para tu cuenta." }, { status: 404 });
  }

  const reclamo = await reclamarCicloParaReintento(supabase, miembro!.tenantId, { ignorarHorario: true });
  if (!reclamo) {
    return Response.json({ error: "Ya hay un reintento en curso para tu cuenta. Espera un momento e inténtalo de nuevo." }, { status: 409 });
  }

  await supabase.from("dulabs_dunning_eventos").insert({
    id_tenant: miembro!.tenantId,
    ciclo_id: reclamo.id,
    tipo: "manual_retry",
    actor_user_id: miembro!.userId,
  });

  try {
    const resultado = await procesarReintentoCobro(supabase, {
      idTenant: miembro!.tenantId,
      cicloId: reclamo.id,
      intentosActuales: reclamo.intentos,
      primerFalloAt: ciclo.primer_fallo_at,
    });

    switch (resultado.resultado) {
      case "recuperado":
        return Response.json({ success: true, estado: "recuperado" });
      case "pendiente":
        return Response.json({ success: true, estado: "pendiente", mensaje: "Tu banco está confirmando el pago -- te avisamos apenas se resuelva." });
      case "rechazado_final":
        return Response.json({ success: false, estado: "vencido_final", error: "El pago volvió a ser rechazado y se agotaron los intentos. Contacta a tu banco o actualiza tu método de pago." }, { status: 402 });
      case "rechazado_reintento":
        return Response.json({ success: false, estado: "rechazado", error: "El pago fue rechazado nuevamente. Seguiremos intentando según la fecha programada, o vuelve a intentarlo más tarde." }, { status: 402 });
      case "omitido":
        return Response.json({ success: false, error: resultado.motivo }, { status: 409 });
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Error inesperado procesando el pago" }, { status: 500 });
  }
}
