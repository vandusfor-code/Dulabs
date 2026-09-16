// DuLabs Developer V1 -- Fase 9 (autorizado). Formateo y derivaciones PURAS
// para la UI (testeables sin DOM). No cambian la máquina de estados: solo
// mapean cada estado real a una etiqueta/tono de presentación.

export type Tono = "success" | "warning" | "danger" | "info" | "neutral";

export type EstadoJob = "created" | "queued" | "sending" | "success_confirmed" | "failed_by_meta" | "retry_pending" | "reconciliation_pending";

const JOB_LABEL: Record<EstadoJob, string> = {
  created: "Created",
  queued: "Queued",
  sending: "Sending",
  success_confirmed: "Delivered",
  failed_by_meta: "Failed",
  retry_pending: "Retry pending",
  reconciliation_pending: "Reconciling",
};

const JOB_TONO: Record<EstadoJob, Tono> = {
  created: "neutral",
  queued: "info",
  sending: "info",
  success_confirmed: "success",
  failed_by_meta: "danger",
  retry_pending: "warning",
  reconciliation_pending: "warning",
};

export function labelEstadoJob(status: string): string {
  return JOB_LABEL[status as EstadoJob] ?? status;
}

export function tonoEstadoJob(status: string): Tono {
  return JOB_TONO[status as EstadoJob] ?? "neutral";
}

/** Trunca un wamid largo para mostrarlo sin ocupar toda la fila. Nunca es un secreto, pero es ruidoso. */
export function truncarWamid(wamid: string | null, visibles = 12): string {
  if (!wamid) return "—";
  if (wamid.length <= visibles + 3) return wamid;
  return `${wamid.slice(0, visibles)}…`;
}

/** Porcentaje de uso [0..100]. null si el plan no define límite (ilimitado/configurable). */
export function porcentajeUso(usados: number, incluidos: number | null): number | null {
  if (incluidos === null) return null;
  if (incluidos <= 0) return 100;
  return Math.min(100, Math.round((usados / incluidos) * 100));
}

export type EstadoCuota = "normal" | "cerca" | "limite";

/** Estado de cuota SIN inventar thresholds comerciales: 100% => límite, >=80% => cerca, resto normal. Plan sin límite => siempre normal. */
export function estadoCuota(usados: number, incluidos: number | null): EstadoCuota {
  const pct = porcentajeUso(usados, incluidos);
  if (pct === null) return "normal";
  if (pct >= 100) return "limite";
  if (pct >= 80) return "cerca";
  return "normal";
}

export function tonoEstadoCuota(estado: EstadoCuota): Tono {
  return estado === "limite" ? "danger" : estado === "cerca" ? "warning" : "success";
}

export function tonoEstadoNumero(estado: string): Tono {
  if (estado === "conectado") return "success";
  if (estado === "pendiente") return "warning";
  if (estado === "error") return "danger";
  return "neutral"; // desconectado u otros
}

export function tonoEstadoApiKey(revokedAt: string | null): Tono {
  return revokedAt ? "neutral" : "success";
}

export function labelEstadoApiKey(revokedAt: string | null): string {
  return revokedAt ? "Revoked" : "Active";
}

/** Formatea una fecha ISO a algo corto y legible; nunca lanza ante un valor inválido. */
export function formatearFecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatearFechaHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Muestra un valor numérico o "∞" cuando el plan no define límite. */
export function formatearLimite(valor: number | null): string {
  return valor === null ? "∞" : String(valor);
}
