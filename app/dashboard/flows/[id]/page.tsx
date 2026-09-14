"use client";

import { useParams } from "next/navigation";
import { FlowBuilder } from "@/components/dashboard/flows/FlowBuilder";

// Flow Builder de un cliente sobre su propio tenant (sin adminTenantId, sin
// colorMode/backHref -- defaults idénticos al comportamiento previo a
// F15.1). El componente en sí vive en components/dashboard/flows/
// FlowBuilder.tsx, reutilizado también por /flow-studio/[flowId] para el
// caso admin -- este archivo es deliberadamente un wrapper delgado, nunca
// una segunda implementación del builder.
export default function FlowBuilderPage() {
  const params = useParams();
  const flowId = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");
  return <FlowBuilder flowId={flowId} />;
}
