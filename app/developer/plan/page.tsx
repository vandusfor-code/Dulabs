"use client";

import { useState } from "react";
import { useDeveloper } from "@/lib/dev-dashboard/developer-session";
import { useDevResource } from "@/lib/dev-dashboard/use-dev-resource";
import { PageHeader } from "@/components/developer/PageHeader";
import { StatCard } from "@/components/developer/StatCard";
import { UsageProgress } from "@/components/developer/UsageProgress";
import { StatusBadge } from "@/components/developer/StatusBadge";
import { ErrorState } from "@/components/developer/ErrorState";
import { EmptyState } from "@/components/developer/EmptyState";
import { CardsSkeleton } from "@/components/developer/Skeleton";
import { BillingCheckout } from "@/components/developer/BillingCheckout";
import { formatearLimite } from "@/lib/dev-dashboard/dev-format";
import { DevApiError, type SubscriptionResp } from "@/lib/dev-dashboard/dev-client";

// DuLabs Developer V1 -- Fase 12 (Billing, Wompi). Plan & Billing. Precio
// canónico USD; anual = x10 (2 meses gratis). Con billing ON, el upgrade abre
// checkout (pago) y el downgrade queda programado al fin de período. Enterprise
// es manual (CTA a ventas). Los importes mostrados son indicativos: el cobro
// real lo resuelve el backend server-side (nunca el frontend).

type Intervalo = "month" | "year";
const SALES_EMAIL = process.env.NEXT_PUBLIC_DEVELOPER_SALES_EMAIL;

const PLANES: { codigo: string; label: string; mensualUsd: number; resumen: string; manual?: boolean }[] = [
  { codigo: "DEVELOPER", label: "Developer", mensualUsd: 19, resumen: "2 números · 20K mensajes/mes · 1 workspace · 1 miembro" },
  { codigo: "AGENCY", label: "Agency", mensualUsd: 45, resumen: "5 números · 100K mensajes/mes · 5 workspaces · 5 miembros · +$5/número extra" },
  { codigo: "ENTERPRISE", label: "Enterprise", mensualUsd: 199, resumen: "Límites personalizados · números adicionales · acuerdo comercial", manual: true },
];
const mensualDe = (codigo: string) => PLANES.find((p) => p.codigo === codigo)?.mensualUsd ?? 0;

function precioLabel(mensualUsd: number, intervalo: Intervalo): string {
  return intervalo === "year" ? `$${mensualUsd * 10}/año` : `$${mensualUsd}/mes`;
}

export default function PlanPage() {
  const { client, rol, selectedWorkspaceId, email } = useDeveloper();
  const esOwner = rol === "OWNER";
  const { data, loading, error, reload } = useDevResource<SubscriptionResp | null>(selectedWorkspaceId, async () =>
    selectedWorkspaceId ? await client.subscription.get() : null
  );
  const [intervalo, setIntervalo] = useState<Intervalo>("month");
  const [accion, setAccion] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
  const [checkout, setCheckout] = useState<{ plan: string; label: string; precio: string } | null>(null);

  const billingOn = data?.billing?.enabled ?? false;

  async function onAccionPlan(codigo: string, label: string, mensualUsd: number) {
    if (!esOwner || accion || !data) return;
    setAviso(null);
    if (codigo === data.plan) return;
    if (codigo === "ENTERPRISE") return; // CTA de ventas
    const esUpgrade = mensualUsd > mensualDe(data.plan);
    if (billingOn && esUpgrade) {
      setCheckout({ plan: codigo, label, precio: precioLabel(mensualUsd, intervalo) });
      return;
    }
    // Downgrade (ON => programado / OFF => inmediato) o upgrade con billing OFF (inmediato, Fase 11).
    setAccion(codigo);
    try {
      const r = await client.subscription.changePlan(codigo);
      setAviso({ tono: "ok", texto: r.scheduledDowngradeTo ? `Downgrade a ${codigo} programado para el fin del período actual.` : `Plan actualizado a ${codigo}.` });
      reload();
    } catch (err) {
      const msg =
        err instanceof DevApiError
          ? err.code === "downgrade_blocked"
            ? `No se puede bajar de plan: tienes recursos por encima del nuevo límite (${err.detalle ?? ""}). Reduce números/workspaces/miembros primero.`
            : err.code === "upgrade_requires_payment"
              ? "Este upgrade requiere pago. Ábrelo desde el botón de pago."
              : err.detalle ?? err.code ?? "No se pudo cambiar el plan."
          : String(err);
      setAviso({ tono: "error", texto: msg });
    } finally {
      setAccion(null);
    }
  }

  async function onCancelar(cancelar: boolean) {
    if (!esOwner || accion) return;
    setAccion("cancel");
    setAviso(null);
    try {
      await client.subscription.cancel(cancelar);
      setAviso({ tono: "ok", texto: cancelar ? "Cancelación programada para el fin del período pagado. Conservas el acceso hasta entonces." : "Cancelación revertida." });
      reload();
    } catch (err) {
      setAviso({ tono: "error", texto: err instanceof DevApiError ? err.detalle ?? err.code ?? "No se pudo cancelar." : String(err) });
    } finally {
      setAccion(null);
    }
  }

  return (
    <>
      <PageHeader title="Plan & Billing" description="Tu suscripción de cuenta. Los precios son en USD. Los mensajes de WhatsApp los factura Meta directamente a tu WABA (DuLabs no cobra sobre eso)." />

      {loading ? (
        <CardsSkeleton count={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data ? (
        <EmptyState title="Selecciona un workspace" />
      ) : (
        <div className="space-y-6">
          {/* Estado de la suscripción */}
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tono="info">{data.planName}</StatusBadge>
            <span className="text-sm text-mist">{data.pricing.monthlyUsd !== null ? `$${data.pricing.monthlyUsd}/mes` : "Personalizado"}</span>
            {data.estado === "past_due" ? <StatusBadge tono="danger">Pago pendiente</StatusBadge> : data.estado === "canceled" ? <StatusBadge tono="warning">Cancelada</StatusBadge> : <StatusBadge tono="success">Activa</StatusBadge>}
            {data.billing?.proximoCobro ? <span className="text-sm text-mist">Próximo cobro: {data.billing.proximoCobro}</span> : null}
          </div>

          {data.estado === "past_due" ? (
            <div className="rounded-lg border border-danger-text/30 bg-danger px-4 py-3 text-sm text-danger-text">
              Tu suscripción está en <strong>pago pendiente</strong>. La lectura y administración siguen disponibles, pero enviar mensajes, conectar números y comprar adicionales quedan bloqueados hasta resolver el pago.
            </div>
          ) : null}
          {data.billing?.scheduledDowngradeTo ? (
            <div className="rounded-lg border border-edge bg-card px-4 py-3 text-sm text-mist">
              Downgrade a <strong className="text-fg">{data.billing.scheduledDowngradeTo}</strong> programado para el fin del período{data.billing.periodoFin ? ` (${data.billing.periodoFin.slice(0, 10)})` : ""}. Tus recursos actuales se conservan hasta entonces.
            </div>
          ) : null}
          {data.billing?.cancelarAlFinPeriodo ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-text/30 bg-warning px-4 py-3 text-sm text-warning-text">
              <span>Cancelación programada al fin del período{data.billing.periodoFin ? ` (${data.billing.periodoFin.slice(0, 10)})` : ""}. Conservas el acceso hasta esa fecha; no se elimina nada.</span>
              {esOwner ? <button onClick={() => onCancelar(false)} disabled={accion !== null} className="rounded-md border border-warning-text/40 px-3 py-1 text-xs font-medium hover:bg-white/5 disabled:opacity-50">Revertir</button> : null}
            </div>
          ) : null}
          {aviso ? (
            <div className={`rounded-lg border px-4 py-3 text-sm ${aviso.tono === "ok" ? "border-success-text/30 bg-success text-success-text" : "border-danger-text/30 bg-danger text-danger-text"}`}>{aviso.texto}</div>
          ) : null}

          {/* Uso */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-edge bg-card p-5">
              <h2 className="text-sm font-semibold text-fg">Mensajes del período</h2>
              <div className="mt-4"><UsageProgress used={data.messages.used} included={data.messages.included} unidad="messages" /></div>
            </div>
            <div className="rounded-lg border border-edge bg-card p-5">
              <h2 className="text-sm font-semibold text-fg">Números de WhatsApp</h2>
              <div className="mt-4"><UsageProgress used={data.numbers.used} included={data.numbers.max} unidad="numbers" /></div>
              <p className="mt-2 text-xs text-mist">{data.numbers.included !== null ? `${data.numbers.included} incluidos` : "personalizado"}{data.numbers.additional > 0 ? ` + ${data.numbers.additional} adicionales` : ""}. {data.numbers.canBuyAdditional ? "Adicionales: $5/número." : "Los números adicionales requieren Agency."}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Workspaces" value={`${data.workspaces.used} / ${formatearLimite(data.workspaces.included)}`} />
            <StatCard label="Miembros del equipo" value={`${data.members.used} / ${formatearLimite(data.members.included)}`} />
          </div>

          {/* Toggle mensual/anual */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Planes</h2>
            <div className="inline-flex items-center gap-2 rounded-full border border-edge bg-card p-1 text-xs">
              <button onClick={() => setIntervalo("month")} className={`rounded-full px-3 py-1 ${intervalo === "month" ? "bg-dev-accent text-dev-accent-fg" : "text-mist hover:text-fg"}`}>Mensual</button>
              <button onClick={() => setIntervalo("year")} className={`rounded-full px-3 py-1 ${intervalo === "year" ? "bg-dev-accent text-dev-accent-fg" : "text-mist hover:text-fg"}`}>Anual <span className="ml-1 rounded bg-success px-1 text-[10px] text-success-text">2 meses gratis</span></button>
            </div>
          </div>

          {/* Cards de planes */}
          <div className="grid gap-3 md:grid-cols-3">
            {PLANES.map((p) => {
              const actual = p.codigo === data.plan;
              const esUpgrade = p.mensualUsd > mensualDe(data.plan);
              return (
                <div key={p.codigo} className={`flex flex-col rounded-xl border p-5 ${actual ? "border-dev-accent bg-dev-accent-soft" : "border-edge bg-card"}`}>
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold text-fg">{p.label}</span>
                    <span className="text-sm font-medium text-fg">{p.manual ? `desde ${precioLabel(p.mensualUsd, intervalo)}` : precioLabel(p.mensualUsd, intervalo)}</span>
                  </div>
                  {intervalo === "year" && !p.manual ? (
                    <p className="mt-1 text-[11px] text-success-text">≈ ${(Math.round((p.mensualUsd * 10 * 100) / 12) / 100).toFixed(2)}/mes · ahorras ${p.mensualUsd * 2}/año</p>
                  ) : null}
                  <p className="mt-2 flex-1 text-xs text-mist">{p.resumen}</p>
                  <div className="mt-4">
                    {actual ? (
                      <p className="text-xs font-medium text-dev-accent">Plan actual</p>
                    ) : p.manual ? (
                      SALES_EMAIL ? (
                        <a href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent("Consulta plan Enterprise — DuLabs Developer")}`} className="inline-block rounded-md border border-edge px-3 py-1.5 text-sm text-fg hover:bg-white/5">Contactar ventas</a>
                      ) : (
                        <p className="text-xs text-mist">Escríbenos para Enterprise</p>
                      )
                    ) : esOwner ? (
                      <button
                        onClick={() => onAccionPlan(p.codigo, p.label, p.mensualUsd)}
                        disabled={accion !== null}
                        className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover disabled:opacity-50"
                      >
                        {accion === p.codigo ? "Procesando…" : esUpgrade ? (billingOn ? `Pagar ${p.label}` : `Cambiar a ${p.label}`) : `Cambiar a ${p.label}`}
                      </button>
                    ) : (
                      <p className="text-xs text-mist">Solo el OWNER puede cambiar el plan</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Cancelación */}
          {esOwner && data.estado !== "canceled" && !data.billing?.cancelarAlFinPeriodo ? (
            <div className="flex items-center justify-between rounded-lg border border-edge bg-card px-4 py-3">
              <span className="text-sm text-mist">Cancela cuando quieras. Mantienes el acceso hasta el fin del período pagado.</span>
              <button onClick={() => onCancelar(true)} disabled={accion !== null} className="rounded-md border border-edge px-3 py-1.5 text-sm text-fg hover:bg-white/5 disabled:opacity-50">Cancelar suscripción</button>
            </div>
          ) : null}
        </div>
      )}

      {checkout ? (
        <BillingCheckout
          client={client}
          plan={checkout.plan}
          planLabel={checkout.label}
          intervalo={intervalo}
          precioLabel={checkout.precio}
          email={email}
          onClose={() => {
            setCheckout(null);
            reload();
          }}
          onSuccess={() => {
            setAviso({ tono: "ok", texto: "Pago aprobado. Tu plan se actualizó." });
            reload();
          }}
        />
      ) : null}
    </>
  );
}
