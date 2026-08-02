import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo } from "@/lib/team";
import {
  AGENTES_MARKETPLACE,
  agentePorSlug,
  PRECIO_MARKETPLACE_RECURRENTE_COP,
  PRECIO_MARKETPLACE_MES_COP,
} from "@/lib/marketplace";

export const runtime = "nodejs";

// Estado del Marketplace para el tenant: el catálogo de agentes (SIN el
// prompt base, que se queda en el servidor) enriquecido con la activación
// vigente de cada uno, más la lista de números del tenant (con cuál agente
// del marketplace tiene activo cada uno, para el selector de número).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!miembro) return Response.json({ error: "No perteneces a ningún equipo activo" }, { status: 403 });

  const [{ data: numeros }, { data: activaciones }] = await Promise.all([
    supabase
      .from("dulabs_clientes_config")
      .select("phone_number_id, nombre_negocio")
      .eq("id_tenant", miembro.tenantId),
    supabase
      .from("dulabs_marketplace_activaciones")
      .select("id, agente_slug, phone_number_id, tipo_plan, estado, fecha_proximo_cobro, vence_at, numero_admin, nombre_admin")
      .eq("id_tenant", miembro.tenantId)
      .eq("estado", "activa"),
  ]);

  const nombrePorNumero = new Map((numeros ?? []).map((n) => [n.phone_number_id, n.nombre_negocio]));
  const activas = activaciones ?? [];

  // Resumen de próximas citas para activaciones de agentes con agenda — solo
  // lo suficiente para un vistazo en "Administrar"; la gestión completa
  // (cancelar, reagendar) ya vive en la conversación de WhatsApp, no hace
  // falta duplicarla aquí.
  const activacionesConAgenda = activas.filter((act) => agentePorSlug(act.agente_slug)?.usaAgenda);
  const citasPorActivacion = new Map<number, { total: number; proximas: { fecha: string; hora: string; cliente: string }[] }>();
  if (activacionesConAgenda.length > 0) {
    const hoy = new Date().toISOString().slice(0, 10);
    const { data: citas } = await supabase
      .from("dulabs_marketplace_citas")
      .select("activacion_id, fecha, hora_inicio, nombre_cliente, numero_cliente")
      .in("activacion_id", activacionesConAgenda.map((a) => a.id))
      .eq("estado", "agendada")
      .gte("fecha", hoy)
      .order("fecha", { ascending: true })
      .order("hora_inicio", { ascending: true });
    for (const c of citas ?? []) {
      const actual = citasPorActivacion.get(c.activacion_id) ?? { total: 0, proximas: [] };
      actual.total += 1;
      if (actual.proximas.length < 3) {
        actual.proximas.push({ fecha: c.fecha, hora: String(c.hora_inicio).slice(0, 5), cliente: c.nombre_cliente ?? c.numero_cliente });
      }
      citasPorActivacion.set(c.activacion_id, actual);
    }
  }

  const agentes = AGENTES_MARKETPLACE.map((a) => {
    const act = activas.find((x) => x.agente_slug === a.slug) ?? null;
    return {
      slug: a.slug,
      nombre: a.nombre,
      categoria: a.categoria,
      icono: a.icono,
      descripcion: a.descripcion,
      queIncluye: a.queIncluye,
      usaAgenda: a.usaAgenda,
      precioRecurrente: PRECIO_MARKETPLACE_RECURRENTE_COP,
      precioMes: PRECIO_MARKETPLACE_MES_COP,
      activacion: act
        ? {
            phone_number_id: act.phone_number_id,
            nombre_negocio: nombrePorNumero.get(act.phone_number_id) ?? act.phone_number_id,
            tipo_plan: act.tipo_plan,
            fecha_proximo_cobro: act.fecha_proximo_cobro,
            vence_at: act.vence_at,
            numero_admin: act.numero_admin,
            nombre_admin: act.nombre_admin,
            citasProximas: a.usaAgenda ? citasPorActivacion.get(act.id) ?? { total: 0, proximas: [] } : null,
          }
        : null,
    };
  });

  const slugPorNumero = new Map(activas.map((a) => [a.phone_number_id, a.agente_slug]));
  const numerosSalida = (numeros ?? []).map((n) => ({
    phone_number_id: n.phone_number_id,
    nombre_negocio: n.nombre_negocio,
    marketplaceSlug: slugPorNumero.get(n.phone_number_id) ?? null,
  }));

  return Response.json({ agentes, numeros: numerosSalida });
}
