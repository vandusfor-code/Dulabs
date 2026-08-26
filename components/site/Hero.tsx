"use client";

import { ArrowRight, Infinity, Share2, ShieldCheck, BrainCircuit, Zap } from "lucide-react";
import { ProductMockup } from "./ProductMockup";
import { SplitText } from "./SplitText";
import { useI18n } from "@/lib/i18n";
import { MENSAJE_WHATSAPP_GENERICO_EN, MENSAJE_WHATSAPP_GENERICO_ES, whatsappVentasUrl } from "@/lib/site-contact";

export function Hero() {
  const { t, lang } = useI18n();

  const features = [
    { icon: Infinity, label: t("API Oficial\nde Meta", "Official Meta\nAPI") },
    { icon: ShieldCheck, label: t("0% riesgo\nde bloqueo", "0% ban\nrisk") },
    { icon: Share2, label: t("Modo\nCoexistencia", "Coexistence\nMode") },
    { icon: BrainCircuit, label: t("Entrenado con\nClaude (Anthropic)", "Trained with\nClaude (Anthropic)") },
  ];

  return (
    <section id="top" className="relative overflow-hidden pt-28 pb-16 md:pt-36 md:pb-24">
      <div className="pointer-events-none absolute inset-0 site-ambient-bg animate-site-ambient" />
      <div className="pointer-events-none absolute inset-0 site-grid-bg [mask-image:radial-gradient(ellipse_at_center_top,black_20%,transparent_75%)]" />

      <div className="relative mx-auto max-w-[1280px] px-6">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_auto] lg:gap-8">
          {/* ---------- Columna izquierda: contenido comercial ---------- */}
          {/* min-w-0: sin esto, el badge whitespace-nowrap fuerza el track del
              grid a su ancho de contenido y desborda en mobile. */}
          <div className="min-w-0 text-center lg:text-left">
            <div className="flex justify-center lg:justify-start">
              <a
                href="#como-funciona"
                className="group inline-flex max-w-full items-center gap-2 rounded-full border border-site-primary/25 bg-site-primary/10 px-3 py-1 font-mono text-[10.5px] text-site-fg transition-all hover:border-site-primary/40 sm:whitespace-nowrap"
              >
                <Zap className="h-3 w-3 shrink-0 text-site-primary" />
                <span className="uppercase tracking-widest">{t("Configurado y entregado en menos de 24 horas", "Set up and delivered in under 24 hours")}</span>
                <ArrowRight className="h-3 w-3 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </a>
            </div>

            <h1 className="mx-auto mt-8 max-w-xl font-display text-[38px] font-medium leading-[1.05] tracking-[-0.03em] text-site-fg md:text-[52px] lg:mx-0 lg:max-w-2xl lg:text-[50px] xl:text-[56px]">
              <SplitText text={t("Tu WhatsApp con IA,", "Your WhatsApp with AI,")} className="site-text-gradient" />
              <br />
              <SplitText
                text={t("configurado por nosotros.", "set up by us.")}
                className="site-text-gradient-primary"
                startDelay={320}
              />
            </h1>

            <p className="mx-auto mt-7 max-w-md text-[16px] leading-relaxed text-site-muted-fg md:text-[17px] lg:mx-0">
              {t(
                "Nos cuentas de tu negocio y nosotros conectamos, entrenamos y entregamos tu asistente de WhatsApp funcionando — sin que tengas que configurar nada. Sobre la API Oficial de Meta.",
                "You tell us about your business and we connect, train and deliver your working WhatsApp assistant — with nothing for you to configure. On Meta's official API."
              )}
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <a
                href={whatsappVentasUrl(lang === "en" ? MENSAJE_WHATSAPP_GENERICO_EN : MENSAJE_WHATSAPP_GENERICO_ES)}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex h-11 items-center rounded-full bg-site-fg px-5 text-[13.5px] font-medium text-site-bg transition-all hover:-translate-y-0.5 hover:bg-site-fg/90 hover:shadow-[0_10px_30px_-8px_rgba(255,255,255,0.25)]"
              >
                {t("Cuéntanos de tu negocio", "Tell us about your business")}
                <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <a
                href="#precios"
                className="group inline-flex h-11 items-center rounded-full border border-site-border bg-site-card px-5 text-[13.5px] font-medium text-site-fg transition-all hover:border-white/20"
              >
                <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-site-primary shadow-[0_0_8px_var(--color-site-primary)]" />
                {t("Ver planes ↓", "See plans ↓")}
              </a>
            </div>

            <div className="mt-11 flex flex-wrap items-start justify-center gap-x-1 gap-y-6 lg:flex-nowrap lg:justify-start">
              {features.map((f, i) => (
                <div key={f.label} className="flex items-start">
                  {i > 0 && <span className="mx-3 mt-1.5 hidden h-8 w-px shrink-0 bg-white/10 sm:block" />}
                  <div className="flex w-[92px] flex-col items-center gap-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.03]">
                      <f.icon className="h-4 w-4 text-site-primary" />
                    </div>
                    <span className="whitespace-pre-line text-center font-mono text-[10px] leading-tight text-site-muted-fg">
                      {f.label}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ---------- Columna derecha: mockup del producto ---------- */}
          <div id="plataforma" className="animate-site-fade-up">
            <ProductMockup />
          </div>
        </div>
      </div>
    </section>
  );
}
