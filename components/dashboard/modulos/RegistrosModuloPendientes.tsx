"use client";

/**
 * Aviso GENÉRICO de registros de módulo sin completar (acción `registrar_en_modulo`): cualquier
 * módulo lo usa pasando su id. No se muestra si no hay nada pendiente ni fallido; si lo hay,
 * dice cuántos, cuáles y por qué, y permite reprocesarlos (admin/agente). Solo presentación:
 * la API (/api/dashboard/modulos/registros) autoriza por tenant, rol y módulo habilitado.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Pill } from "@/components/dashboard/shell/ui";
import { actionBtn } from "@/components/dashboard/business-agent/ui";
import { useI18n } from "@/lib/i18n";
import type { ResumenRegistrosModulo } from "@/lib/flow/registro-modulo";

export function RegistrosModuloPendientes({
  modulo,
  token,
  puedeEditar,
  etiqueta,
  onCambio,
}: {
  modulo: string;
  token: string | null;
  puedeEditar: boolean;
  /** Qué registra el módulo, en plural (p. ej. "solicitudes"). */
  etiqueta: { es: string; en: string };
  /** Se llama cuando un reproceso registró algo (para recargar la lista del módulo). */
  onCambio?: () => void;
}) {
  const { t } = useI18n();
  const [resumen, setResumen] = useState<ResumenRegistrosModulo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    fetch(`/api/dashboard/modulos/registros?modulo=${encodeURIComponent(modulo)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "error");
        if (vivo) {
          setResumen(data as ResumenRegistrosModulo);
          setError(null);
        }
      })
      .catch((err) => {
        if (vivo) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      vivo = false;
    };
  }, [modulo, token, recarga]);

  const accion = useCallback(
    async (cuerpo: Record<string, unknown>) => {
      if (!token) return;
      setOcupado(true);
      try {
        const res = await fetch("/api/dashboard/modulos/registros", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ modulo, ...cuerpo }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "error");
        if ((data as { registrados?: number }).registrados) onCambio?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setOcupado(false);
        setRecarga((n) => n + 1);
      }
    },
    [modulo, token, onCambio],
  );

  if (error && !resumen) {
    return (
      <div role="alert" className="mt-5 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-400">
        {t("No se pudo verificar si hay registros pendientes: ", "Couldn't check for pending records: ")}
        {error}
      </div>
    );
  }
  if (!resumen || resumen.pendientes + resumen.fallidos === 0) return null;

  const nombre = t(etiqueta.es, etiqueta.en);
  return (
    <section role="alert" className="mt-5 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-400" />
          <div>
            <p className="text-sm font-medium text-fg">
              {t(`Hay ${nombre} que no se pudieron registrar`, `Some ${nombre} couldn't be recorded`)}
            </p>
            <p className="mt-1 text-xs text-mist">
              {t(
                "El cliente sí pasó a la asesora. Los pendientes se reintentan solos; los fallidos necesitan revisión.",
                "The customer was handed to an advisor. Pending ones retry automatically; failed ones need review.",
              )}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {resumen.pendientes > 0 && <Pill tone="warning">{resumen.pendientes} {t("pendientes", "pending")}</Pill>}
              {resumen.fallidos > 0 && <Pill tone="danger">{resumen.fallidos} {t("fallidos", "failed")}</Pill>}
            </div>
          </div>
        </div>
        {puedeEditar && (
          <button type="button" className={actionBtn} disabled={ocupado} onClick={() => accion({ accion: "reprocesar" })}>
            <RefreshCw className={ocupado ? "size-4 animate-spin" : "size-4"} />
            {t("Reprocesar ahora", "Retry now")}
          </button>
        )}
      </div>
      <ul className="mt-3 divide-y divide-edge rounded-lg border border-edge bg-card text-xs">
        {resumen.filas.map((f) => (
          <li key={f.id} className="flex flex-col gap-1 px-3 py-2 md:flex-row md:items-center md:justify-between">
            <span className="text-fg">
              {f.telefono} · {new Date(f.createdAt).toLocaleString()} ·{" "}
              <Pill tone={f.estado === "fallido" ? "danger" : "warning"}>{f.estado === "fallido" ? t("Fallido", "Failed") : t("Pendiente", "Pending")}</Pill>
            </span>
            <span className="flex items-center gap-3 text-mist">
              {t("Intentos", "Attempts")}: {f.intentos}
              {f.ultimoError && ` · ${f.ultimoError}`}
              {puedeEditar && f.estado === "fallido" && (
                <button type="button" className="text-lime-text underline disabled:opacity-50" disabled={ocupado} onClick={() => accion({ accion: "reencolar", id: f.id })}>
                  {t("Reintentar", "Retry")}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
