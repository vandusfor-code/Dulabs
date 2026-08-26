"use client";

import {
  ArrowRight,
  Bot,
  ChartNoAxesCombined,
  Check,
  ClipboardList,
  FileUp,
  Globe,
  Megaphone,
  MessageCircle,
  Phone,
  Plus,
  Rocket,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import PlanButton from "@/components/PlanButton";
import { Reveal } from "./Reveal";
import { useI18n } from "@/lib/i18n";
import { PLANES, type PlanId } from "@/lib/planes";
import { PRICING_COPY } from "./pricing-copy";
import { trackConversion } from "@/lib/site-analytics";
import { MENSAJE_WHATSAPP_GENERICO_EN, MENSAJE_WHATSAPP_GENERICO_ES, whatsappVentasUrl } from "@/lib/site-contact";

/* =========================================================
   Shared primitives
========================================================= */

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-site-border bg-site-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-site-muted-fg">
      <span className="h-1 w-1 rounded-full bg-site-primary shadow-[0_0_6px_var(--color-site-primary)]" />
      {children}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  desc,
  align = "left",
  labelStyle = "pill",
  size = "lg",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  desc?: string;
  align?: "left" | "center";
  /** "pill" = bordered chip (default, use sparingly); "kicker" = plain colored
   * small-caps text, no chip; "none" = no eyebrow line at all. */
  labelStyle?: "pill" | "kicker" | "none";
  /** "lg" = default 32/46px scale, reserved for the page's flagship moments;
   * "md" = a step down (26/38px) for supporting sections. */
  size?: "lg" | "md";
}) {
  const centered = align === "center";
  const titleSize =
    size === "md"
      ? "text-[26px] md:text-[38px]"
      : "text-[32px] md:text-[46px]";
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      {labelStyle === "pill" && eyebrow && <SectionLabel>{eyebrow}</SectionLabel>}
      {labelStyle === "kicker" && eyebrow && (
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.28em] text-site-primary">{eyebrow}</p>
      )}
      <h2 className={`${labelStyle === "none" ? "" : "mt-4"} font-display ${titleSize} font-medium leading-[1.05] tracking-[-0.025em] text-site-fg`}>
        {title}
      </h2>
      {desc && (
        <p className={`mt-4 text-[15px] leading-relaxed text-site-muted-fg md:text-[16px] ${centered ? "" : "max-w-2xl"}`}>
          {desc}
        </p>
      )}
    </div>
  );
}

/* =========================================================
   0. Cómo funciona — la promesa central: nosotros lo configuramos
========================================================= */

export function HowItWorksSection() {
  const { t } = useI18n();
  const steps = [
    {
      n: "01",
      icon: MessageCircle,
      title: t("Nos cuentas de tu negocio", "You tell us about your business"),
      desc: t(
        "Por WhatsApp: qué vendes, tus precios, tus horarios, tu equipo. Nada de formularios largos ni configuraciones técnicas de tu parte.",
        "Over WhatsApp: what you sell, your prices, your hours, your team. No long forms, no technical setup on your end."
      ),
    },
    {
      n: "02",
      icon: Wrench,
      title: t("Nosotros lo configuramos", "We set it up"),
      desc: t(
        "Conectamos tu número, entrenamos tu IA con la información real de tu negocio, y la probamos antes de activarla.",
        "We connect your number, train your AI with your business' real information, and test it before turning it on."
      ),
    },
    {
      n: "03",
      icon: Rocket,
      title: t("Recibes tu bot funcionando", "You get your bot, working"),
      desc: t(
        "En menos de 24 horas tu WhatsApp ya está respondiendo solo, listo para atender clientes.",
        "In under 24 hours your WhatsApp is already replying on its own, ready to serve customers."
      ),
    },
  ];
  return (
    <section id="como-funciona" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <SectionHeading
          eyebrow={t("Cómo funciona", "How it works")}
          title={<>{t("Tú no configuras nada.", "You don't configure anything.")} <br className="hidden md:block" />{t("Lo hacemos nosotros, en menos de 24 horas.", "We do it, in under 24 hours.")}</>}
          align="center"
        />
        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 100}>
              <div className="relative h-full rounded-2xl border border-site-border bg-site-card/50 p-7">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-site-muted-fg/60">{s.n}</span>
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-site-primary/10 ring-1 ring-site-primary/20">
                    <s.icon className="h-4 w-4 text-site-primary" />
                  </div>
                </div>
                <h3 className="mt-5 font-display text-[18px] font-medium tracking-tight text-site-fg">{s.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-site-muted-fg">{s.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   1. Qué incluye — grilla compacta de los 8 módulos reales
========================================================= */

export function FeaturesGridSection() {
  const { t } = useI18n();
  const FEATURES = [
    {
      icon: Bot,
      title: t("Agentes de IA", "AI agents"),
      desc: t("Un agente por número, entrenado con tus instrucciones y tu conocimiento.", "One agent per number, trained with your instructions and your knowledge."),
    },
    {
      icon: ClipboardList,
      title: t("Encuestas", "Surveys"),
      desc: t("Encuestas por WhatsApp con analítica de respuestas e insights por IA.", "WhatsApp surveys with response analytics and AI insights."),
    },
    {
      icon: Send,
      title: t("Campañas", "Campaigns"),
      desc: t("Mensajes masivos con plantillas aprobadas por Meta. Sin herramientas no oficiales.", "Bulk messages with Meta-approved templates. No unofficial tools."),
    },
    {
      icon: Users,
      title: t("Equipo", "Team"),
      desc: t("Asigna conversaciones entre varios agentes humanos, con roles.", "Assign conversations across multiple human agents, with roles."),
    },
    {
      icon: FileUp,
      title: t("Base de conocimiento", "Knowledge base"),
      desc: t("Sube tu Excel, CSV o PDF; el agente responde con datos reales.", "Upload your Excel, CSV or PDF; the agent replies with real data."),
    },
    {
      icon: Zap,
      title: t("Respuestas rápidas", "Quick replies"),
      desc: t("Frases guardadas para responder más rápido desde el inbox.", "Saved phrases to reply faster from the inbox."),
    },
    {
      icon: ChartNoAxesCombined,
      title: "Analytics",
      desc: t("Mensajes procesados, embudo de entrega y desempeño por canal.", "Messages processed, delivery funnel and performance by channel."),
    },
    {
      icon: Phone,
      title: t("Multi-número", "Multi-number"),
      desc: t("Conecta y administra varias líneas desde un solo panel.", "Connect and manage several lines from a single panel."),
    },
  ];
  return (
    <section id="incluye" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <SectionHeading
          eyebrow={t("Qué incluye", "What's included")}
          title={<>{t("Todo lo que necesitas para operar", "Everything you need to run")} <br className="hidden md:block" />{t("WhatsApp con IA, en un solo panel.", "WhatsApp with AI, in a single panel.")}</>}
          align="center"
        />
        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-site-border bg-white/5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 4) * 60} className="h-full">
              <div className="group h-full bg-site-bg p-5 transition-colors hover:bg-site-card">
                <f.icon className="h-4 w-4 text-site-primary" />
                <h3 className="mt-3 font-display text-[14px] font-medium tracking-tight text-site-fg">{f.title}</h3>
                <p className="mt-1.5 text-[12px] leading-relaxed text-site-muted-fg">{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   2. Métricas (afirmaciones honestas, no cifras inventadas)
========================================================= */

export function MetricsSection() {
  const { t } = useI18n();
  const metrics = [
    { v: "100%", l: t("API Oficial de Meta", "Official Meta API"), s: t("Cada mensaje pasa por la infraestructura oficial de WhatsApp.", "Every message goes through WhatsApp's official infrastructure.") },
    { v: "✓", l: t("Sin herramientas no oficiales", "No unofficial tools"), s: t("Infraestructura oficial de WhatsApp, sin extensiones ni hacks.", "Official WhatsApp infrastructure, no extensions or hacks.") },
    { v: "24/7", l: t("IA respondiendo", "AI replying"), s: t("Mientras tú sigues usando tu WhatsApp normal.", "While you keep using your regular WhatsApp.") },
    { v: "<2s", l: t("Tiempo de respuesta", "Response time"), s: t("Respuestas instantáneas para tus clientes.", "Instant replies for your customers.") },
  ];
  return (
    <section id="metricas" className="relative border-t border-site-border py-10">
      <div className="mx-auto max-w-[1440px] px-6">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-site-border bg-white/5 md:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.l} className="bg-site-bg p-6 text-center">
              <div className="font-display text-[32px] font-medium leading-none tracking-tight text-site-primary md:text-[38px]">
                {m.v}
              </div>
              <div className="mt-3 text-[12.5px] font-medium text-site-fg">{m.l}</div>
              <div className="mt-1 text-[11px] text-site-muted-fg">{m.s}</div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-[12.5px] text-site-muted-fg">
          {t(
            "Incluye Modo coexistencia: sigues usando tu WhatsApp normal desde el celular mientras la IA responde en paralelo.",
            "Includes Coexistence mode: you keep using your regular WhatsApp from your phone while the AI replies in parallel."
          )}
        </p>
      </div>
    </section>
  );
}

/* =========================================================
   3. Precios (planes reales de Du Labs)
========================================================= */

// Enterprise NO es un plan más de esta grilla -- es un proyecto a medida,
// con su propia sección (ver EnterpriseSections.tsx) y sin precio fijo. Esta
// grilla es exclusivamente "WhatsApp + IA" (Start/Growth/Scale).
const PLANES_WHATSAPP: PlanId[] = ["start", "growth", "scale"];

export function PricingSection({ showComparisonLink = false }: { showComparisonLink?: boolean } = {}) {
  const { t, lang } = useI18n();
  const tiers = PLANES_WHATSAPP.map((id) => {
    const def = PLANES[id];
    const copy = PRICING_COPY[id];
    return {
      id,
      nombre: def.nombre,
      precioMensual: def.precioCop !== null ? `$${def.precioCop.toLocaleString("es-CO")}` : t("Cotización", "Custom quote"),
      precioImplementacion: def.implementacionCop !== null ? `$${def.implementacionCop.toLocaleString("es-CO")}` : null,
      tag: lang === "en" ? copy.tag.en : copy.tag.es,
      features: copy.features.map((f) => (lang === "en" ? f.en : f.es)),
      campanas: {
        porMes: lang === "en" ? copy.campanas.porMes.en : copy.campanas.porMes.es,
        destinatarios: lang === "en" ? copy.campanas.destinatarios.en : copy.campanas.destinatarios.es,
      },
      boton: lang === "en" ? copy.boton.en : copy.boton.es,
      featured: id === "growth",
    };
  });
  return (
    <section id="precios" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        {/* Transición: esto es UNO de los productos de DuLabs, no todo DuLabs
            -- ver EnterpriseSection para el resto. */}
        <p className="mb-4 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-site-muted-fg">
          {t("Una de nuestras soluciones más utilizadas", "One of our most used solutions")}
        </p>
        <SectionHeading
          eyebrow={t("Planes WhatsApp con IA", "WhatsApp with AI plans")}
          title={<>{t("Un plan para cada etapa de tu negocio.", "A plan for every stage of your business.")}</>}
          desc={t(
            "Nosotros configuramos tu asistente de IA según la información y procesos de tu negocio. Precios en pesos colombianos (COP).",
            "We configure your AI assistant based on your business' information and processes. Prices in Colombian pesos (COP)."
          )}
          align="center"
        />
        <div className="mx-auto mt-14 grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.id}
              className={`relative flex flex-col overflow-hidden rounded-2xl border p-7 ${
                tier.featured
                  ? "border-site-primary/30 bg-gradient-to-b from-site-primary/[0.08] to-site-card/60 ring-1 ring-site-primary/20"
                  : "border-site-border bg-site-card/50"
              }`}
            >
              {tier.featured && (
                <div className="absolute right-5 top-5 rounded-full bg-site-primary px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-widest text-site-primary-fg">
                  {t("Más elegido", "Most chosen")}
                </div>
              )}

              {/* 1-2. Nombre + descripción */}
              <div className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">{tier.nombre}</div>
              <p className="mt-2 text-[13px] text-site-muted-fg">{tier.tag}</p>

              {/* 3. Precio mensual */}
              <div className="mt-5 flex items-baseline gap-1">
                <span className="font-display text-[30px] font-medium tracking-tight text-site-fg">{tier.precioMensual}</span>
                {tier.id !== "enterprise" && <span className="text-[12px] text-site-muted-fg">{t("COP / mes", "COP / mo")}</span>}
              </div>
              <div className="font-mono text-[9.5px] uppercase tracking-widest text-site-muted-fg/70">{t("Plan mensual", "Monthly plan")}</div>

              {/* 4. Implementación (pago único) -- visualmente separada del
                  mensual a propósito, para que no se lean como el mismo precio. */}
              {tier.precioImplementacion && (
                <div className="mt-4 rounded-lg border border-site-border/70 bg-black/20 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[9.5px] uppercase tracking-widest text-site-muted-fg">{t("Implementación", "Setup")}</span>
                    <span className="font-mono text-[9px] uppercase tracking-widest text-site-primary">{t("Pago único", "One-time")}</span>
                  </div>
                  <div className="mt-1 font-display text-[17px] font-medium text-site-fg">{tier.precioImplementacion}</div>
                  <p className="mt-1 text-[10.5px] italic leading-relaxed text-site-muted-fg">
                    {t(
                      "Pago único por la configuración y puesta en marcha de tu asistente.",
                      "One-time payment to configure and launch your assistant."
                    )}
                  </p>
                </div>
              )}

              {/* 5. Beneficios */}
              <div className="mt-6 space-y-2.5 border-t border-site-border pt-6">
                {tier.features.map((f) => (
                  <div key={f} className="flex items-start gap-2.5 text-[13px] text-site-fg/90">
                    <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-site-primary" />
                    {f}
                  </div>
                ))}
              </div>

              {/* 6. Campañas -- bloque propio, nunca un checkmark más, para
                  que quede claro que el envío no está incluido. */}
              <div className="mt-5 rounded-lg border border-site-border/70 bg-black/20 p-3">
                <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-site-fg">
                  <Megaphone className="h-3.5 w-3.5 text-site-primary" />
                  {t("Campañas de WhatsApp", "WhatsApp campaigns")}
                </div>
                <ul className="mt-2 space-y-1 text-[12px] text-site-muted-fg">
                  <li>{tier.campanas.porMes}</li>
                  <li>{tier.campanas.destinatarios}</li>
                </ul>
                <p className="mt-2 text-[11px] font-semibold text-site-fg">{t("Envío no incluido.", "Sending not included.")}</p>
                <p className="mt-1 text-[10px] italic leading-relaxed text-site-muted-fg">
                  {t(
                    "Meta cobra directamente al negocio los cargos de mensajería de WhatsApp según sus tarifas vigentes.",
                    "Meta charges the business directly for WhatsApp messaging fees, per its current pricing."
                  )}
                </p>
              </div>

              {/* 7. Botón */}
              <PlanButton
                planId={tier.id}
                label={tier.boton}
                className={`mt-6 inline-flex h-10 w-full items-center justify-center rounded-lg text-[13px] font-medium transition-all ${
                  tier.featured
                    ? "bg-site-primary text-site-primary-fg hover:brightness-110"
                    : "border border-site-border text-site-fg hover:border-white/20 hover:bg-site-card"
                }`}
              />
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-[11.5px] text-site-muted-fg">
          {t("Los límites de IA y campañas son independientes.", "AI and campaign limits are independent of each other.")}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px] text-site-muted-fg">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-site-primary" /> {t("API Oficial de Meta", "Official Meta API")}</span>
          <span className="inline-flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-site-primary" /> {t("Datos alojados de forma segura", "Data hosted securely")}</span>
          <span className="inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-site-primary" /> {t("IA con Claude (Anthropic)", "AI powered by Claude (Anthropic)")}</span>
        </div>

        {showComparisonLink && (
          <div className="mt-8 text-center">
            <Link href="/precios" className="inline-flex items-center gap-1 text-[13px] font-medium text-site-fg hover:text-site-primary">
              {t("Ver comparación completa", "See full comparison")} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}

        {/* Aclaración general: Meta cobra la mensajería aparte, directo al negocio. */}
        <div className="mx-auto mt-14 max-w-2xl rounded-2xl border border-site-border bg-site-card/40 p-6 text-center md:p-8">
          <h3 className="font-display text-[18px] font-medium text-site-fg">{t("¿Y el costo de WhatsApp?", "What about the cost of WhatsApp?")}</h3>
          <p className="mt-3 text-[13.5px] leading-relaxed text-site-muted-fg">
            {t(
              "Tu suscripción a DuLabs cubre la plataforma, la configuración y el uso de la IA según el plan elegido.",
              "Your DuLabs subscription covers the platform, the setup and the AI usage for your chosen plan."
            )}
          </p>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-site-muted-fg">
            {t(
              "Los costos de mensajería de WhatsApp no están incluidos en la suscripción de DuLabs. Meta cobra directamente al negocio los cargos correspondientes a los mensajes enviados mediante WhatsApp Business Platform, de acuerdo con sus tarifas vigentes.",
              "WhatsApp messaging costs aren't included in the DuLabs subscription. Meta charges the business directly for messages sent through the WhatsApp Business Platform, per its current pricing."
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   3b. Siguiente nivel — automatización a la medida, sin precio, se cotiza aparte
========================================================= */

export function NextLevelSection() {
  const { t, lang } = useI18n();
  const items = [
    t("Integraciones con tu CRM, calendario o sistema de pagos", "Integrations with your CRM, calendar or payment system"),
    t("Flujos automáticos a la medida de tu negocio (agenda, cobros, seguimientos)", "Custom automated flows for your business (scheduling, payments, follow-ups)"),
    t("Paneles y reportes hechos a tu medida", "Custom-built dashboards and reports"),
    t("Automatizaciones que conectan WhatsApp con el resto de tus herramientas", "Automations that connect WhatsApp to the rest of your tools"),
  ];
  return (
    <section id="siguiente-nivel" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <div className="overflow-hidden rounded-2xl border border-site-border bg-site-card/40 p-8 md:p-12">
          <div className="grid gap-10 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <SectionHeading
                eyebrow={t("Cuando quieras llevarlo más lejos", "When you want to take it further")}
                labelStyle="kicker"
                size="md"
                title={t("Automatización e implementación a la medida.", "Custom automation and implementation.")}
                desc={t(
                  "El bot en 24 horas es el punto de partida. Cuando tu negocio esté listo para el siguiente nivel, construimos automatizaciones e integraciones a la medida — esto se conversa y se cotiza aparte, según lo que necesites.",
                  "The 24-hour bot is the starting point. When your business is ready for the next level, we build custom automations and integrations — this is discussed and quoted separately, based on what you need."
                )}
              />
              <ul className="mt-6 flex flex-col gap-2.5">
                {items.map((it) => (
                  <li key={it} className="flex items-start gap-2.5 text-[13.5px] text-site-fg/90">
                    <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-site-primary" />
                    {it}
                  </li>
                ))}
              </ul>
            </div>
            <a
              href={whatsappVentasUrl(
                lang === "en"
                  ? "Hi, I'd like to talk about custom automation for my business."
                  : "Hola, quiero hablar sobre automatización a la medida para mi negocio."
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-full border border-site-border bg-site-card px-6 text-[13.5px] font-medium text-site-fg transition-all hover:border-white/20 md:w-fit"
            >
              {t("Hablemos de tu caso", "Let's talk about your case")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   4. FAQ (respuestas reales)
========================================================= */

export function FaqSection({ ids, showMoreLink = false }: { ids?: string[]; showMoreLink?: boolean } = {}) {
  const { t } = useI18n();
  const allFaqs = [
    {
      id: "que-es-dulabs",
      q: t("¿Qué es DuLabs?", "What is DuLabs?"),
      a: t(
        "DuLabs es una empresa de tecnología con sede en Montería, Colombia, que diseña e implementa soluciones de inteligencia artificial, automatización, software e integraciones para empresas. WhatsApp con IA es uno de nuestros productos, no el único.",
        "DuLabs is a technology company based in Montería, Colombia, that designs and implements AI, automation, software and integration solutions for businesses. WhatsApp with AI is one of our products, not the only one."
      ),
    },
    {
      id: "solo-whatsapp",
      q: t("¿DuLabs solo trabaja con WhatsApp?", "Does DuLabs only work with WhatsApp?"),
      a: t(
        "No. WhatsApp con IA es nuestro producto principal, pero también desarrollamos automatizaciones, software a medida, CRM personalizados e integraciones entre sistemas. Si tu proyecto va más allá de WhatsApp, lo construimos igual.",
        "No. WhatsApp with AI is our main product, but we also build automations, custom software, custom CRMs and integrations between systems. If your project goes beyond WhatsApp, we build that too."
      ),
    },
    {
      id: "software-personalizado",
      q: t("¿Pueden desarrollar software personalizado?", "Can you build custom software?"),
      a: t(
        "Sí. Construimos plataformas web, sistemas internos, dashboards y herramientas empresariales cuando una solución estándar no se adapta a tu proceso.",
        "Yes. We build web platforms, internal systems, dashboards and business tools when an off-the-shelf solution doesn't fit your process."
      ),
    },
    {
      id: "automatizar-procesos",
      q: t("¿Pueden automatizar procesos de mi empresa?", "Can you automate my company's processes?"),
      a: t(
        "Sí. Automatizamos tareas repetitivas, notificaciones, seguimiento de clientes, asignación de tareas y flujos operativos, conectando las herramientas que ya usa tu equipo.",
        "Yes. We automate repetitive tasks, notifications, customer follow-up, task assignment and operational workflows, connecting the tools your team already uses."
      ),
    },
    {
      id: "integrar-crm",
      q: t("¿Pueden integrar WhatsApp con mi CRM?", "Can you integrate WhatsApp with my CRM?"),
      a: t(
        "Sí. Conectamos WhatsApp Business con tu CRM u otras herramientas mediante APIs, para que la información de tus conversaciones y clientes fluya en un solo lugar.",
        "Yes. We connect WhatsApp Business with your CRM or other tools via APIs, so your conversation and customer data flows into one place."
      ),
    },
    {
      id: "empresas-grandes",
      q: t("¿Trabajan con empresas grandes?", "Do you work with large companies?"),
      a: t(
        "Sí. Además de nuestros planes de WhatsApp con IA, tenemos una línea Enterprise para empresas que necesitan proyectos a medida: integraciones, sistemas internos y soluciones diseñadas alrededor de su operación.",
        "Yes. Besides our WhatsApp with AI plans, we have an Enterprise line for companies that need custom projects: integrations, internal systems and solutions designed around their operation."
      ),
    },
    {
      id: "como-funciona-implementacion",
      q: t("¿Cómo funciona una implementación?", "How does an implementation work?"),
      a: t(
        "Entendemos tu negocio y objetivo, diseñamos la solución, la desarrollamos e integramos, y la ponemos en funcionamiento acompañándote en el proceso. Para WhatsApp con IA esto toma menos de 24 horas; para proyectos a medida el tiempo depende del alcance.",
        "We learn your business and goal, design the solution, build and integrate it, and put it to work while staying with you through the process. For WhatsApp with AI this takes under 24 hours; for custom projects the timeline depends on scope."
      ),
    },
    {
      id: "costo-proyecto",
      q: t("¿Cuánto cuesta un proyecto personalizado?", "How much does a custom project cost?"),
      a: t(
        "El valor depende del alcance, las integraciones y la complejidad del proyecto. Trabajamos mediante cotización personalizada: nos cuentas qué necesitas y te proponemos un presupuesto acorde.",
        "The cost depends on the scope, integrations and complexity of the project. We work through custom quotes: tell us what you need and we'll propose a budget that fits."
      ),
    },
    {
      id: "conexion",
      q: t("¿Qué tan rápido queda listo mi bot?", "How fast is my bot ready?"),
      a: t(
        "Menos de 24 horas. Nos cuentas de tu negocio por WhatsApp, nosotros conectamos tu número, entrenamos tu IA y te avisamos apenas quede funcionando.",
        "Under 24 hours. You tell us about your business over WhatsApp, we connect your number, train your AI, and let you know as soon as it's up and running."
      ),
    },
    {
      id: "quien-configura",
      q: t("¿Yo tengo que configurar algo?", "Do I have to configure anything?"),
      a: t(
        "No. Nosotros conectamos tu número, escribimos las instrucciones de tu IA y probamos que responda bien antes de activarla. Tú solo nos cuentas de tu negocio.",
        "No. We connect your number, write your AI's instructions, and test that it replies well before turning it on. You just tell us about your business."
      ),
    },
    {
      id: "api-oficial",
      q: t("¿Usan la API oficial de WhatsApp?", "Do you use the official WhatsApp API?"),
      a: t(
        "Sí. Todo pasa por la API Oficial de WhatsApp Business (Meta Cloud API) — sin herramientas no oficiales.",
        "Yes. Everything goes through the Official WhatsApp Business API (Meta Cloud API) — no unofficial tools."
      ),
    },
    {
      id: "modelo-ia",
      q: t("¿Qué modelo de IA usan?", "Which AI model do you use?"),
      a: t(
        "Usamos Claude, de Anthropic, entrenado con el prompt específico de tu negocio: precios, horarios y tono de atención.",
        "We use Claude, by Anthropic, trained with your business-specific prompt: prices, hours and tone of service."
      ),
    },
    {
      id: "control",
      q: t("¿Pierdo el control de mi WhatsApp?", "Do I lose control of my WhatsApp?"),
      a: t(
        "No. Con Modo Coexistencia sigues usando tu WhatsApp Business normal desde el celular. La IA responde en paralelo y se pausa sola en cualquier chat donde tú respondas.",
        "No. With Coexistence Mode you keep using your regular WhatsApp Business from your phone. The AI replies in parallel and pauses itself in any chat where you reply."
      ),
    },
    {
      id: "masivos",
      q: t("¿Puedo enviar mensajes masivos?", "Can I send bulk messages?"),
      a: t(
        "Sí, con plantillas aprobadas por Meta. Creas la plantilla, Meta la aprueba, y envías la campaña a tu lista de clientes desde tu panel.",
        "Yes, with Meta-approved templates. You create the template, Meta approves it, and you send the campaign to your customer list from your dashboard."
      ),
    },
    {
      id: "cancelar",
      q: t("¿Qué pasa si cancelo mi plan?", "What happens if I cancel my plan?"),
      a: t(
        "Tu plan se cobra mes a mes. Puedes cancelar cuando quieras eliminando tu cuenta desde Ajustes → Cuenta: esto desconecta tus números de Meta y borra tus datos de forma permanente, así que solo está ahí para cuando de verdad quieras cerrar todo.",
        "Your plan is billed month to month. You can cancel anytime by deleting your account from Settings → Account: this disconnects your numbers from Meta and permanently erases your data, so it's there for when you actually want to shut everything down."
      ),
    },
    {
      id: "seguridad",
      q: t("¿Mis datos están seguros?", "Is my data secure?"),
      a: t(
        "Tus tokens de acceso a Meta y tus claves de IA se guardan cifrados (AES-256) en la base de datos, nunca en texto plano. Usamos medios razonables para proteger tu información, aunque ningún sistema puede garantizar seguridad absoluta — el detalle completo está en nuestra Política de Privacidad.",
        "Your Meta access tokens and AI keys are stored encrypted (AES-256) in the database, never in plain text. We use reasonable safeguards to protect your information, though no system can guarantee absolute security — the full detail is in our Privacy Policy."
      ),
    },
    {
      id: "meta-cobra",
      q: t("¿Meta me cobra algo aparte de mi plan de Du Labs?", "Does Meta charge me anything on top of my Du Labs plan?"),
      a: t(
        "Sí. Tu plan de Du Labs cubre la plataforma, el agente de IA y el panel — pero Meta cobra directamente por las conversaciones de WhatsApp según su propio modelo de precios (WhatsApp Business Platform), independiente de tu suscripción con nosotros. Esas tarifas las define y cobra Meta, no Du Labs.",
        "Yes. Your Du Labs plan covers the platform, the AI agent and the dashboard — but Meta charges directly for WhatsApp conversations under its own pricing model (WhatsApp Business Platform), separate from your subscription with us. Those fees are set and billed by Meta, not Du Labs."
      ),
    },
    {
      id: "integraciones",
      q: t("¿Con qué se integra DuLabs hoy?", "What does DuLabs integrate with today?"),
      a: t(
        "Nuestro producto de WhatsApp con IA corre 100% sobre la API Oficial de WhatsApp Business (Meta Cloud API), con IA entrenada, plantillas, campañas y bandeja centralizada. Para proyectos a medida también integramos con CRM y otras herramientas mediante APIs, según lo que necesite cada empresa.",
        "Our WhatsApp with AI product runs 100% on the Official WhatsApp Business API (Meta Cloud API), with trained AI, templates, campaigns and a centralized inbox. For custom projects we also integrate with CRMs and other tools via APIs, depending on what each company needs."
      ),
    },
  ];
  const faqs = ids
    ? ids.map((id) => allFaqs.find((f) => f.id === id)).filter((f): f is (typeof allFaqs)[number] => Boolean(f))
    : allFaqs;
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-3xl px-6">
        <SectionHeading
          eyebrow={t("Preguntas frecuentes", "Frequently asked questions")}
          labelStyle="kicker"
          size="md"
          title={<>{t("Respuestas, antes de que preguntes.", "Answers, before you even ask.")}</>}
          align="center"
        />
        <div className="mt-12">
          {faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q} className={`border-t border-site-border ${i === faqs.length - 1 ? "border-b" : ""}`}>
                <button onClick={() => setOpen(isOpen ? null : i)} className="flex w-full items-start gap-4 py-5 text-left">
                  <span className="mt-0.5 shrink-0 font-mono text-[11px] text-site-muted-fg/50">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-display text-[15px] font-medium text-site-fg">{f.q}</span>
                      <Plus className={`h-4 w-4 flex-shrink-0 text-site-muted-fg transition-transform duration-200 ${isOpen ? "rotate-45 text-site-primary" : ""}`} />
                    </div>
                    <div className={`grid overflow-hidden text-[13.5px] leading-relaxed text-site-muted-fg transition-all ${isOpen ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                      <div className="min-h-0 overflow-hidden">{f.a}</div>
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
        {showMoreLink && (
          <div className="mt-8 text-center">
            <Link href="/preguntas-frecuentes" className="inline-flex items-center gap-1 text-[13px] font-medium text-site-fg hover:text-site-primary">
              {t("Ver todas las preguntas", "See all questions")} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

/* =========================================================
   5. CTA final
========================================================= */

export function FinalCta() {
  const { t, lang } = useI18n();
  return (
    <section id="demo" className="relative overflow-hidden border-t border-site-border py-24">
      <div className="pointer-events-none absolute inset-0 site-ambient-bg animate-site-ambient opacity-90" />
      <div className="pointer-events-none absolute inset-0 site-grid-bg [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_70%)]" />

      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <SectionLabel>{t("Empecemos", "Let's start")}</SectionLabel>
        <h2 className="mt-5 font-display text-[38px] font-medium leading-[1.05] tracking-[-0.025em] site-text-gradient md:text-[56px]">
          {t("Cuéntanos de tu negocio", "Tell us about your business")} <br />
          <span className="site-text-gradient-primary">{t("y lo tienes funcionando mañana.", "and have it running tomorrow.")}</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-site-muted-fg">
          {t(
            "Sin configuración de tu parte. Infraestructura oficial de WhatsApp, listo para producción en menos de 24 horas.",
            "Nothing for you to configure. Official WhatsApp infrastructure, production-ready in under 24 hours."
          )}
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a
            href={whatsappVentasUrl(lang === "en" ? MENSAJE_WHATSAPP_GENERICO_EN : MENSAJE_WHATSAPP_GENERICO_ES)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackConversion("cta_whatsapp", { source: "final_cta" })}
            className="group inline-flex h-11 items-center rounded-full bg-site-fg px-5 text-[13.5px] font-medium text-site-bg transition-all hover:bg-site-fg/90"
          >
            {t("Hablar por WhatsApp", "Chat on WhatsApp")} <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a
            href="#precios"
            className="inline-flex h-11 items-center rounded-full border border-site-border bg-site-card px-5 text-[13.5px] font-medium text-site-fg hover:border-white/20"
          >
            {t("Ver planes", "See plans")}
          </a>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   Footer
========================================================= */

export function Footer() {
  const { t } = useI18n();
  const cols = [
    {
      title: t("Soluciones", "Solutions"),
      links: [
        { l: t("WhatsApp con IA", "WhatsApp with AI"), h: "/whatsapp-ia" },
        { l: t("Automatización", "Automation"), h: "/automatizacion-empresas" },
        { l: t("Software a medida", "Custom software"), h: "/software-a-medida" },
        { l: t("Integraciones", "Integrations"), h: "/integraciones" },
        { l: t("CRM personalizado", "Custom CRM"), h: "/crm-personalizado" },
      ],
    },
    {
      title: t("Empresa", "Company"),
      links: [
        { l: "Enterprise", h: "/soluciones-empresariales" },
        { l: t("Casos", "Case studies"), h: "/casos" },
        { l: t("Recursos", "Resources"), h: "/recursos" },
        { l: t("Contacto", "Contact"), h: "/#contacto" },
      ],
    },
    {
      title: "Legal",
      links: [
        { l: t("Privacidad", "Privacy"), h: "/privacidad" },
        { l: t("Términos", "Terms"), h: "/terminos" },
        { l: t("Eliminación de datos - WhatsApp", "Data deletion - WhatsApp"), h: "/eliminacion-de-datos-whatsapp" },
      ],
    },
  ];
  return (
    <footer className="relative border-t border-site-border bg-site-bg">
      <div className="mx-auto max-w-[1440px] px-6 py-16">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="col-span-2">
            <div className="flex items-center gap-2 font-display text-[15px] font-medium tracking-tight text-site-fg">
              <Image src="/logo.png" alt="Du Labs" width={24} height={24} className="rounded-full" />
              DuLabs
            </div>
            <p className="mt-4 max-w-xs text-[12.5px] leading-relaxed text-site-muted-fg">
              {t(
                "IA, automatización y software para empresas. Hecho en Montería, Colombia.",
                "AI, automation and software for businesses. Made in Montería, Colombia."
              )}
            </p>
            <div className="mt-6 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">
              <span className="h-1.5 w-1.5 rounded-full bg-site-primary shadow-[0_0_6px_var(--color-site-primary)]" />
              {t("Todo funcionando con normalidad", "All systems operational")}
            </div>
          </div>
          {cols.map((c) => (
            <div key={c.title}>
              <div className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">{c.title}</div>
              <ul className="mt-3 space-y-2 text-[12.5px]">
                {c.links.map((l) => (
                  <li key={l.l}>
                    <a className="text-site-fg/85 hover:text-site-fg" href={l.h}>
                      {l.l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Datos de identificación del responsable del servicio. Deliberadamente
            SIN dirección física ni teléfono personal: el titular opera desde su
            domicilio y publicarlo exponía su casa. El canal de contacto oficial
            es el correo corporativo, uno solo en todo el sitio. */}
        <div className="mt-14 grid gap-10 border-t border-site-border pt-10 md:grid-cols-2">
          <div>
            <h3 className="text-[12.5px] font-semibold text-site-fg">{t("Información legal", "Legal information")}</h3>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[12.5px] leading-relaxed">
              <dt className="text-site-muted-fg/70">{t("Titular del servicio", "Service holder")}</dt>
              <dd className="text-site-muted-fg">RAMOS PADILLA DUVAN ANDRES</dd>

              <dt className="text-site-muted-fg/70">{t("Nombre comercial", "Trade name")}</dt>
              <dd className="text-site-muted-fg">DULABS</dd>

              <dt className="text-site-muted-fg/70">{t("País de operación", "Country of operation")}</dt>
              <dd className="text-site-muted-fg">{t("Colombia", "Colombia")}</dd>

              <dt className="text-site-muted-fg/70">{t("Sitio web", "Website")}</dt>
              <dd className="text-site-muted-fg">
                <a href="https://www.dulabs.co" className="transition-colors duration-200 hover:text-site-fg">
                  www.dulabs.co
                </a>
              </dd>
            </dl>
            <p className="mt-5 text-[12.5px] leading-relaxed text-site-muted-fg/80">
              {t(
                "Du Labs es una marca comercial y plataforma digital operada por RAMOS PADILLA DUVAN ANDRES.",
                "Du Labs is a trademark and digital platform operated by RAMOS PADILLA DUVAN ANDRES."
              )}
            </p>
          </div>
          <div className="md:justify-self-end">
            <h3 className="text-[12.5px] font-semibold text-site-fg">{t("Contacto", "Contact")}</h3>
            <ul className="mt-4 flex flex-col gap-2 text-[12.5px] text-site-muted-fg">
              <li>
                <a href="mailto:contacto@dulabs.co" className="transition-colors duration-200 hover:text-site-fg">
                  contacto@dulabs.co
                </a>
              </li>
              <li>
                <a href="https://www.dulabs.co" className="transition-colors duration-200 hover:text-site-fg">
                  dulabs.co
                </a>
              </li>
              <li className="text-site-muted-fg/70">{t("Montería, Colombia", "Montería, Colombia")}</li>
            </ul>
            <p className="mt-4 max-w-[26ch] text-[12px] leading-relaxed text-site-muted-fg/70">
              {t(
                "Escríbenos por correo y te respondemos en horario hábil.",
                "Email us and we'll get back to you during business hours."
              )}
            </p>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-site-border pt-8 text-[11px] text-site-muted-fg/70">
          <p>© {new Date().getFullYear()} Du Labs. {t("Todos los derechos reservados.", "All rights reserved.")}</p>
          <p>{t("Hecho en Colombia 🇨🇴", "Made in Colombia 🇨🇴")}</p>
        </div>
      </div>
    </footer>
  );
}
