import { after } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { consultarEstadoNumero } from "@/lib/meta-numero";
import { descifrarSecreto } from "@/lib/crypto";

export const runtime = "nodejs";

const LIMITE_MENSAJES_POR_PLAN: Record<string, number> = {
  "Plan Básico": 1000,
  "Plan Pro": 5000,
  "Plan Enterprise": Infinity,
};
const PLAN_POR_DEFECTO = "Plan Pro";
const UNA_HORA_MS = 60 * 60 * 1000;

function mesActualISO(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

// Datos del tenant autenticado. El front nunca ve meta_permanent_token:
// solo campos de visualización + un booleano de si hay token guardado.
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

  // Esta ruta necesita ver membresías invitado/suspendido también (no solo
  // activo), para poder completar la primera invitación y rechazar accesos
  // suspendidos — por eso no usa resolverMiembroEquipo() (solo activos).
  const { data: filaMiembro, error: miembroError } = await supabase
    .from("dulabs_miembros_equipo")
    .select("id, tenant_id, rol, estado")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (miembroError) return Response.json({ error: miembroError.message }, { status: 500 });

  if (!filaMiembro) {
    // Usuario autenticado que todavía no conectó un número ni se suscribió:
    // sin equipo, sin negocios — mismo comportamiento vacío de hoy.
    return Response.json({ email: userData.user.email, negocios: [], suscripcion: null, rol: null });
  }
  if (filaMiembro.estado === "suspendido") {
    return Response.json({ error: "Tu acceso a este equipo fue suspendido" }, { status: 403 });
  }
  if (filaMiembro.estado === "invitado") {
    await supabase.from("dulabs_miembros_equipo").update({ estado: "activo" }).eq("id", filaMiembro.id);
  }
  const tenantId = filaMiembro.tenant_id;
  const rol = filaMiembro.rol;

  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .select(
      "nombre_negocio, telefono_negocio, phone_number_id, whatsapp_business_account_id, meta_permanent_token, updated_at, plan, mensajes_usados_mes, mes_actual, prompt_sistema, base_conocimiento, base_conocimiento_nombre_archivo, base_conocimiento_actualizado_at, calidad, limite_mensajeria, estado_verificacion, estado_nombre_visible, ultima_sincronizacion_meta, nombre_agente, ia_pausada"
    )
    .eq("id_tenant", tenantId)
    .order("updated_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Resincroniza el estado operativo real del número (calidad, límite de
  // mensajería, verificación) desde Meta si nunca se hizo o si ya pasó más
  // de una hora. Corre DESPUÉS de responder (after()) para que una Graph API
  // lenta o caída nunca retrase ni cuelgue la carga del dashboard — el
  // usuario ve los datos ya guardados y la próxima carga trae los nuevos.
  const pendientesDeSincronizar = (data ?? []).filter((n) => {
    const token = n.meta_permanent_token || process.env.META_ACCESS_TOKEN;
    if (!token) return false;
    return (
      !n.ultima_sincronizacion_meta ||
      Date.now() - new Date(n.ultima_sincronizacion_meta).getTime() > UNA_HORA_MS
    );
  });

  if (pendientesDeSincronizar.length > 0) {
    after(async () => {
      await Promise.all(
        pendientesDeSincronizar.map(async (n) => {
          const token = n.meta_permanent_token ? descifrarSecreto(n.meta_permanent_token) : process.env.META_ACCESS_TOKEN;
          if (!token) return;
          const estado = await consultarEstadoNumero({ phoneNumberId: n.phone_number_id, token });
          if (!estado) return;

          await supabase
            .from("dulabs_clientes_config")
            .update({
              calidad: estado.calidad,
              limite_mensajeria: estado.limite_mensajeria,
              estado_verificacion: estado.estado_verificacion,
              estado_nombre_visible: estado.estado_nombre_visible,
              ultima_sincronizacion_meta: new Date().toISOString(),
            })
            .eq("phone_number_id", n.phone_number_id)
            .eq("id_tenant", tenantId);
        })
      );
    });
  }

  // Enviados reales por número (30 días) y hoy, para el cupo diario y el
  // total de capacidad de la pantalla de Números.
  const phoneNumberIds = (data ?? []).map((n) => n.phone_number_id);
  const enviados30dPorNumero = new Map<string, number>();
  const enviadosHoyPorNumero = new Map<string, number>();
  if (phoneNumberIds.length > 0) {
    const hace30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const inicioHoy = new Date();
    inicioHoy.setHours(0, 0, 0, 0);

    const { data: mensajes30d } = await supabase
      .from("dulabs_mensajes_log")
      .select("phone_number_id, created_at")
      .in("phone_number_id", phoneNumberIds)
      .eq("direccion", "saliente")
      .gte("created_at", hace30d.toISOString());

    for (const m of mensajes30d ?? []) {
      enviados30dPorNumero.set(m.phone_number_id, (enviados30dPorNumero.get(m.phone_number_id) ?? 0) + 1);
      if (new Date(m.created_at) >= inicioHoy) {
        enviadosHoyPorNumero.set(m.phone_number_id, (enviadosHoyPorNumero.get(m.phone_number_id) ?? 0) + 1);
      }
    }
  }

  const mesHoy = mesActualISO();
  const negocios = (data ?? []).map((n) => {
    const plan = n.plan ?? PLAN_POR_DEFECTO;
    const limite = LIMITE_MENSAJES_POR_PLAN[plan] ?? LIMITE_MENSAJES_POR_PLAN[PLAN_POR_DEFECTO];
    // El contador se reinicia en el primer envío del mes (webhook); si ya
    // cambió el mes y todavía no hubo envíos, mostramos 0 en vez del valor viejo.
    const usados = n.mes_actual === mesHoy ? n.mensajes_usados_mes : 0;
    return {
      nombre_negocio: n.nombre_negocio,
      telefono_negocio: n.telefono_negocio,
      phone_number_id: n.phone_number_id,
      whatsapp_business_account_id: n.whatsapp_business_account_id,
      conectado: Boolean(n.meta_permanent_token || process.env.META_ACCESS_TOKEN),
      updated_at: n.updated_at,
      plan,
      mensajes_usados: usados,
      mensajes_limite: Number.isFinite(limite) ? limite : null,
      prompt_sistema: n.prompt_sistema,
      base_conocimiento_nombre_archivo: n.base_conocimiento_nombre_archivo,
      base_conocimiento_actualizado_at: n.base_conocimiento_actualizado_at,
      base_conocimiento_caracteres: n.base_conocimiento?.length ?? 0,
      calidad: n.calidad,
      limite_mensajeria: n.limite_mensajeria,
      estado_verificacion: n.estado_verificacion,
      estado_nombre_visible: n.estado_nombre_visible,
      nombre_agente: n.nombre_agente,
      ia_pausada: n.ia_pausada,
      enviados_30d: enviados30dPorNumero.get(n.phone_number_id) ?? 0,
      enviados_hoy: enviadosHoyPorNumero.get(n.phone_number_id) ?? 0,
    };
  });

  const { data: suscripcion } = await supabase
    .from("dulabs_suscripciones")
    .select("plan, precio_cop, estado, fecha_proximo_cobro")
    .eq("id_tenant", tenantId)
    .maybeSingle();

  return Response.json({ email: userData.user.email, negocios, suscripcion, rol });
}
