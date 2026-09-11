"use client";

import { ProductVisualV2 } from "./ProductVisualV2";
import { trackConversion } from "@/lib/site-analytics";
import { MENSAJE_WHATSAPP_GENERICO_ES, whatsappVentasUrl } from "@/lib/site-contact";

// Franja de credibilidad. NO son métricas inventadas: son afirmaciones reales
// y verificables de DuLabs (placeholders neutros, regla 29). Se reemplazan por
// cifras cuando el propietario confirme datos auditados.
const PROOF = [
  { value: "24 h", label: "Puesta en marcha del asistente" },
  { value: "API oficial", label: "WhatsApp sobre la API de Meta" },
  { value: "Claude", label: "IA de Anthropic, entrenada por nosotros" },
];

export function HeroV2() {
  const ctaHref = whatsappVentasUrl(MENSAJE_WHATSAPP_GENERICO_ES);

  return (
    <section id="top" className="relative overflow-hidden">
      {/* Iluminación de estudio + rejilla técnica muy sutil */}
      <div aria-hidden className="v2-studio-light pointer-events-none absolute inset-0 -z-20" />
      <div
        aria-hidden
        className="v2-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,black_5%,transparent_70%)]"
      />

      <div className="mx-auto max-w-[1280px] px-5 pb-20 pt-28 sm:px-8 md:pt-32 xl:pb-28 xl:pt-40">
        <div className="grid items-center gap-14 xl:grid-cols-[minmax(0,1fr)_minmax(0,auto)] xl:gap-8">
          {/* ---------- Izquierda: contenido ---------- */}
          <div className="min-w-0 text-center xl:text-left">
            {/* Eyebrow */}
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-sitev2-subtle-fg">
              IA · Automatización · Software
            </p>

            {/* Headline */}
            <h1 className="mx-auto mt-6 max-w-[16ch] font-display text-[clamp(2.75rem,7vw,4.25rem)] font-semibold leading-[0.98] tracking-[-0.035em] text-sitev2-fg xl:mx-0">
              Tecnología <br className="hidden xl:block" />
              que trabaja por <br className="hidden xl:block" />
              tu empresa
              <span className="text-sitev2-primary">.</span>
            </h1>

            {/* Subcopy */}
            <p className="mx-auto mt-7 max-w-[42ch] text-[16px] leading-relaxed text-sitev2-muted-fg md:text-[17px] xl:mx-0">
              Creamos agentes de IA, automatizaciones y software para conectar tus procesos,
              atender a tus clientes y hacer que tu operación funcione mejor.
            </p>

            {/* CTAs */}
            <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center xl:justify-start">
              <a
                href={ctaHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackConversion("cta_whatsapp", { source: "hero_v2" })}
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-sitev2-fg px-6 text-[14.5px] font-medium text-sitev2-bg transition-all hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_14px_34px_-12px_rgba(17,17,17,0.4)]"
              >
                Hablar con DuLabs
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
              </a>
              <a
                href="#soluciones"
                className="inline-flex h-12 items-center justify-center rounded-full border border-sitev2-border-strong bg-sitev2-bg px-6 text-[14.5px] font-medium text-sitev2-fg transition-all hover:border-sitev2-fg/30 hover:bg-sitev2-surface"
              >
                Conocer soluciones
              </a>
            </div>

            {/* Franja de credibilidad */}
            <div className="mx-auto mt-14 flex max-w-md flex-wrap justify-center gap-x-8 gap-y-6 sm:flex-nowrap sm:justify-between xl:mx-0 xl:justify-start xl:gap-x-10">
              {PROOF.map((p, i) => (
                <div key={p.value} className="flex items-start">
                  {i > 0 && <span className="mr-8 hidden h-10 w-px bg-sitev2-border sm:block xl:mr-10" />}
                  <div className="text-center xl:text-left">
                    <div className="font-display text-[22px] font-semibold leading-none tracking-tight text-sitev2-fg">
                      {p.value}
                    </div>
                    <div className="mt-2 max-w-[16ch] text-[12px] leading-snug text-sitev2-muted-fg">
                      {p.label}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ---------- Derecha: producto ---------- */}
          <div id="producto" className="animate-site-fade-up flex justify-center xl:justify-end">
            <ProductVisualV2 />
          </div>
        </div>
      </div>
    </section>
  );
}
