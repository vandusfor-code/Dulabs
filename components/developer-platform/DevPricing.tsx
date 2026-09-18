"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { PlanPublico } from "@/lib/developers/planes-publicos";
import { START_HREF, SECTION_IDS, mailtoVentas } from "./constants";

// DuLabs Developer V1 -- Fase 15. Sección de pricing PÚBLICA. Los precios y
// límites vienen SIEMPRE de /api/developers/plans (que lee dulabs_dev_plans);
// este componente NO fija cifras. Toggle mensual/anual (anual = 2 meses gratis,
// derivado en el backend). Developer/Agency -> Comenzar; Enterprise -> ventas.

type Intervalo = "month" | "year";

function fmtUsd(n: number): string {
  // Sin decimales si es entero; si no, 2 decimales (p. ej. 15.83).
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function caracteristicas(p: PlanPublico, t: (es: string, en: string) => string): string[] {
  // Gramática correcta por idioma: ES pone "ilimitado(s)" tras el sustantivo;
  // EN lo pone antes ("Unlimited ...").
  const linea = (n: number | null, es: string, en: string, esIlim: string, enIlim: string) =>
    n === null ? t(esIlim, enIlim) : `${n.toLocaleString("en-US")} ${t(es, en)}`;
  const out: string[] = [
    linea(p.mensajesMensualesIncluidos, "mensajes/mes", "messages/mo", "Mensajes ilimitados", "Unlimited messages"),
    linea(p.numerosIncluidos, "números de WhatsApp", "WhatsApp numbers", "Números ilimitados", "Unlimited numbers"),
    linea(p.maxWorkspaces, "workspaces", "workspaces", "Workspaces ilimitados", "Unlimited workspaces"),
    linea(p.maxMembers, "miembros", "members", "Miembros ilimitados", "Unlimited members"),
  ];
  if (p.mensajesPorSegundoPorNumero !== null) {
    out.push(`${p.mensajesPorSegundoPorNumero} ${t("msg/seg por número", "msg/s per number")}`);
  }
  if (p.permiteNumerosAdicionales && p.precioNumeroAdicionalUsd !== null) {
    out.push(`${t("Números adicionales", "Additional numbers")} · ${fmtUsd(p.precioNumeroAdicionalUsd)}${t("/mes", "/mo")}`);
  }
  return out;
}

function PlanCard({ plan, intervalo, destacado }: { plan: PlanPublico; intervalo: Intervalo; destacado: boolean }) {
  const { t } = useI18n();
  const esManual = plan.esManual;
  const precioMostrado = intervalo === "year" ? plan.equivalenteMensualAnualUsd : plan.precioMensualUsd;

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 ${
        destacado ? "border-white/25 bg-site-card ring-1 ring-white/10" : "border-site-border bg-site-card"
      }`}
    >
      {destacado ? (
        <span className="absolute -top-3 left-6 rounded-full bg-dev-accent px-3 py-0.5 font-mono text-[10px] uppercase tracking-widest text-dev-accent-fg">
          {t("Más popular", "Most popular")}
        </span>
      ) : null}
      <h3 className="font-display text-[18px] font-medium text-site-fg">{plan.nombre}</h3>

      <div className="mt-4 flex items-baseline gap-1.5">
        {precioMostrado === null ? (
          <span className="font-display text-[32px] font-medium text-site-fg">{t("A cotizar", "Custom")}</span>
        ) : (
          <>
            <span className="font-display text-[40px] font-medium leading-none tracking-tight text-site-fg">{fmtUsd(precioMostrado)}</span>
            <span className="text-[13px] text-site-muted-fg">{t("USD/mes", "USD/mo")}</span>
          </>
        )}
      </div>
      {intervalo === "year" && plan.precioAnualUsd !== null ? (
        <p className="mt-1 text-[12px] text-site-muted-fg">
          {t("Facturado anual", "Billed annually")} {fmtUsd(plan.precioAnualUsd)} · {t("2 meses gratis", "2 months free")}
        </p>
      ) : esManual ? (
        <p className="mt-1 text-[12px] text-site-muted-fg">{t("Contratación por ventas", "Sales-assisted")}</p>
      ) : (
        <p className="mt-1 text-[12px] text-site-muted-fg">{t("Precio de lista, facturación mensual", "List price, billed monthly")}</p>
      )}

      <ul className="mt-6 flex-1 space-y-2.5">
        {caracteristicas(plan, t).map((c) => (
          <li key={c} className="flex items-start gap-2.5 text-[13.5px] text-site-muted-fg">
            <Check className="mt-0.5 h-4 w-4 flex-none text-dev-accent" strokeWidth={2.25} aria-hidden />
            <span>{c}</span>
          </li>
        ))}
      </ul>

      {esManual ? (
        <a
          href={mailtoVentas(`DuLabs Developer — ${plan.nombre}`)}
          className="mt-7 inline-flex items-center justify-center rounded-lg border border-site-border bg-site-bg px-4 py-2.5 text-[14px] font-medium text-site-fg transition-colors hover:border-dev-accent/40"
        >
          {t("Contactar ventas", "Contact sales")}
        </a>
      ) : (
        <Link
          href={START_HREF}
          className={`mt-7 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-[14px] font-medium transition-colors ${
            destacado
              ? "bg-dev-accent text-dev-accent-fg hover:bg-dev-accent-hover"
              : "border border-site-border bg-site-bg text-site-fg hover:border-dev-accent/40"
          }`}
        >
          {t("Comenzar", "Get started")}
        </Link>
      )}
    </div>
  );
}

export function DevPricing() {
  const { t } = useI18n();
  const [planes, setPlanes] = useState<PlanPublico[] | null>(null);
  const [error, setError] = useState(false);
  const [intervalo, setIntervalo] = useState<Intervalo>("month");

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

  return (
    <section id={SECTION_IDS.pricing} className="scroll-mt-20 border-t border-site-border py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.28em] text-dev-accent">Pricing</p>
            <h2 className="mt-4 font-display text-[28px] font-medium leading-[1.1] tracking-[-0.02em] text-site-fg md:text-[36px]">
              {t("Precios simples, en USD.", "Simple pricing, in USD.")}
            </h2>
            <p className="mt-4 text-[15.5px] leading-relaxed text-site-muted-fg">
              {t("Elige un plan y cámbialo cuando quieras desde el dashboard.", "Pick a plan and change it anytime from the dashboard.")}
            </p>
          </div>

          {/* Toggle mensual / anual */}
          <div className="inline-flex items-center rounded-full border border-site-border bg-site-card p-1 text-[13px]">
            <button
              type="button"
              onClick={() => setIntervalo("month")}
              aria-pressed={intervalo === "month"}
              className={`rounded-full px-4 py-1.5 font-medium transition-colors ${intervalo === "month" ? "bg-dev-accent text-dev-accent-fg" : "text-site-muted-fg hover:text-site-fg"}`}
            >
              {t("Mensual", "Monthly")}
            </button>
            <button
              type="button"
              onClick={() => setIntervalo("year")}
              aria-pressed={intervalo === "year"}
              className={`rounded-full px-4 py-1.5 font-medium transition-colors ${intervalo === "year" ? "bg-dev-accent text-dev-accent-fg" : "text-site-muted-fg hover:text-site-fg"}`}
            >
              {t("Anual", "Annual")} <span className="opacity-80">· {t("2 meses gratis", "2 months free")}</span>
            </button>
          </div>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {planes === null && !error ? (
            [0, 1, 2].map((i) => <div key={i} className="h-[420px] animate-pulse rounded-2xl border border-site-border bg-site-card" />)
          ) : error ? (
            <div className="col-span-full rounded-2xl border border-site-border bg-site-card p-8 text-center">
              <p className="text-[14px] text-site-muted-fg">
                {t("No pudimos cargar los planes ahora. Escríbenos y te ayudamos.", "We couldn't load plans right now. Reach out and we'll help.")}
              </p>
              <a href={mailtoVentas("DuLabs Developer — Pricing")} className="mt-3 inline-block text-[14px] font-medium text-dev-accent hover:underline">
                {t("Contactar ventas", "Contact sales")}
              </a>
            </div>
          ) : (
            planes!.map((p, i) => <PlanCard key={p.slug} plan={p} intervalo={intervalo} destacado={i === 1} />)
          )}
        </div>
      </div>
    </section>
  );
}
