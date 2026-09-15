import type { EstadoJob } from "@/lib/developer/outbound-state-machine";

// DuLabs Developer V1 -- Fase 4 (autorizado, decisión D4). Separación
// INTERNAL STATE vs. PUBLIC API STATUS -- nunca se expone lease_id,
// version_token, network_attempts ni physical_outcome crudo al
// desarrollador. `processing` NO implica que Meta haya confirmado nada --
// deliberadamente incluye tanto "sending" (real, en curso) como
// "reconciliation_pending" (incierto, sin confirmación automática real --
// ver riesgo #4 de Fase 3, no resuelto, no se inventa una confirmación
// acá). No se cambia la máquina de estados de Fase 1 -- esto es solo un
// mapeo de lectura.

export type EstadoPublicoJob = "queued" | "processing" | "sent" | "failed";

const MAPA: Record<EstadoJob, EstadoPublicoJob> = {
  created: "queued",
  queued: "queued",
  retry_pending: "queued",
  sending: "processing",
  reconciliation_pending: "processing",
  success_confirmed: "sent",
  failed_by_meta: "failed",
};

export function estadoPublicoDelJob(estadoInterno: EstadoJob): EstadoPublicoJob {
  return MAPA[estadoInterno];
}
