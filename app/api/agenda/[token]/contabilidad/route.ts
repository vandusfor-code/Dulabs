import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { generarReporteContabilidad } from "@/lib/contabilidad/reporte";
import type { TipoPeriodo } from "@/lib/contabilidad/tipos";

export const runtime = "nodejs";

const PERIODOS_VALIDOS: TipoPeriodo[] = ["hoy", "semana", "mes", "personalizado"];

// Contabilidad (Fase 10/P, autorizado) — único endpoint del módulo, de solo
// lectura. SIEMPRE filtrado por el id_tenant que resuelve el token -- nunca
// acepta un id_tenant del navegador. periodo/desde/hasta/especialistaId/
// servicioId son los únicos filtros; especialistaId y servicioId se
// comparan por ID exacto, nunca por coincidencia de texto. Datos
// financieros -- admin-only (Fase P).
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const query = request.nextUrl.searchParams;
  const periodo = (query.get("periodo") ?? "mes") as TipoPeriodo;
  if (!PERIODOS_VALIDOS.includes(periodo)) {
    return Response.json({ error: `'periodo' debe ser una de: ${PERIODOS_VALIDOS.join(", ")}` }, { status: 400 });
  }

  let personalizado: { desde: string; hasta: string } | undefined;
  if (periodo === "personalizado") {
    const desde = query.get("desde");
    const hasta = query.get("hasta");
    if (!desde || !hasta) {
      return Response.json({ error: "El período personalizado requiere 'desde' y 'hasta' (YYYY-MM-DD)" }, { status: 400 });
    }
    personalizado = { desde, hasta };
  }

  const especialistaIdTexto = query.get("especialistaId");
  const especialistaId = especialistaIdTexto ? Number(especialistaIdTexto) : undefined;
  if (especialistaIdTexto && !Number.isInteger(especialistaId)) {
    return Response.json({ error: "'especialistaId' inválido" }, { status: 400 });
  }

  const servicioId = query.get("servicioId") ?? undefined;

  const resultado = await generarReporteContabilidad(supabase, {
    idTenant: tenant.idTenant,
    periodo,
    personalizado,
    especialistaId,
    servicioId,
  });
  if (!resultado.ok) return Response.json({ error: resultado.error }, { status: 400 });

  return Response.json(resultado.reporte);
}
