"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { FlowBuilder } from "@/components/dashboard/flows/FlowBuilder";
import { useDashboard } from "@/lib/dashboard-session";

// F15.1/F16.1 (Flow Studio, autorizado) -- único consumidor del FlowBuilder
// reusable (components/dashboard/flows/FlowBuilder.tsx -- nunca un segundo
// builder), para AMBOS casos:
//   - con `?tenant=` -- un admin de DuLabs operando el Flow de un cliente
//     (ver lib/flow/api-auth.ts::requireFlowAccess/allowAdminOverride); el
//     nombre del cliente se resuelve server-side solo para el breadcrumb,
//     nunca para decidir autorización (eso lo hace el backend con el Bearer
//     token real).
//   - sin `?tenant=` -- cualquier usuario (cliente o admin) editando SU
//     PROPIO Flow. adminTenantId queda undefined y FlowBuilder/las rutas de
//     /api/flows/* usan el tenant de la sesión real, exactamente el mismo
//     camino que ya usaban antes de esta fase -- nunca se inventa un
//     segundo mecanismo de autorización.
// F16.1 -- /dashboard/flows/[id] (decisión de negocio: "todos ven el
// editor nuevo, sin importar por dónde entren") ahora REDIRIGE acá sin
// tenant -- ver ese archivo. colorMode es SIEMPRE "light" en esta ruta,
// para ambos casos.
export default function FlowStudioPage() {
  const params = useParams<{ flowId: string }>();
  const searchParams = useSearchParams();
  const tenant = searchParams.get("tenant");
  const { session } = useDashboard();
  const [tenantName, setTenantName] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !tenant) return;
    let cancelled = false;
    fetch(`/api/dashboard/admin/clientes/${tenant}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setTenantName(data?.cliente?.nombre ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, tenant]);

  return (
    <FlowBuilder
      flowId={params.flowId}
      adminTenantId={tenant ?? undefined}
      adminTenantName={tenant ? (tenantName ?? tenant) : undefined}
      colorMode="light"
      backHref={tenant ? `/admin/clientes/${tenant}` : "/dashboard/flows"}
    />
  );
}
