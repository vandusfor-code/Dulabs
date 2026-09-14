import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo } from "@/lib/team";
import { resolverPeriodo } from "@/lib/analytics/periodo";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Tope defensivo de filas agregadas en memoria por ventana de tiempo (mismo
// criterio que /api/dashboard/analytics y /resumen, que ya agregan en JS
// sobre un rango acotado por fecha) -- nunca "sin límite".
const TOPE_FILAS = 5000;
const ESTADOS_TERMINALES_OK = new Set(["completed"]);
const ESTADOS_TERMINALES_FALLO = new Set(["failed"]);

type FilaEjecucion = {
  id: string;
  flow_id: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type FilaEfecto = {
  node_id: string;
  kind: string;
  integration_id: string | null;
  status: string;
  requested_at: string;
  resolved_at: string | null;
  provider: string | null;
  provider_model: string | null;
};

// Fase 10 (Analytics, autorizado) -- ejecuciones de Flow, efectos de IA y
// efectos de integraciones, TODO reutilizando dulabs_flow_executions y
// dulabs_flow_effects (Fase 3, F5, F6) sin ninguna tabla nueva -- ver
// auditoría F10-A: ambas tablas ya tienen exactamente los campos (status,
// kind, provider, integration_id, requested_at/resolved_at) que este
// endpoint necesita.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!miembro) return Response.json({ error: "No perteneces a ningún equipo activo" }, { status: 403 });

  const limiteExcedido = await respuestaSiLimiteTasaExcedido(supabase, {
    recurso: "analytics-flows",
    tenantId: miembro.tenantId,
    categoria: "lectura",
  });
  if (limiteExcedido) return limiteExcedido;

  const resultadoPeriodo = resolverPeriodo(request.nextUrl.searchParams);
  if (!resultadoPeriodo.ok) return Response.json({ error: resultadoPeriodo.error }, { status: 400 });
  const { desde, hasta } = resultadoPeriodo.periodo;

  // tenant_id vive DIRECTO en estas dos tablas (a diferencia de
  // dulabs_mensajes_log) -- filtro directo, sin resolver phone_number_id.
  const [{ data: ejecuciones, error: ejecucionesError }, { data: efectos, error: efectosError }, { data: flows }, { data: integraciones }] =
    await Promise.all([
      supabase
        .from("dulabs_flow_executions")
        .select("id, flow_id, status, created_at, updated_at")
        .eq("tenant_id", miembro.tenantId)
        .gte("created_at", desde.toISOString())
        .lte("created_at", hasta.toISOString())
        .limit(TOPE_FILAS),
      supabase
        .from("dulabs_flow_effects")
        .select("node_id, kind, integration_id, status, requested_at, resolved_at, provider, provider_model")
        .eq("tenant_id", miembro.tenantId)
        .gte("requested_at", desde.toISOString())
        .lte("requested_at", hasta.toISOString())
        .limit(TOPE_FILAS),
      supabase.from("dulabs_flows").select("id, name").eq("tenant_id", miembro.tenantId),
      supabase.from("dulabs_flow_integrations").select("id, display_name").eq("tenant_id", miembro.tenantId),
    ]);
  if (ejecucionesError) return Response.json({ error: ejecucionesError.message }, { status: 500 });
  if (efectosError) return Response.json({ error: efectosError.message }, { status: 500 });

  const nombrePorFlow = new Map((flows ?? []).map((f) => [f.id, f.name]));
  const nombrePorIntegracion = new Map((integraciones ?? []).map((i) => [i.id, i.display_name]));

  // --- Flows ---
  const filasEjecucion = (ejecuciones ?? []) as FilaEjecucion[];
  const porStatus: Record<string, number> = {};
  const duracionesSegPorFlow = new Map<string, number[]>();
  const conteoPorFlow = new Map<string, number>();
  for (const e of filasEjecucion) {
    porStatus[e.status] = (porStatus[e.status] ?? 0) + 1;
    conteoPorFlow.set(e.flow_id, (conteoPorFlow.get(e.flow_id) ?? 0) + 1);
    if (ESTADOS_TERMINALES_OK.has(e.status) || ESTADOS_TERMINALES_FALLO.has(e.status)) {
      // Aproximación: updated_at del último touch de la fila. No es un
      // timestamp de "finalización" dedicado -- suficiente para una
      // duración promedio orientativa, no para SLA exactos.
      const duracionSeg = (new Date(e.updated_at).getTime() - new Date(e.created_at).getTime()) / 1000;
      if (duracionSeg >= 0) {
        const lista = duracionesSegPorFlow.get(e.flow_id) ?? [];
        lista.push(duracionSeg);
        duracionesSegPorFlow.set(e.flow_id, lista);
      }
    }
  }
  const flowMasUtilizado = [...conteoPorFlow.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const todasDuraciones = [...duracionesSegPorFlow.values()].flat();
  const duracionPromedioSeg = todasDuraciones.length > 0 ? todasDuraciones.reduce((a, b) => a + b, 0) / todasDuraciones.length : null;

  // --- IA (kind="ai") ---
  const filasEfecto = (efectos ?? []) as FilaEfecto[];
  const efectosIA = filasEfecto.filter((e) => e.kind === "ai");
  const iaPorProveedor = new Map<string, { total: number; succeeded: number; failed: number; tiemposSeg: number[] }>();
  for (const e of efectosIA) {
    const clave = e.provider ? `${e.provider}${e.provider_model ? `/${e.provider_model}` : ""}` : "desconocido";
    const acc = iaPorProveedor.get(clave) ?? { total: 0, succeeded: 0, failed: 0, tiemposSeg: [] };
    acc.total++;
    if (e.status === "succeeded") acc.succeeded++;
    if (e.status === "failed") acc.failed++;
    if (e.resolved_at) {
      const seg = (new Date(e.resolved_at).getTime() - new Date(e.requested_at).getTime()) / 1000;
      if (seg >= 0) acc.tiemposSeg.push(seg);
    }
    iaPorProveedor.set(clave, acc);
  }

  // --- Integraciones (kind="action" con integration_id -- distingue de
  // acciones internas del Flow, que también usan kind="action" pero sin
  // integración registrada, ver lib/flow/executors/internal-action-executor.ts) ---
  const efectosIntegracion = filasEfecto.filter((e) => e.kind === "action" && e.integration_id !== null);
  const integracionesStats = new Map<string, { nombre: string; total: number; succeeded: number; failed: number; expired: number }>();
  for (const e of efectosIntegracion) {
    const id = e.integration_id as string;
    const acc = integracionesStats.get(id) ?? {
      nombre: nombrePorIntegracion.get(id) ?? "(integración eliminada)",
      total: 0,
      succeeded: 0,
      failed: 0,
      expired: 0,
    };
    acc.total++;
    if (e.status === "succeeded") acc.succeeded++;
    if (e.status === "failed") acc.failed++;
    if (e.status === "expired") acc.expired++;
    integracionesStats.set(id, acc);
  }

  // --- Nodos más fallidos (cualquier kind) ---
  const fallosPorNodo = new Map<string, number>();
  for (const e of filasEfecto) {
    if (e.status !== "failed") continue;
    fallosPorNodo.set(e.node_id, (fallosPorNodo.get(e.node_id) ?? 0) + 1);
  }
  const nodosMasFallidos = [...fallosPorNodo.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([nodeId, fallos]) => ({ nodeId, fallos }));

  return Response.json({
    periodo: { desde: desde.toISOString(), hasta: hasta.toISOString() },
    flows: {
      total: filasEjecucion.length,
      porStatus,
      duracionPromedioSeg,
      masUtilizado: flowMasUtilizado ? { flowId: flowMasUtilizado[0], nombre: nombrePorFlow.get(flowMasUtilizado[0]) ?? flowMasUtilizado[0], ejecuciones: flowMasUtilizado[1] } : null,
      nodosMasFallidos,
    },
    ia: {
      total: efectosIA.length,
      porProveedor: [...iaPorProveedor.entries()].map(([proveedor, s]) => ({
        proveedor,
        total: s.total,
        succeeded: s.succeeded,
        failed: s.failed,
        tiempoRespuestaPromedioSeg: s.tiemposSeg.length > 0 ? s.tiemposSeg.reduce((a, b) => a + b, 0) / s.tiemposSeg.length : null,
      })),
    },
    integraciones: {
      total: efectosIntegracion.length,
      porIntegracion: [...integracionesStats.entries()].map(([integrationId, s]) => ({ integrationId, ...s })),
    },
  });
}
