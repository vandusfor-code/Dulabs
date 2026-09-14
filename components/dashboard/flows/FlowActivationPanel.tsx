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

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Smartphone, TriangleAlert, X } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { activateFlow, deactivateFlow } from "@/lib/flow-builder/activate-flow";
import { activateTriggerRouter, deactivateTriggerRouter } from "@/lib/flow-builder/trigger-router-activation";
import { Pill } from "@/components/dashboard/shell/ui";
import type { FlowRecordStatus } from "@/lib/flow/flow-store-types";

interface NumeroActivable {
  phone_number_id: string;
  nombre_negocio: string;
  telefono_negocio: string;
  flow_activo: boolean;
  flow_id: string | null;
  trigger_routing_activo: boolean;
}

export interface FlowActivationPanelProps {
  open: boolean;
  onClose: () => void;
  flowId: string;
  flowName: string;
  flowStatus: FlowRecordStatus;
  /** F15.1 (Admin Flow Studio, autorizado) -- cuando lo opera un admin de DuLabs, los números a activar son del CLIENTE, nunca de la propia cuenta del admin (ver .../admin/clientes/[idTenant]/flow, reutilizado tal cual acá). */
  adminTenantId?: string;
}

export function FlowActivationPanel({ open, onClose, flowId, flowName, flowStatus, adminTenantId }: FlowActivationPanelProps) {
  const { session, negocios, cargarNegocios } = useDashboard();
  const [selectedPhoneNumberId, setSelectedPhoneNumberId] = useState<string | null>(null);
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // FASE F8.2 (Trigger Router SaaS -- Self-Service Activation, autorizado) --
  // estado propio, separado del de arriba: activar/desactivar el Router
  // nunca debe pisar un mensaje de error/éxito de activar/desactivar el Flow.
  const [triggerRouterBusy, setTriggerRouterBusy] = useState(false);
  const [triggerRouterError, setTriggerRouterError] = useState<string | null>(null);

  // F15.1 (Admin Flow Studio, autorizado) -- en modo admin, los números
  // vienen de GET /api/dashboard/admin/clientes/[idTenant]/flow (F15, YA
  // EXISTENTE), no de useDashboard().negocios (esos son SIEMPRE del propio
  // tenant del admin, nunca del cliente que está administrando).
  const [adminNumeros, setAdminNumeros] = useState<NumeroActivable[] | null>(null);
  const [adminNumerosError, setAdminNumerosError] = useState<string | null>(null);

  async function recargarAdminNumeros(): Promise<void> {
    if (!session || !adminTenantId) return;
    const res = await fetch(`/api/dashboard/admin/clientes/${adminTenantId}/flow`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAdminNumerosError(data.error ?? "Error cargando los números del cliente");
      return;
    }
    setAdminNumerosError(null);
    setAdminNumeros(
      (data.numeros ?? []).map((n: { phoneNumberId: string; nombreNegocio: string; telefonoNegocio: string; flowActivo: boolean; flowId: string | null; triggerRoutingActivo: boolean }) => ({
        phone_number_id: n.phoneNumberId,
        nombre_negocio: n.nombreNegocio,
        telefono_negocio: n.telefonoNegocio,
        flow_activo: n.flowActivo,
        flow_id: n.flowId,
        trigger_routing_activo: n.triggerRoutingActivo,
      })),
    );
  }

  useEffect(() => {
    if (!open || !adminTenantId) return;
    void (async () => {
      await recargarAdminNumeros();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, adminTenantId, session]);

  const numerosDisponibles: NumeroActivable[] | null = adminTenantId ? adminNumeros : (negocios ?? null);

  const seleccionado = useMemo(
    () => numerosDisponibles?.find((n) => n.phone_number_id === selectedPhoneNumberId) ?? null,
    [numerosDisponibles, selectedPhoneNumberId],
  );

  if (!open) return null;

  const puedeActivar = flowStatus === "published";

  async function ejecutarActivacion(): Promise<void> {
    if (!session || !selectedPhoneNumberId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = adminTenantId
      ? await ejecutarAccionAdmin("activar")
      : await activateFlow({ flowId, phoneNumberId: selectedPhoneNumberId, accessToken: session.access_token });
    setBusy(false);
    setConfirmingReplace(false);
    if (result.ok) {
      setSuccess(`Flow activado en ${seleccionado?.nombre_negocio ?? selectedPhoneNumberId}.`);
      if (adminTenantId) await recargarAdminNumeros();
      else await cargarNegocios();
    } else {
      setError(result.error.message);
    }
  }

  // F15.1 (Admin Flow Studio, autorizado) -- reusa TAL CUAL el endpoint de
  // activación por número que ya existe desde F15
  // (activarFlowParaNumero/desactivarFlowParaNumero vía
  // app/api/dashboard/admin/clientes/[idTenant]/flow, ya auditado con
  // ACTIVATE_FLOW/DEACTIVATE_FLOW) -- nunca una segunda lógica de
  // activación para el caso admin.
  async function ejecutarAccionAdmin(accion: "activar" | "desactivar"): Promise<{ ok: true } | { ok: false; error: { message: string } }> {
    if (!session || !selectedPhoneNumberId || !adminTenantId) return { ok: false, error: { message: "Falta selección" } };
    const res = await fetch(`/api/dashboard/admin/clientes/${adminTenantId}/flow`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ phone_number_id: selectedPhoneNumberId, flow_id: flowId, accion }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: { message: data.error ?? "Error inesperado" } };
    return { ok: true };
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
    const result = adminTenantId
      ? await ejecutarAccionAdmin("desactivar")
      : await deactivateFlow({ flowId, phoneNumberId: selectedPhoneNumberId, accessToken: session.access_token });
    setBusy(false);
    if (result.ok) {
      setSuccess(`Flow desactivado en ${seleccionado?.nombre_negocio ?? selectedPhoneNumberId}.`);
      if (adminTenantId) await recargarAdminNumeros();
      else await cargarNegocios();
    } else {
      setError(result.error.message);
    }
  }

  const estaActivoAqui = Boolean(seleccionado?.flow_activo && seleccionado.flow_id === flowId);
  const yaTieneOtroFlowActivo = Boolean(seleccionado?.flow_activo && seleccionado.flow_id !== flowId);

  // FASE F8.2 (Trigger Router SaaS -- Self-Service Activation, autorizado) --
  // solo tiene sentido mostrarlo/tocarlo cuando ESTE Flow ya está activo en
  // el número elegido (mismo requisito que exige la API real).
  async function handleToggleTriggerRouter(): Promise<void> {
    if (!session || !selectedPhoneNumberId || !seleccionado) return;
    setTriggerRouterBusy(true);
    setTriggerRouterError(null);
    const result = seleccionado.trigger_routing_activo
      ? await deactivateTriggerRouter({ flowId, phoneNumberId: selectedPhoneNumberId, accessToken: session.access_token })
      : await activateTriggerRouter({ flowId, phoneNumberId: selectedPhoneNumberId, accessToken: session.access_token });
    setTriggerRouterBusy(false);
    if (result.ok) {
      await cargarNegocios();
    } else {
      setTriggerRouterError(result.error.message);
    }
  }

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
          ) : adminNumerosError ? (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              <TriangleAlert className="size-4 shrink-0" /> {adminNumerosError}
            </div>
          ) : !numerosDisponibles ? (
            <p className="text-sm text-mist">Cargando números…</p>
          ) : numerosDisponibles.length === 0 ? (
            <p className="text-sm text-mist">{adminTenantId ? "Este cliente todavía no tiene ningún número de WhatsApp conectado." : "Todavía no tienes ningún número de WhatsApp conectado."}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-widest text-mist">Elige el número</p>
                <div className="flex flex-col gap-2">
                  {numerosDisponibles.map((n) => {
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

              {/* FASE F8.2 (Trigger Router SaaS -- Self-Service Activation,
                  autorizado) -- solo visible cuando ESTE Flow ya está activo
                  en el número elegido (mismo requisito que la API real).
                  F15.1: oculto en modo admin -- no existe (ni se pidió) un
                  endpoint admin equivalente para el Trigger Router SaaS,
                  distinto de la activación simple de Flow. */}
              {estaActivoAqui && !adminTenantId && (
                <div className="rounded-xl border border-edge bg-ink p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg">Trigger Router</p>
                      <p className="mt-0.5 text-xs text-mist">
                        Cuando está activo, un mensaje nuevo puede disparar otro Flow según sus triggers configurados
                        (keyword, etc.) antes de caer en este Flow por defecto.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleToggleTriggerRouter()}
                      disabled={triggerRouterBusy}
                      className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                        seleccionado?.trigger_routing_activo
                          ? "border-red-500/40 text-red-400 hover:bg-red-500/10"
                          : "border-lime/40 text-lime-text hover:bg-lime/10"
                      }`}
                    >
                      {triggerRouterBusy
                        ? "…"
                        : seleccionado?.trigger_routing_activo
                          ? "Desactivar"
                          : "Activar"}
                    </button>
                  </div>
                  {triggerRouterError && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400">
                      <TriangleAlert className="size-3.5 shrink-0" /> {triggerRouterError}
                    </div>
                  )}
                </div>
              )}
              {!estaActivoAqui && !adminTenantId && selectedPhoneNumberId && !confirmingReplace && (
                <div className="rounded-xl border border-edge bg-ink/50 p-4">
                  <p className="text-sm font-medium text-mist">Trigger Router</p>
                  <p className="mt-0.5 text-xs text-mist/70">
                    Activa este Flow en este número antes de poder usar el Trigger Router.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
