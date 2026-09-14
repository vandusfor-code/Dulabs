"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { FlowBuilder } from "@/components/dashboard/flows/FlowBuilder";
import { useDashboard } from "@/lib/dashboard-session";

// F15.1 (Admin Flow Studio, autorizado) -- único consumidor admin del
// FlowBuilder reusable (components/dashboard/flows/FlowBuilder.tsx, el
// MISMO componente que /dashboard/flows/[id] usa para clientes editando su
// propio Flow -- nunca un segundo builder). `?tenant=` es obligatorio acá:
// esta ruta SOLO existe para que un admin de DuLabs opere el Flow de un
// cliente (ver lib/flow/api-auth.ts::requireFlowAccess/allowAdminOverride) --
// el nombre del cliente se resuelve server-side (GET .../admin/clientes/
// [idTenant], YA EXISTENTE, misma llamada que ya hace /admin/clientes/
// [idTenant]) solo para el breadcrumb visible del header, nunca para
// decidir autorización (eso lo hace el backend con el Bearer token real).
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

  if (!tenant) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5 text-fg">
        <p className="max-w-md rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">
          Falta el parámetro &quot;tenant&quot; -- Flow Studio solo se abre desde el Panel de Operaciones (Admin → Cliente → Flows).
        </p>
      </main>
    );
  }

  return (
    <FlowBuilder
      flowId={params.flowId}
      adminTenantId={tenant}
      adminTenantName={tenantName ?? tenant}
      colorMode="light"
      backHref={`/admin/clientes/${tenant}`}
    />
  );
}
