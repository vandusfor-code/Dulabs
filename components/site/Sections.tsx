"use client";

import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  Bot,
  Briefcase,
  Check,
  CheckCircle2,
  CreditCard,
  FileCheck2,
  FileText,
  FileUp,
  Gauge,
  Globe,
  GraduationCap,
  HeartPulse,
  Infinity as InfinityIcon,
  Inbox,
  Languages,
  Layers,
  LayoutGrid,
  Lock,
  Megaphone,
  MessageCircle,
  Pause,
  Phone,
  Play,
  Plus,
  Radio,
  Send,
  ServerCog,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import PlanButton from "@/components/PlanButton";
import { Reveal } from "./Reveal";
import { useI18n } from "@/lib/i18n";

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

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-site-border bg-site-card ${className}`}>
      {children}
    </div>
  );
}

function PhoneMock({ children, header }: { children: React.ReactNode; header: React.ReactNode }) {
  return (
    <div className="mx-auto flex h-[440px] w-full max-w-[280px] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-black shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
      {header}
      <div className="flex-1 space-y-2 overflow-hidden bg-[radial-gradient(circle_at_top,#1a1a1a,#0a0a0a)] p-3">
        {children}
      </div>
    </div>
  );
}
function MsgIn({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[85%] rounded-lg rounded-tl-sm bg-site-card px-2.5 py-1.5 text-[11px] text-site-fg/90 ring-1 ring-white/6">
      {children}
    </div>
  );
}
function MsgOut({ children }: { children: React.ReactNode }) {
  return (
    <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-site-primary/15 px-2.5 py-1.5 text-[11px] text-site-fg ring-1 ring-site-primary/25">
      {children}
    </div>
  );
}

/* =========================================================
   1. Modo Coexistencia (reemplaza "Agent Network")
========================================================= */

export function CoexistenceSection() {
  const { t } = useI18n();
  return (
    <section id="coexistencia" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow={t("Modo coexistencia", "Coexistence mode")}
          title={<>{t("La IA responde, tú sigues", "The AI replies, you keep")} <br className="hidden md:block" />{t("usando tu WhatsApp normal.", "using your regular WhatsApp.")}</>}
          desc={t(
            "No pierdes tu número ni tu app. Tu asistente atiende en paralelo desde la nube, y tú puedes tomar cualquier conversación desde tu celular cuando quieras.",
            "You don't lose your number or your app. Your assistant answers in parallel from the cloud, and you can take over any conversation from your phone whenever you want."
          )}
        />

        <div className="mt-12 grid grid-cols-12 gap-4">
          <Panel className="col-span-12 p-6 lg:col-span-7">
            <div className="flex items-center gap-2">
              <Smartphone className="h-3.5 w-3.5 text-site-primary" />
              <span className="font-display text-[13px] font-medium text-site-fg">{t("Tu celular + la IA, al mismo tiempo", "Your phone + the AI, at the same time")}</span>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {[
                { icon: Bot, title: t("La IA responde 24/7", "The AI replies 24/7"), desc: t("Mientras no estás disponible, tu asistente sigue atendiendo con el prompt que tú le diste.", "While you're unavailable, your assistant keeps answering with the prompt you gave it.") },
                { icon: Pause, title: t("Pausa por conversación", "Pause per conversation"), desc: t("En cuanto tú respondes un chat desde tu celular, la IA se pausa sola solo en ese chat.", "As soon as you reply to a chat from your phone, the AI pauses itself in that chat only.") },
                { icon: MessageCircle, title: t("Historial compartido", "Shared history"), desc: t("Todo lo que la IA respondió lo ves también en tu WhatsApp normal, sin duplicados.", "Everything the AI replied also shows up in your regular WhatsApp, with no duplicates.") },
                { icon: ShieldCheck, title: t("Cero riesgo para tu número", "Zero risk to your number"), desc: t("Nada de extensiones de navegador ni trucos — todo corre sobre los servidores oficiales de Meta.", "No browser extensions or hacks — everything runs on Meta's own official servers.") },
              ].map((f) => (
                <div key={f.title} className="rounded-xl border border-site-border bg-site-card p-4">
                  <div className="font-display text-[13.5px] font-medium text-site-fg">{f.title}</div>
                  <div className="mt-1.5 text-[12.5px] leading-relaxed text-site-muted-fg">{f.desc}</div>
                </div>
              ))}
            </div>
          </Panel>

          <div className="col-span-12 lg:col-span-5">
            <PhoneMock
              header={
                <div className="flex items-center gap-2 border-b border-white/5 bg-site-card px-3 py-2.5 text-[11px] text-site-fg">
                  <div className="grid h-6 w-6 place-items-center rounded-full bg-site-primary/15 ring-1 ring-site-primary/25">
                    <Bot className="h-3 w-3 text-site-primary" />
                  </div>
                  <div>
                    <div className="font-medium leading-none">{t("Peluquería Estilo", "Estilo Hair Salon")}</div>
                    <div className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-site-primary">{t("IA activa", "AI active")}</div>
                  </div>
                </div>
              }
            >
              <MsgIn>{t("Hola, ¿tienen turno para hoy?", "Hi, do you have an opening today?")}</MsgIn>
              <MsgOut>{t("¡Hola! Sí, tengo espacio a las 4pm y 5:30pm. ¿Cuál prefieres?", "Hi! Yes, I have 4pm and 5:30pm available. Which do you prefer?")}</MsgOut>
              <MsgIn>{t("A las 5:30", "At 5:30")}</MsgIn>
              <div className="mx-auto my-1 w-fit rounded-full bg-site-card px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest text-site-muted-fg">
                {t("Dueño respondió desde su celular", "Owner replied from their phone")}
              </div>
              <MsgOut>{t("Listo, te espero a las 5:30. ¡Nos vemos!", "Done, see you at 5:30!")}</MsgOut>
            </PhoneMock>
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   2. Plantillas y Campañas (reemplaza "Workflow Studio")
========================================================= */

export function CampaignsSection() {
  const { t } = useI18n();
  return (
    <section id="campanas" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow={t("Plantillas y campañas", "Templates & campaigns")}
          title={<>{t("Mensajes masivos autorizados,", "Authorized bulk messages,")} <br className="hidden md:block" />{t("sin miedo a que te marquen como spam.", "without fear of being flagged as spam.")}</>}
          desc={t(
            "Crea plantillas con Meta, espera la aprobación, y envía campañas a toda tu lista de clientes en segundos — todo desde tu panel.",
            "Create templates with Meta, wait for approval, and send campaigns to your whole customer list in seconds — all from your dashboard."
          )}
        />

        <div className="mt-12 grid grid-cols-12 gap-4">
          <Panel className="col-span-12 lg:col-span-7">
            <div className="flex items-center justify-between border-b border-site-border bg-site-card px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Megaphone className="h-3.5 w-3.5 text-site-primary" />
                <span className="font-display text-[13px] font-medium text-site-fg">promo_julio</span>
                <span className="rounded-full bg-site-primary/10 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-widest text-site-primary ring-1 ring-site-primary/20">
                  {t("Aprobada", "Approved")}
                </span>
              </div>
              <button className="inline-flex items-center gap-1 rounded-md bg-site-primary px-2 py-1 text-[11px] font-medium text-site-primary-fg">
                <Send className="h-3 w-3" /> {t("Enviar", "Send")}
              </button>
            </div>
            <div className="p-5">
              <div className="rounded-lg border border-site-border bg-site-card p-4 text-[13px] leading-relaxed text-site-fg/90">
                {t(
                  "Hola 👋, tenemos una promoción especial esta semana en nuestros servicios. Escríbenos para reservar tu cita.",
                  "Hi 👋, we have a special promotion on our services this week. Message us to book your appointment."
                )}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                {[
                  { l: t("Destinatarios", "Recipients"), v: "312" },
                  { l: t("Enviados", "Sent"), v: "312" },
                  { l: t("Fallidos", "Failed"), v: "0" },
                ].map((s) => (
                  <div key={s.l} className="rounded-lg border border-site-border bg-site-card p-3">
                    <div className="font-display text-[20px] font-medium text-site-fg">{s.v}</div>
                    <div className="mt-0.5 font-mono text-[9.5px] uppercase tracking-widest text-site-muted-fg">{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <div className="col-span-12 space-y-3 lg:col-span-5">
            {[
              { step: "1", title: t("Escribe tu plantilla", "Write your template"), desc: t("Nombre, categoría y el texto del mensaje.", "Name, category and the message text.") },
              { step: "2", title: t("Meta la revisa", "Meta reviews it"), desc: t("Aprobación automática, normalmente en minutos u horas.", "Automatic approval, usually in minutes or hours.") },
              { step: "3", title: t("Envía la campaña", "Send the campaign"), desc: t("Pega tu lista de números y listo — se manda a todos.", "Paste your list of numbers and done — it goes out to everyone.") },
            ].map((s) => (
              <div key={s.step} className="flex items-start gap-3 rounded-xl border border-site-border bg-site-card p-4">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-site-primary/10 font-mono text-[11px] font-semibold text-site-primary ring-1 ring-site-primary/25">
                  {s.step}
                </span>
                <div>
                  <div className="font-display text-[13.5px] font-medium text-site-fg">{s.title}</div>
                  <div className="mt-0.5 text-[12.5px] leading-relaxed text-site-muted-fg">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   3. WhatsApp Intelligence (se mantiene, copy honesto)
========================================================= */

export function WhatsAppSection() {
  const { t } = useI18n();
  const INFRA_ITEMS = [
    { icon: ShieldCheck, title: t("API Oficial de WhatsApp Business", "Official WhatsApp Business API"), desc: t("Construido directamente sobre la Cloud API de Meta — sin atajos no oficiales, sin riesgo de bloqueo.", "Built directly on Meta's Cloud API — no unofficial shortcuts, no ban risk.") },
    { icon: UserPlus, title: "Embedded Signup", desc: t("Conecta un número nuevo en minutos con el flujo nativo de Meta.", "Connect a new number in minutes with Meta's native flow.") },
    { icon: Layers, title: t("Múltiples números", "Multiple numbers"), desc: t("Administra cada línea conectada desde un solo panel.", "Manage every connected line from a single dashboard.") },
    { icon: FileCheck2, title: t("Gestión de plantillas", "Template management"), desc: t("Crea, envía a revisión y sigue el estado real de aprobación de tus plantillas.", "Create, submit for review and track the real approval status of your templates.") },
    { icon: Radio, title: t("Campañas masivas", "Bulk campaigns"), desc: t("Llega a toda tu lista de contactos con plantillas aprobadas por Meta.", "Reach your entire contact list with Meta-approved templates.") },
    { icon: BadgeCheck, title: t("Verificación de Meta", "Meta verification"), desc: t("Consulta la calidad real de tu número y desbloquea límites de mensajería más altos.", "Check your number's real quality and unlock higher messaging limits.") },
    { icon: Users, title: t("Traspaso a un humano", "Human handoff"), desc: t("Toma cualquier conversación desde tu celular cuando quieras, sin perder el hilo.", "Take over any conversation from your phone whenever you want, without losing context.") },
  ];
  return (
    <section id="infraestructura" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1280px] px-6">
        <div className="grid grid-cols-12 gap-8 lg:gap-12">
          <div className="col-span-12 lg:col-span-5 lg:pt-6">
            <SectionHeading
              labelStyle="none"
              title={<>{t("Automatización real,", "Real automation,")} <br className="hidden md:block" />{t("sobre la infraestructura de Meta.", "on Meta's infrastructure.")}</>}
              desc={t(
                "Conectas tu número mediante el flujo oficial de Meta (Embedded Signup). Nada de extensiones de navegador ni trucos que arriesguen tu cuenta.",
                "You connect your number through Meta's official flow (Embedded Signup). No browser extensions or hacks that put your account at risk."
              )}
            />
            <ul className="mt-8 space-y-3 text-[13.5px]">
              {[
                t("Conexión oficial vía Embedded Signup de Meta", "Official connection via Meta's Embedded Signup"),
                t("Plantillas y mensajes interactivos nativos", "Native templates and interactive messages"),
                t("Modo coexistencia: tú y la IA, en paralelo", "Coexistence mode: you and the AI, in parallel"),
                t("IA entrenada con tus precios y horarios", "AI trained on your prices and hours"),
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-site-fg/90">
                  <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-site-primary" />
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Link href="/precios" className="inline-flex items-center gap-1 text-[13.5px] font-medium text-site-fg hover:text-site-primary">
                {t("Ver planes y precios", "See plans and pricing")} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-7">
            <div className="relative">
              <Panel className="p-4 md:p-6">
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-12 md:col-span-6">
                    <PhoneMock
                      header={
                        <div className="flex items-center gap-2 border-b border-white/5 bg-site-card px-3 py-2.5 text-[11px] text-site-fg">
                          <div className="grid h-6 w-6 place-items-center rounded-full bg-site-primary/15 ring-1 ring-site-primary/25">
                            <Bot className="h-3 w-3 text-site-primary" />
                          </div>
                          <div>
                            <div className="font-medium leading-none">Du IA Business</div>
                            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-site-primary">{t("En línea", "Online")}</div>
                          </div>
                        </div>
                      }
                    >
                      <MsgIn>{t("Hola, ¿cuánto cuesta el servicio básico?", "Hi, how much is the basic service?")}</MsgIn>
                      <MsgOut>
                        {t("¡Hola! El servicio básico cuesta $45.000. ¿Quieres agendar una cita?", "Hi! The basic service is $45,000. Would you like to book an appointment?")}
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          <button className="rounded-md bg-site-primary/15 py-1 text-[10px] font-medium text-site-primary ring-1 ring-site-primary/25">{t("Agendar", "Book")}</button>
                          <button className="rounded-md bg-white/5 py-1 text-[10px] text-site-fg ring-1 ring-white/10">{t("Ver más", "See more")}</button>
                        </div>
                      </MsgOut>
                      <div className="text-center font-mono text-[9px] uppercase tracking-widest text-site-muted-fg">{t("escribiendo…", "typing…")}</div>
                    </PhoneMock>
                  </div>

                  <div className="col-span-12 space-y-3 md:col-span-6">
                    <div className="site-panel p-3">
                      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">{t("Cómo funciona", "How it works")}</div>
                      <div className="space-y-1.5 font-mono text-[10.5px]">
                        <TraceLine k="webhook.recibido" v="Meta Cloud API" ok />
                        <TraceLine k="ia.responde" v={t("con tu prompt entrenado", "with your trained prompt")} ok />
                        <TraceLine k="wa.enviado" v={t("entregado", "delivered")} ok />
                      </div>
                    </div>
                    <div className="site-panel p-3">
                      <div className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">{t("Modelo de IA", "AI model")}</div>
                      <div className="mt-1 font-display text-[15px] font-medium text-site-fg">Claude (Anthropic)</div>
                      <div className="mt-1 text-[11px] text-site-muted-fg">{t("Entrenado con el prompt de tu negocio: precios, horarios y tono.", "Trained with your business prompt: prices, hours and tone.")}</div>
                    </div>
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        </div>

        <div className="mt-16">
          <div className="flex items-center gap-2">
            <BadgeCheck className="h-3.5 w-3.5 text-site-primary" />
            <span className="font-mono text-[11px] uppercase tracking-widest text-site-muted-fg">
              {t("Por qué es confiable", "Why it's reliable")}
            </span>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-site-border bg-white/5 sm:grid-cols-2 lg:grid-cols-4">
            {INFRA_ITEMS.map((item, i) => (
              <Reveal key={item.title} delay={(i % 4) * 60} className="h-full">
                <div className="group h-full bg-site-bg p-5 transition-colors hover:bg-site-card">
                  <h3 className="font-display text-[14px] font-medium tracking-tight text-site-fg">{item.title}</h3>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-site-muted-fg">{item.desc}</p>
                </div>
              </Reveal>
            ))}
            <div className="flex flex-col justify-center bg-site-primary/5 p-5">
              <p className="text-[12px] leading-relaxed text-site-muted-fg">
                {t(
                  "Corre sobre la red global de mensajería de Meta — la misma infraestructura que usan las marcas más grandes del mundo.",
                  "Runs on Meta's global messaging network — the same infrastructure used by the world's biggest brands."
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
function TraceLine({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={ok ? "text-site-primary" : "text-site-muted-fg"}>{ok ? "▲" : "…"}</span>
      <span className="text-site-fg/90">{k}</span>
      <span className="text-site-muted-fg">·</span>
      <span className="text-site-fg">{v}</span>
    </div>
  );
}

/* =========================================================
   4. Entrena tu IA (reemplaza "Analytics")
========================================================= */

export function TrainingSection() {
  const { t } = useI18n();
  const AGENT_FEATURES = [
    {
      icon: Bot,
      title: t("Nombre propio", "Its own name"),
      desc: t(
        "Cada número tiene un solo agente, con el nombre que tú le pongas — no un rol genérico ni una plantilla.",
        "Each number has a single agent, with the name you give it — not a generic role or a template."
      ),
    },
    {
      icon: Sparkles,
      title: t("Instrucciones personalizadas", "Custom instructions"),
      desc: t(
        "Un cuadro de texto simple, sin código. Le escribes tus precios, horarios y tono, y responde así desde el próximo mensaje.",
        "A simple text box, no code. You write your prices, hours and tone, and it replies that way from the next message on."
      ),
    },
    {
      icon: FileUp,
      title: t("Base de conocimiento", "Knowledge base"),
      desc: t(
        "Sube tu listado de precios (Excel o CSV) o un documento (PDF) y el agente lo usa como referencia real al responder.",
        "Upload your price list (Excel or CSV) or a document (PDF) and the agent uses it as a real reference when replying."
      ),
    },
    {
      icon: Play,
      title: t("Playground de prueba", "Test playground"),
      desc: t(
        "Chatea con tu agente en un entorno de prueba, con sus instrucciones y conocimiento reales, antes de que hable con un cliente.",
        "Chat with your agent in a test environment, with its real instructions and knowledge, before it talks to a customer."
      ),
    },
  ];
  return (
    <section id="entrenamiento" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow={t("Tu agente de IA", "Your AI agent")}
          labelStyle="kicker"
          size="md"
          title={<>{t("Un agente por número,", "One agent per number,")} <br className="hidden md:block" />{t("a tu manera — no un rol genérico.", "your way — not a generic role.")}</>}
          desc={t(
            "Nada de roles preconfigurados de ventas o soporte. Cada número tiene un solo agente, con el nombre, las instrucciones y el conocimiento que tú le des.",
            "No preset sales or support roles. Each number has a single agent, with the name, instructions and knowledge you give it."
          )}
        />

        <div className="mt-12 grid grid-cols-12 gap-4">
          <Reveal variant="left" className="col-span-12 lg:col-span-5">
            <Panel className="p-6">
              <div className="flex items-center justify-between border-b border-site-border pb-3">
                <span className="font-display text-[13px] font-medium text-site-fg">{t("Entrenar a Ava", "Train Ava")}</span>
                <span className="font-mono text-[9.5px] uppercase tracking-widest text-site-primary">{t("Guardado", "Saved")}</span>
              </div>
              <div className="mt-4 rounded-lg border border-site-border bg-site-card p-4 text-[13px] leading-relaxed text-site-fg/80">
                {t(
                  'Eres el asistente de WhatsApp de "Peluquería Estilo". Responde de forma breve y amable. Cortes desde $25.000, tinte desde $60.000. Atendemos de martes a sábado, 9am a 6pm.',
                  'You are the WhatsApp assistant for "Estilo Hair Salon". Reply briefly and kindly. Haircuts from $25,000, coloring from $60,000. Open Tuesday to Saturday, 9am to 6pm.'
                )}
              </div>
              <div className="mt-4 flex items-center justify-between text-[11px] text-site-muted-fg">
                <span>312 / 4000</span>
                <span className="inline-flex items-center gap-1.5 text-site-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {t("Ava ya responde con esto", "Ava already replies with this")}
                </span>
              </div>
            </Panel>
          </Reveal>

          <div className="col-span-12 grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2 lg:col-span-7">
            {AGENT_FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 80}>
                <div className="h-full">
                  <div className="font-display text-[14px] font-medium text-site-fg">{f.title}</div>
                  <div className="mt-1.5 text-[12.5px] leading-relaxed text-site-muted-fg">{f.desc}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   4b. Base de conocimiento
========================================================= */

export function KnowledgeSection() {
  const { t } = useI18n();
  const knowledgeItems = [
    { icon: FileText, title: t("Excel, CSV o PDF", "Excel, CSV or PDF"), desc: t("Listados de precios, catálogos o políticas — los formatos que ya usas.", "Price lists, catalogs or policies — the formats you already use.") },
    { icon: Gauge, title: t("Un archivo por número", "One file per number"), desc: t("Cada agente tiene su propia base de conocimiento, independiente de los demás.", "Each agent has its own knowledge base, independent from the rest.") },
    { icon: Lock, title: t("Solo lo que tú subiste", "Only what you uploaded"), desc: t("El agente responde con tus instrucciones y tu archivo, nada más.", "The agent replies with your instructions and your file, nothing else.") },
  ];

  return (
    <section id="conocimiento" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow={t("Base de conocimiento", "Knowledge base")}
          labelStyle="kicker"
          size="md"
          title={<>{t("Sube un archivo.", "Upload a file.")} <br className="hidden md:block" />{t("El agente lo usa como referencia real.", "The agent uses it as a real reference.")}</>}
          desc={t(
            "Un listado de precios en Excel o CSV, o un documento en PDF. Sin bases de datos complicadas — un archivo por número, listo para responder con eso.",
            "A price list in Excel or CSV, or a PDF document. No complicated databases — one file per number, ready to answer with it."
          )}
        />

        <div className="mt-12 grid grid-cols-12 gap-4">
          <Reveal variant="left" className="col-span-12 lg:col-span-7">
            <Panel className="h-full p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileUp className="h-4 w-4 text-site-primary" />
                  <span className="font-display text-[13px] font-medium text-site-fg">{t("Base de conocimiento", "Knowledge base")}</span>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-site-border bg-site-card px-3 py-1.5 text-[11px] text-site-muted-fg">
                  {t("Reemplazar archivo", "Replace file")}
                </span>
              </div>
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-site-border bg-site-card px-3 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-site-card">
                  <FileText className="h-4 w-4 text-site-muted-fg" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-site-fg">precios-peluqueria.xlsx</div>
                  <div className="text-[11px] text-site-muted-fg">{t("4.820 caracteres", "4,820 characters")}</div>
                </div>
                <CheckCircle2 className="h-4 w-4 shrink-0 text-site-primary" />
              </div>
              <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
                {t(
                  "El agente combina esto con sus instrucciones de tono y horarios para responder con tus datos reales — nunca inventa precios que no le diste.",
                  "The agent combines this with its tone and hours instructions to reply with your real data — it never makes up prices you didn't give it."
                )}
              </p>
            </Panel>
          </Reveal>

          <div className="col-span-12 divide-y divide-site-border lg:col-span-5">
            {knowledgeItems.map((f, i) => (
              <Reveal key={f.title} delay={i * 80}>
                <div className={i === 0 ? "pb-4" : "py-4"}>
                  <div className="font-display text-[13.5px] font-medium text-site-fg">{f.title}</div>
                  <div className="mt-1 text-[12.5px] leading-relaxed text-site-muted-fg">{f.desc}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   5. Mensajes centralizados (reemplaza "Integrations")
   — nota: ahora se muestra como pestaña "Mensajes" dentro de
   PlatformOverviewSection, ver más abajo.
========================================================= */

/* =========================================================
   5b. Una plataforma completa (8 módulos reales)
========================================================= */

export function PlatformOverviewSection() {
  const { t } = useI18n();
  const chats = [
    { name: t("Peluquería Estilo", "Estilo Hair Salon"), last: t("Listo, te espero a las 5:30", "Done, see you at 5:30"), active: true },
    { name: "+57 300 123 4567", last: t("¿Cuánto cuesta el servicio básico?", "How much is the basic service?"), active: false },
    { name: "+57 310 555 8899", last: t("Perfecto, muchas gracias", "Perfect, thank you very much"), active: true },
  ];
  const inboxVisual = (
    <div className="overflow-hidden rounded-xl border border-site-border bg-site-card">
      <div className="divide-y divide-site-border">
        {chats.map((c) => (
          <div key={c.name} className="flex items-center justify-between px-4 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-site-fg">{c.name}</div>
              <div className="mt-0.5 truncate text-[11px] text-site-muted-fg">{c.last}</div>
            </div>
            <span
              className={`ml-3 shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-widest ring-1 ${
                c.active
                  ? "bg-site-primary/10 text-site-primary ring-site-primary/25"
                  : "bg-white/5 text-site-muted-fg ring-white/10"
              }`}
            >
              {c.active ? t("IA activa", "AI active") : t("Pausado", "Paused")}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t border-site-border p-3">
        <div className="font-mono text-[9.5px] uppercase tracking-widest text-site-muted-fg">{t("Peluquería Estilo", "Estilo Hair Salon")}</div>
        <div className="mt-2 space-y-1.5">
          <MsgIn>{t("Hola, ¿tienen turno para hoy?", "Hi, do you have an opening today?")}</MsgIn>
          <MsgOut>{t("¡Hola! Sí, tengo espacio a las 4pm y 5:30pm. ¿Cuál prefieres?", "Hi! Yes, I have 4pm and 5:30pm available. Which do you prefer?")}</MsgOut>
          <MsgIn>{t("A las 5:30", "At 5:30")}</MsgIn>
          <MsgOut>{t("Listo, te espero a las 5:30. ¡Nos vemos!", "Done, see you at 5:30!")}</MsgOut>
        </div>
      </div>
    </div>
  );
  const PLATFORM_MODULES: {
    key: string;
    icon: typeof LayoutGrid;
    label: string;
    headline: string;
    points: string[];
    visual?: React.ReactNode;
  }[] = [
    {
      key: "resumen",
      icon: LayoutGrid,
      label: t("Resumen", "Overview"),
      headline: t("Cada número, agente y conversación en una sola vista.", "Every number, agent and conversation in one view."),
      points: [t("Automatización real por número", "Real automation per number"), t("Consumo del plan en vivo", "Live plan usage"), t("Actividad reciente", "Recent activity")],
    },
    {
      key: "mensajes",
      icon: Inbox,
      label: t("Mensajes", "Messages"),
      headline: t("Revisa cada chat y responde donde haga falta.", "Check every chat and reply wherever needed."),
      points: [
        t("Estado de IA activa o pausada, por chat", "AI active/paused status, per chat"),
        t("Historial completo siempre a mano", "Full history always at hand"),
        t("Todos tus números en una sola bandeja", "All your numbers in a single inbox"),
      ],
      visual: inboxVisual,
    },
    {
      key: "agentes",
      icon: Bot,
      label: t("Agentes de IA", "AI agents"),
      headline: t("Configura tu agente en minutos, sin código.", "Set up your agent in minutes, no code."),
      points: [t("Un agente por número, con nombre propio", "One agent per number, with its own name"), t("Instrucciones y base de conocimiento", "Instructions and knowledge base"), t("Pausa manual o por coexistencia", "Manual or coexistence pause")],
    },
    {
      key: "plantillas",
      icon: FileText,
      label: t("Plantillas", "Templates"),
      headline: t("Crea y sigue tus plantillas hasta la aprobación.", "Create and track your templates through approval."),
      points: [t("Estado real de aprobación de Meta", "Real Meta approval status"), t("Variables detectadas automáticamente", "Variables detected automatically"), t("Borradores locales antes de publicar", "Local drafts before publishing")],
    },
    {
      key: "campanas",
      icon: Megaphone,
      label: t("Campañas", "Campaigns"),
      headline: t("Lanza campañas masivas con confianza.", "Launch bulk campaigns with confidence."),
      points: [t("Entrega y lectura en tiempo real", "Real-time delivery and read status"), t("Embudo de conversión por campaña", "Conversion funnel per campaign"), t("Solo plantillas aprobadas por Meta", "Only Meta-approved templates")],
    },
    {
      key: "numeros",
      icon: Phone,
      label: t("Números", "Numbers"),
      headline: t("Administra cada línea desde un solo lugar.", "Manage every line from a single place."),
      points: [t("Conexión con Embedded Signup", "Connection via Embedded Signup"), t("Calidad y límite reales de Meta", "Real Meta quality and limits"), t("Cupo diario en vivo", "Live daily quota")],
    },
    {
      key: "analytics",
      icon: BarChart3,
      label: "Analytics",
      headline: t("Mide el desempeño real de toda tu operación.", "Measure the real performance of your whole operation."),
      points: [t("Embudo de entrega real", "Real delivery funnel"), t("Mapa de actividad por hora", "Activity heatmap by hour"), t("Desempeño real por plantilla", "Real performance per template")],
    },
    {
      key: "cuenta",
      icon: CreditCard,
      label: t("Cuenta", "Account"),
      headline: t("Tu plan y consumo, siempre visibles.", "Your plan and usage, always visible."),
      points: [t("Plan mensual fijo", "Fixed monthly plan"), t("Consumo real de conversaciones", "Real conversation usage"), t("Pagos y renovación con Wompi", "Payments and renewal with Wompi")],
    },
  ];
  const [active, setActive] = useState(0);
  const current = PLATFORM_MODULES[active];

  return (
    <section id="plataforma-completa" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow={t("Una plataforma", "One platform")}
          title={<>{t("Una plataforma.", "One platform.")} <br className="hidden md:block" />{t("Cada conversación, en un solo lugar.", "Every conversation, in one place.")}</>}
          desc={t(
            "Entiende todo el producto en menos de diez segundos. Ocho módulos, un solo panel de control.",
            "Understand the whole product in under ten seconds. Eight modules, one control panel."
          )}
        />

        <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
          <div
            className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible"
            role="tablist"
            aria-label={t("Módulos de la plataforma", "Platform modules")}
          >
            {PLATFORM_MODULES.map((m, i) => (
              <button
                key={m.key}
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={`flex shrink-0 items-center gap-2.5 rounded-xl border px-4 py-3 text-[13px] transition-colors lg:w-full ${
                  i === active
                    ? "border-site-primary/30 bg-site-primary/10 text-site-fg"
                    : "border-site-border bg-site-card text-site-muted-fg hover:text-site-fg"
                }`}
              >
                <m.icon className={`h-4 w-4 ${i === active ? "text-site-primary" : ""}`} />
                {m.label}
              </button>
            ))}
          </div>

          <Panel className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-site-border bg-site-card px-5 py-3">
              <current.icon className="h-4 w-4 text-site-primary" />
              <span className="font-display text-[13px] font-medium text-site-fg">{current.label}</span>
            </div>
            <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2 md:items-center">
              <div>
                <h3 className="font-display text-[22px] font-medium leading-tight tracking-tight text-site-fg">
                  {current.headline}
                </h3>
                <ul className="mt-5 flex flex-col gap-2.5">
                  {current.points.map((p) => (
                    <li key={p} className="flex items-center gap-2.5 text-[13px] text-site-muted-fg">
                      <span className="h-1.5 w-1.5 rounded-full bg-site-primary" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              {current.visual ?? (
                <div className="rounded-xl border border-site-border bg-site-card p-4">
                  <div className="flex items-center justify-between border-b border-site-border pb-3">
                    <span className="font-mono text-[10.5px] uppercase tracking-widest text-site-muted-fg">
                      {current.label}
                    </span>
                    <span className="h-2 w-2 rounded-full bg-site-primary animate-site-pulse-glow" />
                  </div>
                  <div className="mt-3 flex flex-col gap-2.5">
                    {[0, 1, 2, 3].map((row) => (
                      <div key={row} className="flex items-center gap-2.5">
                        <span className="size-6 shrink-0 rounded-md bg-site-card" />
                        <span className="h-2 rounded-full bg-site-card" style={{ width: `${70 - row * 12}%` }} />
                        <span className="ml-auto h-2 w-8 rounded-full bg-site-primary/30" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   5c. Por qué Du Labs — Escala, LatAm y Ecosistema, en pestañas
   (fusión de las antiguas ScaleSection + LatamSection + EcosystemSection)
========================================================= */

export function GrowthSection() {
  const { t } = useI18n();
  const SCALE_ITEMS = [
    { icon: Phone, title: t("Varios números", "Multiple numbers"), desc: t("Conecta las líneas que necesites y adminístralas desde un solo panel.", "Connect as many lines as you need and manage them from a single dashboard.") },
    { icon: Bot, title: t("Un agente por número", "One agent per number"), desc: t("Cada línea tiene su propio asistente, con nombre e instrucciones independientes.", "Each line has its own assistant, with independent name and instructions.") },
    { icon: Megaphone, title: t("Plantillas y campañas sin límite", "Unlimited templates & campaigns"), desc: t("Crea las plantillas y campañas que necesites, según el consumo de tu plan.", "Create as many templates and campaigns as you need, based on your plan usage.") },
    { icon: Gauge, title: t("Consumo siempre visible", "Usage always visible"), desc: t("Ve en tiempo real cuántas conversaciones has usado y cuántas te quedan.", "See in real time how many conversations you've used and how many are left.") },
  ];
  const LATAM_ITEMS = [
    { icon: ShieldCheck, title: t("APIs oficiales de Meta", "Official Meta APIs"), desc: t("Cumplimiento total con la plataforma de negocios de Meta en cualquier mercado.", "Full compliance with Meta's business platform in any market.") },
    { icon: Languages, title: t("Pensado en español", "Built in Spanish"), desc: t("Un producto, agentes y soporte diseñados en español desde el primer día.", "A product, agents and support designed in Spanish from day one.") },
    { icon: Store, title: t("Negocios locales", "Local businesses"), desc: t("Construido para cómo se hace comercio de verdad: dentro de conversaciones de WhatsApp.", "Built for how commerce really happens: inside WhatsApp conversations.") },
    { icon: ServerCog, title: t("Confiabilidad real", "Real reliability"), desc: t("Infraestructura que funciona igual, desde tu primer número hasta cuando crezcas.", "Infrastructure that works the same, from your first number to when you scale.") },
  ];
  const ECOSYSTEM_PILLARS = [
    {
      icon: Briefcase,
      name: "Du IA Business",
      desc: t(
        "La capa de plataforma — agentes de IA e infraestructura conversacional que corren tu operación en WhatsApp.",
        "The platform layer — AI agents and conversational infrastructure that run your operation on WhatsApp."
      ),
    },
    {
      icon: GraduationCap,
      name: "Du Academy",
      desc: t(
        "Aprende a diseñar y escalar IA conversacional, con formación pensada para equipos y operadores.",
        "Learn to design and scale conversational AI, with training built for teams and operators."
      ),
    },
    {
      icon: HeartPulse,
      name: "Du Life",
      desc: t(
        "Tecnología conversacional aplicada al día a día — llevando IA a los canales que la gente ya usa.",
        "Conversational technology for everyday life — bringing AI to the channels people already use."
      ),
    },
  ];

  const TABS = [
    {
      key: "escala",
      icon: InfinityIcon,
      label: t("Escala", "Scale"),
      headline: t("Desde tu primer número hasta toda tu operación.", "From your first number to your entire operation."),
      desc: t(
        "Du Labs crece contigo. Ya sea que manejes una línea o varias, el panel se mantiene igual de simple.",
        "Du Labs grows with you. Whether you run one line or many, the dashboard stays just as simple."
      ),
    },
    {
      key: "latam",
      icon: Languages,
      label: "LatAm",
      headline: t("Infraestructura pensada para cómo la región hace negocios.", "Infrastructure designed for how the region does business."),
      desc: t(
        "El comercio conversacional ya es el estándar en Latinoamérica. Du Labs está construido para eso, de forma nativa.",
        "Conversational commerce is already the standard in Latin America. Du Labs is built for it, natively."
      ),
    },
    {
      key: "ecosistema",
      icon: Briefcase,
      label: t("Ecosistema", "Ecosystem"),
      headline: t("IA donde ya vive la conversación.", "AI where the conversation already lives."),
      desc: t(
        "Du Labs cree en una idea: el futuro del software es conversacional. Nuestro ecosistema lleva esa idea a los negocios, la formación y el día a día.",
        "Du Labs believes in one idea: the future of software is conversational. Our ecosystem brings that idea to business, education and everyday life."
      ),
    },
  ];
  const [active, setActive] = useState(0);
  const current = TABS[active];

  return (
    <section id="escala" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          labelStyle="none"
          size="md"
          title={<>{t("Diseñado para crecer,", "Built to grow,")} <br className="hidden md:block" />{t("pensado para Latinoamérica.", "made for Latin America.")}</>}
          desc={t(
            "Escala, mercado y ecosistema — todo lo que respalda a Du Labs, en un solo lugar.",
            "Scale, market and ecosystem — everything behind Du Labs, in one place."
          )}
        />

        <div
          className="mt-10 flex gap-2 overflow-x-auto"
          role="tablist"
          aria-label={t("Por qué Du Labs", "Why Du Labs")}
        >
          {TABS.map((tab, i) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`flex shrink-0 items-center gap-2.5 rounded-xl border px-4 py-3 text-[13px] transition-colors ${
                i === active
                  ? "border-site-primary/30 bg-site-primary/10 text-site-fg"
                  : "border-site-border bg-site-card text-site-muted-fg hover:text-site-fg"
              }`}
            >
              <tab.icon className={`h-4 w-4 ${i === active ? "text-site-primary" : ""}`} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-6">
          <h3 className="font-display text-[22px] font-medium leading-tight tracking-tight text-site-fg">
            {current.headline}
          </h3>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-site-muted-fg">{current.desc}</p>
        </div>

        {active === 0 && (
          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-center">
            <Reveal variant="zoom">
              <div className="relative flex items-center justify-center rounded-2xl border border-site-border bg-site-card p-8">
                <div className="pointer-events-none absolute inset-0 rounded-2xl site-grid-bg opacity-40" />
                <div className="relative flex flex-col items-center text-center">
                  <span className="flex size-16 items-center justify-center rounded-2xl border border-site-primary/30 bg-site-primary/10">
                    <InfinityIcon className="h-8 w-8 text-site-primary" />
                  </span>
                  <div className="mt-4 font-display text-[26px] font-medium tracking-tight text-site-fg">
                    {t("Crece con tu negocio", "Grows with your business")}
                  </div>
                  <p className="mt-1 text-[13px] text-site-muted-fg">{t("Sin cambiar de plataforma cuando sumas números.", "No switching platforms when you add numbers.")}</p>
                </div>
              </div>
            </Reveal>
            <div className="grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2">
              {SCALE_ITEMS.map((item, i) => (
                <Reveal key={item.title} delay={i * 70}>
                  <div className="h-full">
                    <h4 className="font-display text-[14px] font-medium tracking-tight text-site-fg">{item.title}</h4>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-site-muted-fg">{item.desc}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        )}

        {active === 1 && (
          <div className="mt-8 grid grid-cols-1 divide-y divide-site-border sm:grid-cols-2 sm:divide-y-0 sm:gap-x-6 lg:grid-cols-4">
            {LATAM_ITEMS.map((item, i) => (
              <Reveal key={item.title} delay={i * 70}>
                <div className="py-4 text-center sm:py-0">
                  <h4 className="font-display text-[15px] font-medium tracking-tight text-site-fg">{item.title}</h4>
                  <p className="mt-2 text-[13px] leading-relaxed text-site-muted-fg">{item.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        )}

        {active === 2 && (
          <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-3">
            {ECOSYSTEM_PILLARS.map((p, i) => (
              <Reveal key={p.name} delay={i * 80}>
                <div className="group h-full border-t border-site-border pt-4 transition-colors hover:border-site-primary/40">
                  <div className="flex items-center justify-between">
                    <h4 className="font-display text-[16px] font-medium tracking-tight text-site-fg">{p.name}</h4>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-site-muted-fg transition-colors group-hover:text-site-primary" />
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-site-muted-fg">{p.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* =========================================================
   6. Métricas (afirmaciones honestas, no cifras inventadas)
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
      </div>
    </section>
  );
}

/* =========================================================
   7. Precios (planes reales de Du Labs)
========================================================= */

export function PricingSection() {
  const { t } = useI18n();
  const tiers = [
    {
      name: "Plan Básico",
      price: "$59.990",
      tag: t("Emprendedores y pequeños negocios locales.", "Entrepreneurs and small local businesses."),
      features: [t("1 número de WhatsApp", "1 WhatsApp number"), t("IA en Modo Coexistencia", "AI in Coexistence Mode"), t("Hasta 1.000 mensajes / mes", "Up to 1,000 messages / month"), t("Soporte estándar por correo", "Standard email support")],
    },
    {
      name: "Plan Pro",
      price: "$129.990",
      tag: t("Negocios en crecimiento y marcas comerciales.", "Growing businesses and commercial brands."),
      features: [t("Todo lo del Plan Básico", "Everything in Plan Básico"), t("Plantillas y campañas masivas", "Templates and bulk campaigns"), t("Hasta 5.000 mensajes / mes", "Up to 5,000 messages / month"), t("Soporte prioritario por WhatsApp", "Priority support via WhatsApp")],
      featured: true,
    },
    {
      name: "Plan Enterprise",
      price: "$299.990",
      tag: t("Empresas con operaciones de alta demanda.", "Companies with high-demand operations."),
      features: [t("Todo lo del Plan Pro", "Everything in Plan Pro"), t("Mensajes ilimitados*", "Unlimited messages*"), t("Múltiples números en paralelo", "Multiple numbers in parallel"), t("Soporte dedicado 24/7", "Dedicated 24/7 support")],
    },
  ];
  return (
    <section id="precios" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow={t("Precios", "Pricing")}
          title={<>{t("Un plan para cada etapa de tu negocio.", "A plan for every stage of your business.")}</>}
          desc={t("Precios en pesos colombianos (COP), cobro recurrente mensual.", "Prices in Colombian pesos (COP), recurring monthly billing.")}
          align="center"
        />
        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.name}
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
              <div className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">{tier.name}</div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-display text-[36px] font-medium tracking-tight text-site-fg">{tier.price}</span>
                <span className="text-[12px] text-site-muted-fg">{t("COP / mes", "COP / mo")}</span>
              </div>
              <p className="mt-2 text-[13px] text-site-muted-fg">{tier.tag}</p>
              <PlanButton
                plan={tier.name}
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
      </div>
    </section>
  );
}

/* =========================================================
   8. FAQ (respuestas reales)
========================================================= */

export function FaqSection() {
  const { t } = useI18n();
  const faqs = [
    {
      q: t("¿Qué tan rápido puedo conectar mi WhatsApp?", "How fast can I connect my WhatsApp?"),
      a: t(
        "El flujo de conexión con Meta (Embedded Signup) toma unos minutos. En cuanto conectas tu número, ya puedes entrenar tu IA y empezar a recibir mensajes.",
        "Meta's connection flow (Embedded Signup) takes a few minutes. As soon as you connect your number, you can train your AI and start receiving messages."
      ),
    },
    {
      q: t("¿Usan la API oficial de WhatsApp?", "Do you use the official WhatsApp API?"),
      a: t(
        "Sí. Todo pasa por la API Oficial de WhatsApp Business (Meta Cloud API) — sin hacks no oficiales, sin riesgo de baneo.",
        "Yes. Everything goes through the Official WhatsApp Business API (Meta Cloud API) — no unofficial hacks, no ban risk."
      ),
    },
    {
      q: t("¿Qué modelo de IA usan?", "Which AI model do you use?"),
      a: t(
        "Usamos Claude, de Anthropic, entrenado con el prompt específico de tu negocio: precios, horarios y tono de atención.",
        "We use Claude, by Anthropic, trained with your business-specific prompt: prices, hours and tone of service."
      ),
    },
    {
      q: t("¿Pierdo el control de mi WhatsApp?", "Do I lose control of my WhatsApp?"),
      a: t(
        "No. Con Modo Coexistencia sigues usando tu WhatsApp Business normal desde el celular. La IA responde en paralelo y se pausa sola en cualquier chat donde tú respondas.",
        "No. With Coexistence Mode you keep using your regular WhatsApp Business from your phone. The AI replies in parallel and pauses itself in any chat where you reply."
      ),
    },
    {
      q: t("¿Puedo enviar mensajes masivos?", "Can I send bulk messages?"),
      a: t(
        "Sí, con plantillas aprobadas por Meta. Creas la plantilla, Meta la aprueba, y envías la campaña a tu lista de clientes desde tu panel.",
        "Yes, with Meta-approved templates. You create the template, Meta approves it, and you send the campaign to your customer list from your dashboard."
      ),
    },
    {
      q: t("¿Con qué se integra Du Labs hoy?", "What does Du Labs integrate with today?"),
      a: t(
        "Hoy nos enfocamos 100% en hacer WhatsApp Business excelente: conexión oficial, IA entrenada, plantillas y campañas, y bandeja de mensajes centralizada.",
        "Today we're 100% focused on making WhatsApp Business excellent: official connection, trained AI, templates and campaigns, and a centralized message inbox."
      ),
    },
  ];
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
      </div>
    </section>
  );
}

/* =========================================================
   9. CTA final
========================================================= */

export function FinalCta() {
  const { t } = useI18n();
  return (
    <section id="demo" className="relative overflow-hidden border-t border-site-border py-24">
      <div className="pointer-events-none absolute inset-0 site-ambient-bg animate-site-ambient opacity-90" />
      <div className="pointer-events-none absolute inset-0 site-grid-bg [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_70%)]" />

      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <SectionLabel>{t("Empecemos", "Let's start")}</SectionLabel>
        <h2 className="mt-5 font-display text-[38px] font-medium leading-[1.05] tracking-[-0.025em] site-text-gradient md:text-[56px]">
          {t("Conecta tu WhatsApp", "Connect your WhatsApp")} <br />
          <span className="site-text-gradient-primary">{t("y deja que la IA atienda hoy.", "and let the AI answer today.")}</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-site-muted-fg">
          {t(
            "Sin bloqueos, sin extensiones raras, listo para producción desde el primer día.",
            "No bans, no sketchy extensions, production-ready from day one."
          )}
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/business"
            className="group inline-flex h-11 items-center rounded-full bg-site-fg px-5 text-[13.5px] font-medium text-site-bg transition-all hover:bg-site-fg/90"
          >
            {t("Activar mi API Oficial", "Activate my Official API")} <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="https://wa.me/573148127388"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center rounded-full border border-site-border bg-site-card px-5 text-[13.5px] font-medium text-site-fg hover:border-white/20"
          >
            {t("Hablar por WhatsApp", "Chat on WhatsApp")}
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
        { l: t("Modo coexistencia", "Coexistence mode"), h: "/#coexistencia" },
        { l: t("Agentes de IA", "AI agents"), h: "/#entrenamiento" },
        { l: t("Base de conocimiento", "Knowledge base"), h: "/#conocimiento" },
        { l: t("Plantillas y campañas", "Templates & campaigns"), h: "/#campanas" },
        { l: t("Infraestructura", "Infrastructure"), h: "/#infraestructura" },
        { l: t("Precios", "Pricing"), h: "/precios" },
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

        <div className="mt-14 grid gap-10 border-t border-site-border pt-10 md:grid-cols-3">
          <div>
            <h3 className="text-[12.5px] font-semibold text-site-fg">{t("Información legal", "Legal information")}</h3>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
              <span className="text-site-muted-fg/70">{t("Titular del servicio:", "Service holder:")}</span>
              <br />
              RAMOS PADILLA DUVAN ANDRES
            </p>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
              <span className="text-site-muted-fg/70">{t("Nombre comercial:", "Trade name:")}</span>
              <br />
              DULABS
            </p>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
              <span className="text-site-muted-fg/70">{t("Dirección principal:", "Main address:")}</span>
              <br />
              BRR SANTA ELENA V CR 36 47 17
              <br />
              Montería, Córdoba 230001
              <br />
              Colombia
            </p>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
              <span className="text-site-muted-fg/70">{t("Teléfono:", "Phone:")}</span>
              <br />
              +573148127388
            </p>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
              <span className="text-site-muted-fg/70">{t("Correo electrónico:", "Email:")}</span>
              <br />
              contacto@dulabs.co
            </p>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
              <span className="text-site-muted-fg/70">{t("Sitio web:", "Website:")}</span>
              <br />
              https://www.dulabs.co
            </p>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg/80">
              {t(
                "Du Labs es una marca comercial y plataforma digital operada por RAMOS PADILLA DUVAN ANDRES.",
                "Du Labs is a trademark and digital platform operated by RAMOS PADILLA DUVAN ANDRES."
              )}
            </p>
          </div>
          <div>
            <h3 className="text-[12.5px] font-semibold text-site-fg">{t("Información del negocio", "Business information")}</h3>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
              <span className="text-site-muted-fg/70">{t("Nombre legal del negocio:", "Legal business name:")}</span>
              <br />
              Duván Andrés Ramos Padilla
            </p>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
              <span className="text-site-muted-fg/70">{t("Nombre comercial:", "Trade name:")}</span>
              <br />
              PORTABILIDADES
            </p>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
              <span className="text-site-muted-fg/70">{t("Dirección:", "Address:")}</span>
              <br />
              CR 36 47 17 BRR SANTA ELENA
              <br />
              Montería, Córdoba 230001
              <br />
              Colombia
            </p>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
              <span className="text-site-muted-fg/70">{t("Teléfono del negocio:", "Business phone:")}</span>
              <br />
              +573148127388
            </p>
          </div>
          <div className="md:justify-self-end">
            <h3 className="text-[12.5px] font-semibold text-site-fg">{t("Contacto", "Contact")}</h3>
            <ul className="mt-4 flex flex-col gap-2 text-[12.5px] text-site-muted-fg">
              <li>
                <a href="mailto:vandusfor@gmail.com" className="transition-colors duration-200 hover:text-site-fg">
                  vandusfor@gmail.com
                </a>
              </li>
              <li>
                <a href="tel:+573148127388" className="transition-colors duration-200 hover:text-site-fg">
                  +57 314 812 7388
                </a>
              </li>
              <li>
                <a href="https://dulabs.co" className="transition-colors duration-200 hover:text-site-fg">
                  dulabs.co
                </a>
              </li>
            </ul>
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
