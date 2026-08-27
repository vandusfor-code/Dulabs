import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { obtenerClientesAdmin, type EstadoImplementacion } from "@/lib/admin-clientes";

export const runtime = "nodejs";

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
const TREINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

function promedioHoras(pares: { desde: string; hasta: string }[]): number | null {
  if (pares.length === 0) return null;
  const totalMs = pares.reduce((acc, p) => acc + (new Date(p.hasta).getTime() - new Date(p.desde).getTime()), 0);
  return Math.round((totalMs / pares.length / (60 * 60 * 1000)) * 10) / 10;
}

// Dashboard del Panel de Operaciones: conteos operativos, "qué necesita mi
// atención hoy" (Fase 6), y tiempos promedio reales (Fase 9) -- ningún
// número se inventa: si un timestamp no existe todavía para ese cliente,
// simplemente no entra en el promedio (nunca se aproxima).
export async function GET(request: NextRequest) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;

  const clientes = await obtenerClientesAdmin(acceso.supabase);

  const ahora = Date.now();
  const clientesNuevos7d = clientes.filter((c) => ahora - new Date(c.fechaCompra).getTime() <= SIETE_DIAS_MS).length;
  const clientesNuevos30d = clientes.filter((c) => ahora - new Date(c.fechaCompra).getTime() <= TREINTA_DIAS_MS).length;

  const { data: pagosRecientesData, error: pagosError } = await acceso.supabase
    .from("dulabs_pagos")
    .select("id, id_tenant, monto_cop, estado, created_at")
    .eq("tipo", "suscripcion")
    .order("created_at", { ascending: false })
    .limit(10);
  if (pagosError) return Response.json({ error: pagosError.message }, { status: 500 });

  const montoTotalReciente = (pagosRecientesData ?? [])
    .filter((p) => p.estado === "APPROVED")
    .reduce((acc, p) => acc + p.monto_cop, 0);

  const contadoresImplementacion: Record<EstadoImplementacion, number> = {
    PENDIENTE: 0,
    EN_CONFIGURACION: 0,
    EN_PRUEBAS: 0,
    ACTIVO: 0,
    REQUIERE_ATENCION: 0,
  };
  const contadoresOnboarding = { pendiente: 0, completado: 0, soporteSolicitado: 0 };
  for (const c of clientes) {
    if (c.onboarding) {
      contadoresImplementacion[c.onboarding.estadoImplementacion]++;
      if (c.onboarding.estado === "completado") contadoresOnboarding.completado++;
      else if (c.onboarding.estado === "soporte_solicitado") contadoresOnboarding.soporteSolicitado++;
      else contadoresOnboarding.pendiente++;
    }
  }

  const totalClientes = clientes.length;
  const clientesActivos = contadoresImplementacion.ACTIVO;

  // "Qué necesita que yo haga algo hoy" (Fase 6) -- grupos, no una sola
  // lista plana, porque cada grupo implica una acción distinta.
  const mini = (c: (typeof clientes)[number]) => ({ idTenant: c.idTenant, nombre: c.nombre, plan: c.plan });
  const atencion = {
    // Pago confirmado pero nunca se le pudo mandar la bienvenida (sin
    // teléfono al momento de pagar) -- caso real encontrado en la auditoría.
    sinTelefonoParaOnboarding: clientes.filter((c) => !c.telefono).map(mini),
    onboardingCompletadoSinConfigurar: clientes
      .filter((c) => c.onboarding?.estado === "completado" && c.onboarding.estadoImplementacion === "PENDIENTE")
      .map(mini),
    enConfiguracion: clientes.filter((c) => c.onboarding?.estadoImplementacion === "EN_CONFIGURACION").map(mini),
    enPruebas: clientes.filter((c) => c.onboarding?.estadoImplementacion === "EN_PRUEBAS").map(mini),
    requiereAtencion: clientes.filter((c) => c.onboarding?.estadoImplementacion === "REQUIERE_ATENCION").map(mini),
  };

  // Fase 9 -- tiempos promedio. Solo con los pares de timestamps que
  // REALMENTE existen (nunca se inventa ni se aproxima).
  const tiempoPagoAConfiguracion = promedioHoras(
    clientes
      .filter((c) => c.onboarding?.implementacionIniciadaAt)
      .map((c) => ({ desde: c.fechaCompra, hasta: c.onboarding!.implementacionIniciadaAt! }))
  );
  const tiempoPagoAActivacion = promedioHoras(
    clientes.filter((c) => c.onboarding?.activadoAt).map((c) => ({ desde: c.fechaCompra, hasta: c.onboarding!.activadoAt! }))
  );

  const clientesRecientes = clientes.slice(0, 10).map((c) => ({
    idTenant: c.idTenant,
    nombre: c.nombre,
    plan: c.plan,
    fechaCompra: c.fechaCompra,
    estadoPago: c.estadoPago,
    estadoImplementacion: c.onboarding?.estadoImplementacion ?? null,
  }));

  return Response.json({
    totalClientes,
    clientesActivos,
    clientesNuevos: clientesNuevos7d,
    clientesNuevos30d,
    pagosRecientes: pagosRecientesData,
    montoTotalReciente,
    contadoresImplementacion,
    contadoresOnboarding,
    atencion,
    metricas: { tiempoPagoAConfiguracionHoras: tiempoPagoAConfiguracion, tiempoPagoAActivacionHoras: tiempoPagoAActivacion },
    clientesRecientes,
  });
}
