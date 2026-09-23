"use client";

import { useI18n } from "@/lib/i18n";

// DuLabs Developer -- controles de producción que aplica la plataforma. Se confirman en secuencia una sola vez al entrar el bloque que los
// contiene ([data-visto]: opacity + translateX + ✓, ≤ 420 ms cada uno). Viven dentro de «Control y seguridad» (DashboardPreview).
// La coexistencia se explica en «Qué puedes construir» (capacidad 01).

export function ProductionControls() {
  const { t } = useI18n();
  const controles = [
    { k: "API key", v: t("dl_live_… por workspace · rotación y revocación", "dl_live_… per workspace · rotate and revoke") },
    { k: "HMAC-SHA256", v: t("firma de cada webhook sobre timestamp.body", "every webhook signed over timestamp.body") },
    { k: "Idempotency-Key", v: t("un reintento nunca duplica el envío", "a retry never duplicates a send") },
    { k: "Rate limits", v: t("2 msg/s por número · 1.200 msg/min y 300 lecturas/min por workspace", "2 msg/s per number · 1,200 msg/min and 300 reads/min per workspace") },
    { k: t("Aislamiento", "Isolation"), v: t("keys, números y eventos confinados a su workspace", "keys, numbers and events scoped to their workspace") },
    { k: "SSRF", v: t("URLs de webhook validadas antes de cada entrega", "webhook URLs validated before every delivery") },
    { k: t("Auditoría", "Audit"), v: t("registro de acciones de cuenta y facturación", "log of account and billing actions") },
  ];
  return (
    <dl className="grid border-t border-dp-border lg:grid-cols-2 lg:gap-x-12">
      {controles.map((c, i) => (
        <div
          key={c.k}
          className="dp-control grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 border-b border-dp-border py-3 sm:grid-cols-[164px_1fr_auto] sm:items-center"
          style={{ ["--dp-i" as string]: i }}
        >
          <dt className="font-mono text-[12px] uppercase tracking-[0.08em] text-dp-text">{c.k}</dt>
          <dd className="col-start-1 row-start-2 text-[13px] leading-relaxed text-dp-text-2 sm:col-start-2 sm:row-start-1">{c.v}</dd>
          <dd className="dp-check col-start-2 row-start-1 font-mono text-[11px] text-dp-ok sm:col-start-3">
            ✓ <span className="sr-only sm:not-sr-only sm:text-dp-muted">{t("aplicado", "enforced")}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
