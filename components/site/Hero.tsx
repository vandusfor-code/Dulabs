"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CommandCenter } from "./CommandCenter";
import { SplitText } from "./SplitText";
import { useI18n } from "@/lib/i18n";

export function Hero() {
  const { t } = useI18n();
  return (
    <section id="top" className="relative overflow-hidden pt-28 pb-16 md:pt-36 md:pb-24">
      <div className="pointer-events-none absolute inset-0 site-ambient-bg animate-site-ambient" />
      <div className="pointer-events-none absolute inset-0 site-grid-bg [mask-image:radial-gradient(ellipse_at_center_top,black_20%,transparent_75%)]" />

      <div className="relative mx-auto max-w-[1280px] px-6">
        <div className="flex justify-center">
          <a
            href="#plataforma"
            className="group inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-site-border bg-site-card px-3 py-1 font-mono text-[10.5px] text-site-muted-fg transition-all hover:border-site-primary/30 hover:text-site-fg"
          >
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-site-primary/10 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-widest text-site-primary ring-1 ring-site-primary/25">
              {t("API Oficial de Meta", "Official Meta API")}
            </span>
            <span className="hidden uppercase tracking-widest sm:inline">{t("Modo coexistencia disponible", "Coexistence mode available")}</span>
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>

        <h1 className="mx-auto mt-8 max-w-5xl text-center font-display text-[38px] font-medium leading-[1.05] tracking-[-0.03em] text-site-fg md:text-[58px] lg:text-[64px]">
          <SplitText text={t("Automatiza WhatsApp con IA:", "Automate WhatsApp with AI:")} className="site-text-gradient" />
          <br />
          <SplitText
            text={t("atención, campañas y encuestas.", "support, campaigns and surveys.")}
            className="site-text-gradient-primary"
            startDelay={320}
          />
        </h1>

        <p className="mx-auto mt-7 max-w-2xl text-center text-[16px] leading-relaxed text-site-muted-fg md:text-[17px]">
          {t(
            "Sobre la API Oficial de Meta. Un agente entrenado con tu negocio, sin arriesgar tu número. Desde $39.900 COP/mes.",
            "On Meta's official API. An agent trained on your business, without risking your number. From $39,900 COP/month."
          )}
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/business"
            className="group inline-flex h-11 items-center rounded-full bg-site-fg px-5 text-[13.5px] font-medium text-site-bg transition-all hover:bg-site-fg/90"
          >
            {t("Comenzar ahora", "Get started")}
            <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="#precios"
            className="group inline-flex h-11 items-center rounded-full border border-site-border bg-site-card px-5 text-[13.5px] font-medium text-site-fg transition-all hover:border-white/20"
          >
            <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-site-primary shadow-[0_0_8px_var(--color-site-primary)]" />
            {t("Ver planes ↓", "See plans ↓")}
          </a>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-2 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-site-muted-fg sm:flex sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-6">
          <span>{t("API Oficial de Meta", "Official Meta API")}</span>
          <span className="hidden text-white/15 sm:inline">/</span>
          <span>{t("0% riesgo de bloqueo", "0% ban risk")}</span>
          <span className="hidden text-white/15 sm:inline">/</span>
          <span>{t("Modo coexistencia", "Coexistence mode")}</span>
          <span className="hidden text-white/15 sm:inline">/</span>
          <span>{t("Entrenado con Claude (Anthropic)", "Trained with Claude (Anthropic)")}</span>
        </div>

        <div id="plataforma" className="relative mt-16 md:mt-20 animate-site-fade-up">
          <CommandCenter />
        </div>
      </div>
    </section>
  );
}
