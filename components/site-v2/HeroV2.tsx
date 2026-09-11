"use client";

import { ProductVisualV2 } from "./ProductVisualV2";
import { trackConversion } from "@/lib/site-analytics";
import { MENSAJE_WHATSAPP_GENERICO_ES, whatsappVentasUrl } from "@/lib/site-contact";

// Franja de credibilidad. NO son métricas inventadas: son afirmaciones reales
// y verificables de DuLabs (placeholders neutros, regla 29). Se reemplazan por
// cifras cuando el propietario confirme datos auditados.
const PROOF = [
  { value: "24 h", label: "Puesta en marcha" },
  { value: "API oficial", label: "de WhatsApp · Meta" },
  { value: "Claude", label: "IA de Anthropic" },
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

      <div className="mx-auto max-w-[1280px] px-5 pb-20 pt-32 sm:px-8 md:pt-36 xl:pb-28 xl:pt-44">
        <div className="grid items-center gap-14 xl:grid-cols-[minmax(0,1fr)_minmax(0,auto)] xl:gap-8">
          {/* ---------- Izquierda: contenido ---------- */}
          <div className="min-w-0 text-center xl:text-left">
            {/* Eyebrow */}
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-sitev2-subtle-fg">
              IA · Automatización · Software
            </p>

            {/* Headline — peso alto (bold) y line-height apretado como el mockup */}
            <h1 className="mx-auto mt-8 max-w-[15ch] font-display text-[clamp(2.9rem,7.2vw,4.6rem)] font-bold leading-[0.94] tracking-[-0.04em] text-sitev2-fg xl:mx-0">
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
                className="group inline-flex h-11 items-center justify-center gap-2 rounded-full bg-sitev2-fg px-6 text-[14px] font-medium text-sitev2-bg transition-all hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_14px_34px_-12px_rgba(17,17,17,0.4)]"
              >
                Hablar con DuLabs
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
              </a>
              <a
                href="#soluciones"
                className="inline-flex h-11 items-center justify-center rounded-full border border-sitev2-border-strong bg-sitev2-bg px-6 text-[14px] font-medium text-sitev2-fg transition-all hover:border-sitev2-fg/30 hover:bg-sitev2-surface"
              >
                Conocer soluciones
              </a>
            </div>

            {/* Franja de credibilidad — empujada hacia abajo, ritmo de stat strip */}
            <div className="mx-auto mt-16 flex max-w-md flex-wrap justify-center gap-x-8 gap-y-6 sm:flex-nowrap sm:justify-between xl:mx-0 xl:mt-20 xl:justify-start xl:gap-x-12">
              {PROOF.map((p, i) => (
                <div key={p.value} className="flex items-start">
                  {i > 0 && <span className="mr-8 hidden h-9 w-px bg-sitev2-border sm:block xl:mr-12" />}
                  <div className="text-center xl:text-left">
                    <div className="whitespace-nowrap font-display text-[20px] font-bold leading-none tracking-[-0.02em] text-sitev2-fg">
                      {p.value}
                    </div>
                    <div className="mt-2 whitespace-nowrap text-[11.5px] leading-snug text-sitev2-muted-fg">
                      {p.label}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ---------- Derecha: producto ---------- */}
          {/* xl:translate-x sangra el producto un poco más hacia el borde
              derecho, como el mockup (solo encuadre, sin cambiar tamaño). */}
          <div id="producto" className="animate-site-fade-up flex justify-center xl:translate-x-10 xl:justify-end">
            <ProductVisualV2 />
          </div>
        </div>
      </div>

      {/* Elementos inferiores del mockup (solo xl, donde la composición a dos
          columnas coincide con la referencia): marca abajo-izq y cue de scroll
          abajo-der. Discretos, sin agregar nada más. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-7 z-10 hidden xl:block">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-8">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-sitev2-subtle-fg">
            dulabs.co — Tecnología con propósito
          </span>
          <span className="flex items-center gap-2.5 font-mono text-[10.5px] uppercase tracking-[0.22em] text-sitev2-subtle-fg">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-sitev2-border-strong">
              <span aria-hidden className="animate-bounce text-[12px] leading-none">↓</span>
            </span>
            Desliza para explorar
          </span>
        </div>
      </div>
    </section>
  );
}
