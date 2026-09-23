"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { START_HREF, DOCS_HREF, SECTION_IDS } from "./constants";
import { InfrastructureFlow } from "./InfrastructureFlow";
import { BotonSecundario } from "./ui";

// DuLabs Developer -- hero. Qué es, la promesa en dos líneas, una frase de apoyo y dos CTAs. Debajo, la pieza protagonista: la ruta de un
// mensaje por la infraestructura (InfrastructureFlow), viva. El diagrama ES la sección «Plataforma» (el nav ancla aquí): no hay un
// bloque aparte que repita el recorrido.
//
// Desktop (lg+): texto arriba y, a un ritmo fijo, la banda de infraestructura (altura natural: sin huecos muertos en pantallas altas). Mobile: texto -> CTAs -> la ruta en
// vertical.

export function DevHero() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="dp-hero-titulo" className="dp-hero relative flex flex-col">
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col px-6 pb-16 pt-28 md:pt-36 lg:pb-14 lg:pt-32">
        <div>
          <p className="dp-entra flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] uppercase tracking-[0.22em] text-dp-muted">
            <span className="text-dp-text">DuLabs Developer</span>
            <span aria-hidden className="h-px w-5 bg-dp-border-strong" />
            <span>{t("Infraestructura para WhatsApp", "Infrastructure for WhatsApp")}</span>
          </p>

          <h1 id="dp-hero-titulo" className="dp-hero-h1 mt-7 font-medium text-dp-text lg:mt-8">
            <span className="block xl:whitespace-nowrap">{t("Construye sobre WhatsApp.", "Build on WhatsApp.")}</span>
            <span className="block text-dp-muted xl:whitespace-nowrap">{t("La infraestructura ya está resuelta.", "The infrastructure is handled.")}</span>
          </h1>

          <div className="mt-7 lg:mt-9">
            <p className="dp-entra max-w-[44ch] text-[16.5px] leading-[1.6] text-dp-text-2 md:text-[18px]" style={{ animationDelay: "90ms" }}>
              {t(
                "Infraestructura sobre WhatsApp Cloud API oficial de Meta para construir tu propio producto: agentes de IA, recordatorios, automatizaciones, envíos y CRMs. La cola, los reintentos y las firmas, de nuestro lado.",
                "Infrastructure on Meta's official WhatsApp Cloud API to build your own product: AI agents, reminders, automations, sends and CRMs. Queues, retries and signatures on our side.",
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
              <BotonSecundario href={DOCS_HREF}>{t("Leer la documentación", "Read the docs")}</BotonSecundario>
            </div>
          </div>
        </div>

        <div id={SECTION_IDS.plataforma} className="mt-16 scroll-mt-24 lg:mt-24">
          <InfrastructureFlow />
        </div>
      </div>
    </section>
  );
}
