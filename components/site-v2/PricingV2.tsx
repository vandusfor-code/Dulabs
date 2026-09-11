"use client";

import { Check } from "lucide-react";
import PlanButton from "@/components/PlanButton";
import { PLANES, ORDEN_PLANES, type PlanId } from "@/lib/planes";
import { PRICING_COPY } from "@/components/site/pricing-copy";

// Formato COP real: 39900 -> "$39.900". Precios reales desde lib/planes.ts
// (fuente única de verdad) — nunca inventados.
function cop(n: number) {
  return "$" + n.toLocaleString("es-CO");
}

const POPULAR: PlanId = "growth";

export function PricingV2() {
  return (
    <section id="precios" className="border-t border-sitev2-border bg-sitev2-surface">
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
          {ORDEN_PLANES.map((id) => {
            const plan = PLANES[id];
            const copy = PRICING_COPY[id];
            const popular = id === POPULAR;
            return (
              <div
                key={id}
                className={`relative flex flex-col rounded-2xl border bg-sitev2-card p-6 ${
                  popular
                    ? "border-sitev2-primary/40 v2-shadow-card"
                    : "border-sitev2-border"
                }`}
              >
                {popular && (
                  <span className="absolute -top-3 left-6 rounded-full bg-sitev2-primary px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-white">
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
                  <p className="mt-1 text-[11.5px] text-sitev2-subtle-fg">
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
                  {copy.features.map((f) => (
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

        <p className="mt-8 text-center text-[12px] text-sitev2-subtle-fg">
          El costo de envío de campañas lo cobra Meta directamente según sus tarifas — no está incluido en el plan.
        </p>
      </div>
    </section>
  );
}
