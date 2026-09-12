"use client";

/**
 * Fase 4 (Self-Service Flow Activation, autorizado) — panel para activar/
 * desactivar ESTE Flow en un número de WhatsApp del tenant, sin intervención
 * manual de DuLabs. Habla EXCLUSIVAMENTE con
 * `POST /api/flows/[id]/activate` y `POST /api/flows/[id]/deactivate` (vía
 * lib/flow-builder/activate-flow.ts) -- la API es la única autoridad real
 * (rol, ownership, status "published", anti-secuestro de número); este panel
 * solo transporta la petición y refresca `negocios` tras un cambio exitoso.
 *
 * Lista de números: reutiliza `negocios` de useDashboard() (ya cargado por
 * el resto del dashboard, incluye flow_activo/flow_id por número) -- no
 * pide un endpoint nuevo solo para esto.
 */

import { useMemo, useState } from "react";
import { CheckCircle2, Smartphone, TriangleAlert, X } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { activateFlow, deactivateFlow } from "@/lib/flow-builder/activate-flow";
import { Pill } from "@/components/dashboard/shell/ui";
import type { FlowRecordStatus } from "@/lib/flow/flow-store-types";

export interface FlowActivationPanelProps {
  open: boolean;
  onClose: () => void;
  flowId: string;
  flowName: string;
  flowStatus: FlowRecordStatus;
}

export function FlowActivationPanel({ open, onClose, flowId, flowName, flowStatus }: FlowActivationPanelProps) {
  const { session, negocios, cargarNegocios } = useDashboard();
  const [selectedPhoneNumberId, setSelectedPhoneNumberId] = useState<string | null>(null);
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const seleccionado = useMemo(
    () => negocios?.find((n) => n.phone_number_id === selectedPhoneNumberId) ?? null,
    [negocios, selectedPhoneNumberId],
  );

  if (!open) return null;

  const puedeActivar = flowStatus === "published";

  async function ejecutarActivacion(): Promise<void> {
    if (!session || !selectedPhoneNumberId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await activateFlow({ flowId, phoneNumberId: selectedPhoneNumberId, accessToken: session.access_token });
    setBusy(false);
    setConfirmingReplace(false);
    if (result.ok) {
      setSuccess(`Flow activado en ${seleccionado?.nombre_negocio ?? selectedPhoneNumberId}.`);
      await cargarNegocios();
    } else {
      setError(result.error.message);
    }
  }

  function handleActivarClick(): void {
    if (!seleccionado) return;
    const yaTieneOtroFlowActivo = seleccionado.flow_activo && seleccionado.flow_id !== flowId;
    if (yaTieneOtroFlowActivo && !confirmingReplace) {
      setConfirmingReplace(true);
      return;
    }
    void ejecutarActivacion();
  }

  async function handleDesactivarClick(): Promise<void> {
    if (!session || !selectedPhoneNumberId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await deactivateFlow({ flowId, phoneNumberId: selectedPhoneNumberId, accessToken: session.access_token });
    setBusy(false);
    if (result.ok) {
      setSuccess(`Flow desactivado en ${seleccionado?.nombre_negocio ?? selectedPhoneNumberId}.`);
      await cargarNegocios();
    } else {
      setError(result.error.message);
    }
  }

  const estaActivoAqui = Boolean(seleccionado?.flow_activo && seleccionado.flow_id === flowId);
  const yaTieneOtroFlowActivo = Boolean(seleccionado?.flow_activo && seleccionado.flow_id !== flowId);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50" role="dialog" aria-modal="true">
      <div className="flex h-full w-full max-w-lg flex-col border-l border-edge bg-card shadow-2xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-edge px-5 py-3">
          <Smartphone className="size-4 text-mist" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">Activar en WhatsApp</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-mist hover:bg-ink hover:text-fg">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!puedeActivar ? (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-400">
              <TriangleAlert className="mb-2 size-4" />
              Publica <span className="font-medium">{flowName}</span> antes de activarlo en un número de WhatsApp.
            </div>
          ) : !negocios ? (
            <p className="text-sm text-mist">Cargando números…</p>
          ) : negocios.length === 0 ? (
            <p className="text-sm text-mist">Todavía no tienes ningún número de WhatsApp conectado.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-widest text-mist">Elige el número</p>
                <div className="flex flex-col gap-2">
                  {negocios.map((n) => {
                    const activoAqui = n.flow_activo && n.flow_id === flowId;
                    const activoConOtro = n.flow_activo && n.flow_id !== flowId;
                    const checked = n.phone_number_id === selectedPhoneNumberId;
                    return (
                      <label
                        key={n.phone_number_id}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                          checked ? "border-lime/50 bg-lime/5" : "border-edge hover:border-edge/80"
                        }`}
                      >
                        <input
                          type="radio"
                          name="flow-activation-numero"
                          className="shrink-0"
                          checked={checked}
                          onChange={() => {
                            setSelectedPhoneNumberId(n.phone_number_id);
                            setConfirmingReplace(false);
                            setError(null);
                            setSuccess(null);
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-fg">{n.nombre_negocio}</div>
                          <div className="truncate text-xs text-mist">{n.telefono_negocio}</div>
                        </div>
                        {activoAqui && <Pill tone="success">Activo (este Flow)</Pill>}
                        {activoConOtro && <Pill tone="warning">Otro Flow activo</Pill>}
                      </label>
                    );
                  })}
                </div>
              </div>

              {yaTieneOtroFlowActivo && confirmingReplace && (
                <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-400">
                  <TriangleAlert className="mb-2 size-4" />
                  Este número ya tiene otro Flow activo. Si continúas, será <span className="font-medium">reemplazado</span> por{" "}
                  <span className="font-medium">{flowName}</span>.
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmingReplace(false)}
                      className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg hover:border-edge/80"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleActivarClick}
                      disabled={busy}
                      className="rounded-lg bg-lime px-3 py-1.5 text-xs font-semibold text-lime-fg hover:bg-lime-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? "Reemplazando…" : "Sí, reemplazar"}
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                  <TriangleAlert className="size-4 shrink-0" /> {error}
                </div>
              )}
              {success && (
                <div className="flex items-center gap-2 rounded-xl border border-lime/30 bg-lime/10 p-3 text-sm text-lime-text">
                  <CheckCircle2 className="size-4 shrink-0" /> {success}
                </div>
              )}

              {selectedPhoneNumberId && !confirmingReplace && (
                <div className="flex justify-end gap-2">
                  {estaActivoAqui ? (
                    <button
                      type="button"
                      onClick={() => void handleDesactivarClick()}
                      disabled={busy}
                      className="rounded-lg border border-red-500/40 px-3.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? "Desactivando…" : "Desactivar"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleActivarClick}
                      disabled={busy}
                      className="rounded-lg bg-lime px-3.5 py-1.5 text-xs font-semibold text-lime-fg hover:bg-lime-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? "Activando…" : "Activar en este número"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
