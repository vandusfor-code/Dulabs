"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import type { PlanPublico } from "@/lib/developers/planes-publicos";
import { START_HREF, SECTION_IDS, mailtoVentas } from "./constants";
import { useBloque } from "./motion";
import { Encabezado } from "./ui";

// DuLabs Developer -- pricing. Precios y límites vienen SIEMPRE de /api/developers/plans (lee dulabs_dev_plans): este componente no fija
// ninguna cifra. Anual = 2 meses gratis, derivado en el backend. Developer/Agency -> registro; Enterprise -> ventas. Tarjetas compactas
// con las mismas filas en el mismo orden (se comparan de un vistazo). Sin plan «destacado»: el catálogo no tiene ese dato, no se inventa.

type Intervalo = "month" | "year";

function fmtUsd(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function filas(t: (es: string, en: string) => string) {
  const num = (n: number | null, ilim: string) => (n === null ? ilim : n.toLocaleString("en-US"));
  return [
    { k: t("Mensajes / mes", "Messages / mo"), v: (p: PlanPublico) => num(p.mensajesMensualesIncluidos, t("Ilimitados", "Unlimited")) },
    { k: t("Números de WhatsApp", "WhatsApp numbers"), v: (p: PlanPublico) => num(p.numerosIncluidos, t("Ilimitados", "Unlimited")) },
    { k: t("Mensajes/seg por número", "Msg/s per number"), v: (p: PlanPublico) => (p.mensajesPorSegundoPorNumero === null ? t("A medida", "Custom") : String(p.mensajesPorSegundoPorNumero)) },
    { k: "Workspaces", v: (p: PlanPublico) => num(p.maxWorkspaces, t("Ilimitados", "Unlimited")) },
    { k: t("Miembros", "Members"), v: (p: PlanPublico) => num(p.maxMembers, t("Ilimitados", "Unlimited")) },
    {
      k: t("Números adicionales", "Additional numbers"),
      v: (p: PlanPublico) => (p.permiteNumerosAdicionales && p.precioNumeroAdicionalUsd !== null ? `${fmtUsd(p.precioNumeroAdicionalUsd)}${t("/mes", "/mo")}` : "—"),
    },
  ];
}

function Precio({ plan, intervalo }: { plan: PlanPublico; intervalo: Intervalo }) {
  const { t } = useI18n();
  const precio = intervalo === "year" ? plan.equivalenteMensualAnualUsd : plan.precioMensualUsd;
  return (
    <div>
      <p className="flex items-baseline gap-1.5">
        {precio === null ? (
          <span className="text-[26px] font-medium tracking-[-0.02em] text-dp-text">{t("A cotizar", "Custom")}</span>
        ) : (
          <>
            <span className="font-mono text-[30px] font-medium tracking-[-0.03em] tabular-nums text-dp-text">{fmtUsd(precio)}</span>
            <span className="text-[12.5px] text-dp-muted">{t("USD/mes", "USD/mo")}</span>
          </>
        )}
      </p>
      <p className="mt-1 text-[12px] text-dp-muted">
        {plan.esManual
          ? t("Contratación con ventas", "Sales-assisted")
          : intervalo === "year" && plan.precioAnualUsd !== null
            ? `${t("Facturado anual", "Billed annually")} ${fmtUsd(plan.precioAnualUsd)}`
            : t("Facturación mensual", "Billed monthly")}
      </p>
    </div>
  );
}

function Cta({ plan }: { plan: PlanPublico }) {
  const { t } = useI18n();
  const base = "dp-btn inline-flex h-10 w-full items-center justify-center gap-2 rounded-dp px-4 text-[13.5px] font-medium";
  if (plan.esManual) {
    return (
      <a href={mailtoVentas(`DuLabs Developer — ${plan.nombre}`)} className={`${base} border border-dp-border-strong text-dp-text hover:border-white/35 hover:bg-white/[0.03]`}>
        {t("Contactar ventas", "Contact sales")}
      </a>
    );
  }
  return (
    <Link href={START_HREF} className={`${base} bg-dev-accent text-dev-accent-fg hover:bg-dev-accent-hover`}>
      {t("Comenzar", "Get started")}
      <span aria-hidden className="dp-flecha">→</span>
    </Link>
  );
}

export function DevPricing() {
  const { t } = useI18n();
  const [planes, setPlanes] = useState<PlanPublico[] | null>(null);
  const [error, setError] = useState(false);
  const [intervalo, setIntervalo] = useState<Intervalo>("month");
  const { ref, atributos } = useBloque<HTMLElement>({ umbral: 0.15 });

  useEffect(() => {
    let vivo = true;
    fetch("/api/developers/plans")
      .then((r) => r.json())
      .then((data) => {
        if (!vivo) return;
        const lista = Array.isArray(data?.plans) ? (data.plans as PlanPublico[]) : [];
        setPlanes(lista);
        if (lista.length === 0) setError(true);
      })
      .catch(() => {
        if (vivo) setError(true);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const comparacion = filas(t);

  const toggle = (
    <div role="group" aria-label={t("Periodo de facturación", "Billing period")} className="inline-flex items-center rounded-dp border border-dp-border p-0.5 font-mono text-[12px]">
      {(["month", "year"] as const).map((iv) => (
        <button
          key={iv}
          type="button"
          onClick={() => setIntervalo(iv)}
          aria-pressed={intervalo === iv}
          className={`dp-link rounded-[6px] px-3 py-1.5 ${intervalo === iv ? "bg-white/[0.08] text-dp-text" : "text-dp-muted hover:text-dp-text-2"}`}
        >
          {iv === "month" ? t("Mensual", "Monthly") : t("Anual · 2 meses gratis", "Annual · 2 months free")}
        </button>
      ))}
    </div>
  );

  return (
    <section ref={ref} {...atributos} id={SECTION_IDS.pricing} className="scroll-mt-14 border-t border-dp-border py-14 md:py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <Encabezado
          indice="07"
          etiqueta="Pricing"
          titulo={t("Precios en USD.", "Pricing in USD.")}
          apoyo={t("Elige un plan y cámbialo cuando quieras desde el dashboard.", "Pick a plan and change it anytime from the dashboard.")}
          accion={toggle}
        />

        <div className="mt-12 md:mt-14">
          {planes === null && !error ? (
            <div aria-busy="true" className="grid gap-4 md:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[380px] animate-pulse rounded-dp-lg border border-dp-border bg-dp-surface" />
              ))}
            </div>
          ) : error ? (
            <div className="border-y border-dp-border py-10 text-center">
              <p className="text-[14px] text-dp-text-2">{t("No pudimos cargar los planes ahora. Escríbenos y te ayudamos.", "We couldn't load plans right now. Reach out and we'll help.")}</p>
              <a href={mailtoVentas("DuLabs Developer — Pricing")} className="dp-link mt-3 inline-block text-[14px] font-medium text-dp-text underline-offset-4 hover:underline">
                {t("Contactar ventas", "Contact sales")}
              </a>
            </div>
          ) : (
            <ul className="dp-revela grid gap-4 md:grid-cols-3">
              {planes!.map((p) => (
                <li key={p.slug} className="dp-panel flex flex-col rounded-dp-lg border border-dp-border bg-dp-surface p-5 md:p-6">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-[15px] font-medium text-dp-text">{p.nombre}</h3>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-dp-muted">{p.esManual ? t("con ventas", "sales") : "self-service"}</span>
                  </div>
                  <div className="mt-4">
                    <Precio plan={p} intervalo={intervalo} />
                  </div>
                  <dl className="mt-5 grid flex-1 grid-cols-2 content-start gap-x-4 gap-y-2.5 border-t border-dp-border pt-4 md:grid-cols-1 md:gap-y-0 md:pt-3">
                    {comparacion.map((f) => (
                      <div key={f.k} className="min-w-0 md:flex md:items-baseline md:justify-between md:gap-4 md:py-1.5">
                        <dt className="truncate text-[11.5px] text-dp-muted md:text-[12.5px]">{f.k}</dt>
                        <dd className="font-mono text-[12.5px] tabular-nums text-dp-text md:text-right">{f.v(p)}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-5">
                    <Cta plan={p} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-[12.5px] leading-relaxed text-dp-muted">
            {t(
              "Meta factura los mensajes de WhatsApp directamente al dueño de la cuenta (WABA); DuLabs no cobra sobre eso. El pago del plan se hace dentro del dashboard.",
              "Meta bills WhatsApp messages directly to the account owner (WABA); DuLabs doesn't charge on top. Plan payment happens inside the dashboard.",
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
