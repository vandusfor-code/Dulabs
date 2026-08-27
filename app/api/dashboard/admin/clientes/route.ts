import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { obtenerClientesAdmin } from "@/lib/admin-clientes";

export const runtime = "nodejs";

// Lista de clientes del Panel de Operaciones, con filtros por estado de
// implementación, plan, estado de onboarding, y búsqueda libre por
// nombre/correo/teléfono.
export async function GET(request: NextRequest) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;

  let clientes = await obtenerClientesAdmin(acceso.supabase);

  const estadoImplementacion = request.nextUrl.searchParams.get("estado_implementacion");
  const plan = request.nextUrl.searchParams.get("plan");
  const estadoOnboarding = request.nextUrl.searchParams.get("estado_onboarding");
  const estadoPago = request.nextUrl.searchParams.get("estado_pago");
  const q = request.nextUrl.searchParams.get("q")?.trim().toLowerCase();
  // Allowlist explícito -- nunca se usa un valor del query string directo
  // como criterio de orden sin validar contra esta lista.
  type Orden = "reciente" | "antiguo" | "actualizado";
  const ORDENES_VALIDOS: Orden[] = ["reciente", "antiguo", "actualizado"];
  const ordenSolicitado = request.nextUrl.searchParams.get("orden");
  const ordenSeguro: Orden = (ORDENES_VALIDOS as string[]).includes(ordenSolicitado ?? "") ? (ordenSolicitado as Orden) : "reciente";

  if (estadoImplementacion) {
    clientes = clientes.filter((c) => c.onboarding?.estadoImplementacion === estadoImplementacion);
  }
  if (plan) {
    clientes = clientes.filter((c) => c.plan === plan);
  }
  if (estadoOnboarding) {
    clientes = clientes.filter((c) => c.onboarding?.estado === estadoOnboarding);
  }
  if (estadoPago) {
    clientes = clientes.filter((c) => c.estadoPago === estadoPago);
  }
  if (q) {
    clientes = clientes.filter(
      (c) =>
        (c.nombre ?? "").toLowerCase().includes(q) ||
        (c.correo ?? "").toLowerCase().includes(q) ||
        (c.telefono ?? "").toLowerCase().includes(q)
    );
  }

  if (ordenSeguro === "antiguo") {
    clientes = [...clientes].sort((a, b) => new Date(a.fechaCompra).getTime() - new Date(b.fechaCompra).getTime());
  } else if (ordenSeguro === "actualizado") {
    clientes = [...clientes].sort((a, b) => {
      const fa = a.onboarding?.actualizadoAt ?? a.fechaCompra;
      const fb = b.onboarding?.actualizadoAt ?? b.fechaCompra;
      return new Date(fb).getTime() - new Date(fa).getTime();
    });
  } else {
    clientes = [...clientes].sort((a, b) => new Date(b.fechaCompra).getTime() - new Date(a.fechaCompra).getTime());
  }

  return Response.json({ clientes });
}
