"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { START_HREF, DOCS_HREF } from "./constants";
import { InfraFlowField } from "./InfraFlowField";

// DuLabs Developer -- hero. Una pieza completa, no "texto + screenshot": el mensaje a la izquierda y, detrás y alrededor del lado derecho,
// el campo de flujo de infraestructura (InfraFlowField: canvas 2D). El contrato completo de la API vive en las secciones siguientes; aquí
// solo queda una línea técnica secundaria con datos reales (POST /api/v1/messages, firma HMAC-SHA256, Idempotency-Key).
//
// Desktop (lg+): primera pantalla completa (min-height 100vh -> 100svh), el campo ocupa ~64 % derecho con fundido hacia el texto.
// Mobile: H1 -> descripción -> CTAs -> línea técnica -> campo. El campo es una banda compacta DEBAJO del contenido (otra topología, menos
// densidad), no el desktop reducido. En desktop la zona de procesamiento queda a la derecha del final real del H1 (libreDe).

export function DevHero() {
  const { t } = useI18n();
  return (
    <section className="dev-hero relative isolate overflow-hidden">
      <InfraFlowField className="dev-hero-campo" libreDe="h1" />

      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-6 pb-[clamp(14rem,60vw,19rem)] pt-28 md:pt-36 lg:py-28">
        <p className="dev-hero-in flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.24em] text-site-muted-fg sm:text-[11px]">
          <span aria-hidden className="h-px w-7 bg-white/30" />
          {t("Infraestructura para developers", "Infrastructure for developers")}
        </p>

        <h1 className="dev-hero-h1 mt-7 font-medium text-site-fg lg:mt-8">
          <span className="block lg:whitespace-nowrap">{t("Construye sobre WhatsApp.", "Build on WhatsApp.")}</span>
          <span className="block text-site-muted-fg lg:whitespace-nowrap">{t("Sin construir la infraestructura.", "Without building the infrastructure.")}</span>
        </h1>

        <p className="dev-hero-in mt-7 max-w-[34rem] text-[16.5px] leading-[1.6] text-[#a1a1a1] md:text-[18px] lg:mt-9" style={{ animationDelay: "90ms" }}>
          {t(
            "Una sola API sobre WhatsApp Cloud API oficial de Meta para enviar mensajes, recibir eventos y operar cada entrega.",
            "One API on top of Meta's official WhatsApp Cloud API to send messages, receive events and operate every delivery.",
          )}
        </p>

        <div className="dev-hero-in mt-9 flex flex-col gap-3 sm:flex-row sm:items-center lg:mt-11" style={{ animationDelay: "160ms" }}>
          <Link
            href={START_HREF}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-dev-accent px-6 text-[14.5px] font-medium text-dev-accent-fg transition-colors hover:bg-dev-accent-hover"
          >
            Get API Key
            <span aria-hidden>→</span>
          </Link>
          <Link
            href={DOCS_HREF}
            className="group inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-white/[0.14] px-6 text-[14.5px] font-medium text-site-fg transition-colors hover:border-white/30 hover:bg-white/[0.03]"
          >
            {t("Ver documentación", "View docs")}
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
        </div>

        <ul
          aria-label={t("Detalles técnicos", "Technical details")}
          className="dev-hero-in mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] text-site-muted-fg lg:mt-16"
          style={{ animationDelay: "240ms" }}
        >
          <li className="flex items-center gap-2 text-site-fg">
            <span aria-hidden className="dev-hero-senal" />
            API v1
          </li>
          <li aria-hidden className="h-3 w-px bg-white/15" />
          <li>
            <span className="text-site-fg">POST</span> /api/v1/messages
          </li>
          <li aria-hidden className="hidden h-3 w-px bg-white/15 sm:block" />
          <li className="hidden sm:block">HMAC-SHA256 · Idempotency-Key</li>
        </ul>
      </div>
    </section>
  );
}
