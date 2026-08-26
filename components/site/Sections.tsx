"use client";

import {
  ArrowRight,
  Bot,
  ChartNoAxesCombined,
  Check,
  ClipboardList,
  FileUp,
  Globe,
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
import { PLANES, ORDEN_PLANES } from "@/lib/planes";
import { PRICING_COPY } from "./pricing-copy";
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
      <div className="mx-auto max-w-[1280px] px-6">
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
      desc: t("Mensajes masivos con plantillas aprobadas por Meta, sin riesgo de bloqueo.", "Bulk messages with Meta-approved templates, no ban risk."),
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
      <div className="mx-auto max-w-[1280px] px-6">
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
    { v: "0%", l: t("Riesgo de bloqueo", "Ban risk"), s: t("Sin extensiones ni trucos que arriesguen tu número.", "No extensions or hacks that risk your number.") },
    { v: "24/7", l: t("IA respondiendo", "AI replying"), s: t("Mientras tú sigues usando tu WhatsApp normal.", "While you keep using your regular WhatsApp.") },
    { v: "<2s", l: t("Tiempo de respuesta", "Response time"), s: t("Respuestas instantáneas para tus clientes.", "Instant replies for your customers.") },
  ];
  return (
    <section id="metricas" className="relative border-t border-site-border py-10">
      <div className="mx-auto max-w-[1280px] px-6">
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

export function PricingSection({ showComparisonLink = false }: { showComparisonLink?: boolean } = {}) {
  const { t, lang } = useI18n();
  const tiers = ORDEN_PLANES.map((id) => {
    const def = PLANES[id];
    const copy = PRICING_COPY[id];
    return {
      id,
      nombre: def.nombre,
      precio: def.precioCop !== null ? `$${def.precioCop.toLocaleString("es-CO")}` : t("Cotización", "Custom quote"),
      tag: lang === "en" ? copy.tag.en : copy.tag.es,
      features: copy.features.map((f) => (lang === "en" ? f.en : f.es)),
      featured: id === "growth",
    };
  });
  return (
    <section id="precios" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow={t("Precios", "Pricing")}
          title={<>{t("Un plan para cada etapa de tu negocio.", "A plan for every stage of your business.")}</>}
          desc={t("Precios en pesos colombianos (COP), cobro recurrente mensual.", "Prices in Colombian pesos (COP), recurring monthly billing.")}
          align="center"
        />
        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {tiers.map((tier) => (
            <div
              key={tier.id}
              className={`relative overflow-hidden rounded-2xl border p-7 ${
                tier.featured
                  ? "border-site-primary/30 bg-gradient-to-b from-site-primary/[0.08] to-site-card/60 ring-1 ring-site-primary/20"
                  : "border-site-border bg-site-card/50"
              }`}
            >
              {tier.featured && (
                <div className="absolute right-5 top-5 rounded-full bg-site-primary px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-widest text-site-primary-fg">
                  {t("Recomendado", "Recommended")}
                </div>
              )}
              <div className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">{tier.nombre}</div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-display text-[32px] font-medium tracking-tight text-site-fg">{tier.precio}</span>
                {tier.id !== "enterprise" && <span className="text-[12px] text-site-muted-fg">{t("COP / mes", "COP / mo")}</span>}
              </div>
              <p className="mt-2 text-[13px] text-site-muted-fg">{tier.tag}</p>
              <PlanButton
                planId={tier.id}
                className={`mt-6 inline-flex h-10 w-full items-center justify-center rounded-lg text-[13px] font-medium transition-all ${
                  tier.featured
                    ? "bg-site-primary text-site-primary-fg hover:brightness-110"
                    : "border border-site-border text-site-fg hover:border-white/20 hover:bg-site-card"
                }`}
              />
              <div className="mt-6 space-y-2.5 border-t border-site-border pt-6">
                {tier.features.map((f) => (
                  <div key={f} className="flex items-start gap-2.5 text-[13px] text-site-fg/90">
                    <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-site-primary" />
                    {f}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

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
      <div className="mx-auto max-w-[1280px] px-6">
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
        "Sí. Todo pasa por la API Oficial de WhatsApp Business (Meta Cloud API) — sin hacks no oficiales, sin riesgo de baneo.",
        "Yes. Everything goes through the Official WhatsApp Business API (Meta Cloud API) — no unofficial hacks, no ban risk."
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
      q: t("¿Con qué se integra Du Labs hoy?", "What does Du Labs integrate with today?"),
      a: t(
        "Hoy nos enfocamos 100% en hacer WhatsApp Business excelente: conexión oficial, IA entrenada, plantillas y campañas, y bandeja de mensajes centralizada.",
        "Today we're 100% focused on making WhatsApp Business excellent: official connection, trained AI, templates and campaigns, and a centralized message inbox."
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
            "Sin configuración de tu parte, sin bloqueos, listo para producción en menos de 24 horas.",
            "Nothing for you to configure, no bans, production-ready in under 24 hours."
          )}
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a
            href={whatsappVentasUrl(lang === "en" ? MENSAJE_WHATSAPP_GENERICO_EN : MENSAJE_WHATSAPP_GENERICO_ES)}
            target="_blank"
            rel="noopener noreferrer"
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
      title: t("Producto", "Product"),
      links: [
        { l: t("Plataforma", "Platform"), h: "/#plataforma" },
        { l: t("Qué incluye", "What's included"), h: "/#incluye" },
        { l: t("Precios", "Pricing"), h: "/#precios" },
        { l: t("Preguntas frecuentes", "FAQ"), h: "/preguntas-frecuentes" },
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
      <div className="mx-auto max-w-[1280px] px-6 py-16">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          <div className="col-span-2">
            <div className="flex items-center gap-2 font-display text-[15px] font-medium tracking-tight text-site-fg">
              <Image src="/logo.png" alt="Du Labs" width={24} height={24} className="rounded-full" />
              Du Labs
            </div>
            <p className="mt-4 max-w-xs text-[12.5px] leading-relaxed text-site-muted-fg">
              {t(
                "Automatización de WhatsApp Business con IA, sobre la API Oficial de Meta. Hecho en Montería, Colombia.",
                "WhatsApp Business automation with AI, on the Official Meta API. Made in Montería, Colombia."
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
                <a href="https://dulabs.co" className="transition-colors duration-200 hover:text-site-fg">
                  dulabs.co
                </a>
              </li>
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
