"use client";

import { Check, ShieldCheck, Zap, Clock } from "lucide-react";
import PlanButton from "@/components/PlanButton";
import { PLANES, ORDEN_PLANES_V2, type PlanId } from "@/lib/planes";
import { PRICING_COPY } from "@/components/site/pricing-copy";

// Formato COP real: 79990 -> "$79.990". Precios reales desde lib/planes.ts
// (fuente única de verdad) — nunca inventados. Usa ORDEN_PLANES_V2 (planes
// nuevos: essential/business/pro/enterprise) -- nunca ORDEN_PLANES, que es
// el de la web en producción (start/growth/scale/enterprise) y no debe
// tocarse desde /newversion.
function cop(n: number) {
  return "$" + n.toLocaleString("es-CO");
}

const POPULAR: PlanId = "business";

// PRICING_COPY.enterprise es compartido con /precios (producción) y ahí
// dice "Todo lo de Scale" -- correcto en ese contexto (Scale es el plan justo
// debajo). En /newversion Scale no existe (el plan justo debajo es Pro), así
// que se sobreescribe SOLO esta lista localmente, sin tocar el archivo
// compartido ni afectar la página real.
const ENTERPRISE_FEATURES_V2 = [
  { es: "Todo lo de Pro", en: "Everything in Pro" },
  { es: "Números, usuarios y agentes ilimitados", en: "Unlimited numbers, users and agents" },
  { es: "Respuestas de IA y campañas a medida", en: "Custom AI replies and campaigns" },
  { es: "Soporte dedicado", en: "Dedicated support" },
];

export function PricingV2() {
  return (
    <section id="precios" className="border-t border-sitev2-border bg-sitev2-bg">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-sitev2-subtle-fg">
            Precios
          </p>
          <h2 className="mt-4 font-display text-[clamp(2rem,4.5vw,3rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-sitev2-fg">
            Un plan para cada etapa
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-[16px] leading-relaxed text-sitev2-muted-fg">
            Mensualidad más una configuración inicial única. Nosotros dejamos tu asistente funcionando.
          </p>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-4">
          {ORDEN_PLANES_V2.map((id) => {
            const plan = PLANES[id];
            const copy = PRICING_COPY[id];
            const features = id === "enterprise" ? ENTERPRISE_FEATURES_V2 : copy.features;
            const popular = id === POPULAR;
            return (
              <div
                key={id}
                className={`relative flex flex-col rounded-2xl border p-6 ${
                  popular
                    ? "border-sitev2-primary/40 bg-sitev2-card v2-shadow-card"
                    : "border-sitev2-border bg-sitev2-surface"
                }`}
              >
                {popular && (
                  /* Fondo bg-[#d23c00] en vez de bg-sitev2-primary SOLO en este
                     badge: texto blanco sobre el naranja de marca (#ff5c1a) da
                     3.09:1, no alcanza AA (4.5:1) para texto pequeño. Este tono
                     es el mismo naranja, ~14% más oscuro en luminosidad (misma
                     tonalidad H=17.3°), y sube el contraste a 4.79:1. No es un
                     color nuevo del sistema -- exclusivo de este badge. */
                  <span className="absolute -top-3 left-6 rounded-full bg-[#d23c00] px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-white">
                    Más elegido
                  </span>
                )}

                <h3 className="font-display text-[18px] font-semibold text-sitev2-fg">{plan.nombre}</h3>
                <p className="mt-1.5 min-h-[40px] text-[12.5px] leading-snug text-sitev2-muted-fg">
                  {copy.tag.es}
                </p>

                <div className="mt-5">
                  {plan.precioCop === null ? (
                    <div className="font-display text-[28px] font-semibold tracking-tight text-sitev2-fg">
                      A medida
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <span className="font-display text-[32px] font-semibold tracking-tight text-sitev2-fg">
                        {cop(plan.precioCop)}
                      </span>
                      <span className="text-[13px] text-sitev2-muted-fg">/mes</span>
                    </div>
                  )}
                  <p className="mt-1 text-[11.5px] text-sitev2-muted-fg">
                    {plan.implementacionCop === null
                      ? "Configuración a medida"
                      : `+ ${cop(plan.implementacionCop)} configuración inicial`}
                  </p>
                </div>

                <PlanButton
                  planId={id}
                  label={copy.boton.es}
                  className={`mt-5 inline-flex h-11 w-full items-center justify-center rounded-full px-4 text-[13.5px] font-medium transition-all ${
                    popular
                      ? "bg-sitev2-fg text-sitev2-bg hover:bg-black"
                      : "border border-sitev2-border-strong bg-sitev2-bg text-sitev2-fg hover:border-sitev2-fg/30"
                  }`}
                />

                <ul className="mt-6 flex flex-col gap-2.5 border-t border-sitev2-border pt-6">
                  {features.map((f) => (
                    <li key={f.es} className="flex items-start gap-2 text-[12.5px] text-sitev2-fg">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sitev2-primary" strokeWidth={2.5} />
                      <span>{f.es}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 rounded-lg bg-sitev2-surface-2 px-3 py-2.5 text-[11px] leading-snug text-sitev2-muted-fg">
                  <span className="font-medium text-sitev2-fg">{copy.campanas.porMes.es}</span>
                  <br />
                  {copy.campanas.destinatarios.es}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-center text-[12px] text-sitev2-muted-fg">
          El costo de envío de campañas lo cobra Meta directamente según sus tarifas — no está incluido en el plan.
        </p>

        {/* Evidencia/confianza absorbida de MetricsSection (Home actual) --
            mismas 3 afirmaciones verificadas, sin cifra inventada, en línea
            compacta junto al pricing en vez de una sección propia de "4
            números" (fase 6.2, punto 4 del brief). "Sin herramientas no
            oficiales" se omite acá por ser redundante con "API Oficial de
            Meta" -- misma afirmación dicha dos veces en el original. */}
        <div className="mx-auto mt-10 flex max-w-2xl flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t border-sitev2-border pt-8 text-[12.5px] text-sitev2-muted-fg">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-sitev2-primary" strokeWidth={1.8} /> 100% API Oficial de Meta
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-sitev2-primary" strokeWidth={1.8} /> IA respondiendo 24/7
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-sitev2-primary" strokeWidth={1.8} /> Tiempo de respuesta &lt;2s
          </span>
        </div>
      </div>
    </section>
  );
}
