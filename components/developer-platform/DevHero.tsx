"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { START_HREF, DOCS_HREF, API_HOST } from "./constants";
import { InfraFlowField } from "./InfraFlowField";

// DuLabs Developer -- hero. Qué es (eyebrow: producto + sobre qué corre), la promesa en dos líneas, una frase de apoyo, dos CTAs y un
// indicador técnico real (el endpoint y su respuesta). Detrás, el campo de flujo de infraestructura (InfraFlowField): app -> API -> cola
// -> workers -> WhatsApp -> cliente, que se inicializa de izquierda a derecha. Nada más: el resto del producto vive en los bloques
// siguientes.
//
// Desktop (lg+): primera pantalla completa; el campo ocupa el lado derecho y deja limpio el espacio detrás del H1 (libreDe).
// Mobile: texto -> CTAs -> indicador -> el campo como banda propia debajo (otra topología, menos densa), no el desktop reducido.

export function DevHero() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="dp-hero-titulo" className="dp-hero relative isolate flex items-center overflow-hidden">
      <InfraFlowField className="dev-hero-campo" libreDe="h1" />

      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-6 pb-[clamp(15rem,62vw,19rem)] pt-28 md:pt-36 lg:py-32">
        <p className="dp-entra flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] uppercase tracking-[0.22em] text-dp-muted">
          <span className="text-dp-text">DuLabs Developer</span>
          <span aria-hidden className="h-px w-5 bg-dp-border-strong" />
          <span>{t("Infraestructura para WhatsApp", "Infrastructure for WhatsApp")}</span>
        </p>

        <h1 id="dp-hero-titulo" className="dp-hero-h1 mt-7 font-medium text-dp-text lg:mt-9">
          <span className="block lg:whitespace-nowrap">{t("Construye sobre WhatsApp.", "Build on WhatsApp.")}</span>
          <span className="block text-dp-muted lg:whitespace-nowrap">{t("La infraestructura ya está resuelta.", "The infrastructure is handled.")}</span>
        </h1>

        <p className="dp-entra mt-6 max-w-[40ch] text-[16.5px] leading-[1.6] text-dp-text-2 md:text-[18px] lg:mt-8" style={{ animationDelay: "90ms" }}>
          {t(
            "Una API sobre WhatsApp Cloud API oficial de Meta: envía mensajes, recibe eventos firmados y observa cada entrega.",
            "One API on Meta's official WhatsApp Cloud API: send messages, receive signed events and observe every delivery.",
          )}
        </p>

        <div className="dp-entra mt-8 flex flex-col gap-3 sm:flex-row sm:items-center lg:mt-10" style={{ animationDelay: "160ms" }}>
          <Link
            href={START_HREF}
            className="dp-btn inline-flex h-11 items-center justify-center gap-2 rounded-dp bg-dev-accent px-5 text-[14px] font-medium text-dev-accent-fg hover:bg-dev-accent-hover"
          >
            Get API Key
            <span aria-hidden className="dp-flecha">→</span>
          </Link>
          <Link
            href={DOCS_HREF}
            className="dp-btn inline-flex h-11 items-center justify-center gap-2 rounded-dp border border-dp-border-strong px-5 text-[14px] font-medium text-dp-text hover:border-white/35 hover:bg-white/[0.03]"
          >
            {t("Leer la documentación", "Read the docs")}
            <span aria-hidden className="dp-flecha text-dp-muted">→</span>
          </Link>
        </div>

        {/* Indicador técnico: el contrato real en una línea (endpoint, respuesta, host). */}
        <div className="dp-entra mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11.5px] text-dp-muted lg:mt-14" style={{ animationDelay: "240ms" }}>
          <span className="inline-flex items-center gap-2 text-dp-text">
            <span aria-hidden className="dp-senal" />
            POST <span className="text-dp-text-2">/api/v1/messages</span>
          </span>
          <span aria-hidden>→</span>
          <span>
            <span className="text-dp-text">201</span> {`{ "status": "created" }`}
          </span>
          <span aria-hidden className="hidden h-3 w-px bg-dp-border-strong sm:block" />
          <span className="hidden sm:inline">{API_HOST}</span>
        </div>
      </div>
    </section>
  );
}
