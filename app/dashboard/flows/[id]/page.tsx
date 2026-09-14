"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

// F16.1 (Flow Studio, autorizado) -- decisión de negocio explícita: "todos
// ven el editor nuevo, sin importar por dónde entren". Antes este archivo
// renderizaba FlowBuilder directamente en modo oscuro (el editor viejo,
// dentro del sidebar normal del dashboard) -- ahora redirige a
// /flow-studio/[id] (sin ?tenant=, ese caso es exclusivo del admin operando
// el Flow de un cliente desde /admin) -- MISMO componente FlowBuilder,
// MISMA autorización (el tenant sigue siendo el de la sesión real, nunca
// cambia), solo el tema/layout con el que se ve. Client-side redirect
// (useRouter) en vez de redirect() de servidor -- mismo patrón que el
// resto de este proyecto, que no usa redirects de servidor en páginas.
export default function FlowBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const flowId = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");

  useEffect(() => {
    if (flowId) router.replace(`/flow-studio/${flowId}`);
  }, [flowId, router]);

  return null;
}
