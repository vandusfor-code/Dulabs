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
  ChevronDown,
  CreditCard,
  FileCheck2,
  FileText,
  FileUp,
  Gauge,
  Globe,
  GraduationCap,
  HeartPulse,
  Infinity as InfinityIcon,
  Languages,
  Layers,
  LayoutGrid,
  Megaphone,
  MessageCircle,
  Pause,
  Phone,
  Play,
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

/* =========================================================
   Shared primitives
========================================================= */

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-site-border bg-white/[0.02] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-site-muted-fg">
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
}: {
  eyebrow: string;
  title: React.ReactNode;
  desc?: string;
  align?: "left" | "center";
}) {
  const centered = align === "center";
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <SectionLabel>{eyebrow}</SectionLabel>
      <h2 className="mt-4 font-display text-[32px] font-medium leading-[1.05] tracking-[-0.025em] site-text-gradient md:text-[46px]">
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
    <div className={`relative overflow-hidden rounded-2xl border border-site-border bg-gradient-to-b from-white/[0.02] to-transparent ${className}`}>
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
    <div className="max-w-[85%] rounded-lg rounded-tl-sm bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-site-fg/90 ring-1 ring-white/6">
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
  return (
    <section id="coexistencia" className="relative border-t border-site-border py-28">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow="Modo coexistencia"
          title={<>La IA responde, tú sigues <br className="hidden md:block" />usando tu WhatsApp normal.</>}
          desc="No pierdes tu número ni tu app. Tu asistente atiende en paralelo desde la nube, y tú puedes tomar cualquier conversación desde tu celular cuando quieras."
        />

        <div className="mt-12 grid grid-cols-12 gap-4">
          <Panel className="col-span-12 p-6 lg:col-span-7">
            <div className="flex items-center gap-2">
              <Smartphone className="h-3.5 w-3.5 text-site-primary" />
              <span className="font-display text-[13px] font-medium text-site-fg">Tu celular + la IA, al mismo tiempo</span>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {[
                { icon: Bot, title: "La IA responde 24/7", desc: "Mientras no estás disponible, tu asistente sigue atendiendo con el prompt que tú le diste." },
                { icon: Pause, title: "Pausa por conversación", desc: "En cuanto tú respondes un chat desde tu celular, la IA se pausa sola solo en ese chat." },
                { icon: MessageCircle, title: "Historial compartido", desc: "Todo lo que la IA respondió lo ves también en tu WhatsApp normal, sin duplicados." },
                { icon: ShieldCheck, title: "Cero riesgo para tu número", desc: "Todo pasa por la API Oficial de Meta — no hay extensiones ni trucos que arriesguen tu cuenta." },
              ].map((f) => (
                <div key={f.title} className="rounded-xl border border-site-border bg-white/[0.02] p-4">
                  <f.icon className="h-4 w-4 text-site-primary" />
                  <div className="mt-2 font-display text-[13.5px] font-medium text-site-fg">{f.title}</div>
                  <div className="mt-1 text-[12.5px] leading-relaxed text-site-muted-fg">{f.desc}</div>
                </div>
              ))}
            </div>
          </Panel>

          <div className="col-span-12 lg:col-span-5">
            <PhoneMock
              header={
                <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.02] px-3 py-2.5 text-[11px] text-site-fg">
                  <div className="grid h-6 w-6 place-items-center rounded-full bg-site-primary/15 ring-1 ring-site-primary/25">
                    <Bot className="h-3 w-3 text-site-primary" />
                  </div>
                  <div>
                    <div className="font-medium leading-none">Peluquería Estilo</div>
                    <div className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-site-primary">IA activa</div>
                  </div>
                </div>
              }
            >
              <MsgIn>Hola, ¿tienen turno para hoy?</MsgIn>
              <MsgOut>¡Hola! Sí, tengo espacio a las 4pm y 5:30pm. ¿Cuál prefieres?</MsgOut>
              <MsgIn>A las 5:30</MsgIn>
              <div className="mx-auto my-1 w-fit rounded-full bg-white/[0.04] px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest text-site-muted-fg">
                Dueño respondió desde su celular
              </div>
              <MsgOut>Listo, te espero a las 5:30. ¡Nos vemos!</MsgOut>
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
  return (
    <section id="campanas" className="relative border-t border-site-border py-28">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow="Plantillas y campañas"
          title={<>Mensajes masivos autorizados, <br className="hidden md:block" />sin miedo a que te marquen como spam.</>}
          desc="Crea plantillas con Meta, espera la aprobación, y envía campañas a toda tu lista de clientes en segundos — todo desde tu panel."
        />

        <div className="mt-12 grid grid-cols-12 gap-4">
          <Panel className="col-span-12 lg:col-span-7">
            <div className="flex items-center justify-between border-b border-site-border bg-white/[0.02] px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Megaphone className="h-3.5 w-3.5 text-site-primary" />
                <span className="font-display text-[13px] font-medium text-site-fg">promo_julio</span>
                <span className="rounded-full bg-site-primary/10 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-widest text-site-primary ring-1 ring-site-primary/20">
                  Aprobada
                </span>
              </div>
              <button className="inline-flex items-center gap-1 rounded-md bg-site-primary px-2 py-1 text-[11px] font-medium text-site-primary-fg">
                <Send className="h-3 w-3" /> Enviar
              </button>
            </div>
            <div className="p-5">
              <div className="rounded-lg border border-site-border bg-white/[0.02] p-4 text-[13px] leading-relaxed text-site-fg/90">
                Hola 👋, tenemos una promoción especial esta semana en nuestros servicios. Escríbenos para reservar tu cita.
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                {[
                  { l: "Destinatarios", v: "312" },
                  { l: "Enviados", v: "312" },
                  { l: "Fallidos", v: "0" },
                ].map((s) => (
                  <div key={s.l} className="rounded-lg border border-site-border bg-white/[0.02] p-3">
                    <div className="font-display text-[20px] font-medium text-site-fg">{s.v}</div>
                    <div className="mt-0.5 font-mono text-[9.5px] uppercase tracking-widest text-site-muted-fg">{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <div className="col-span-12 space-y-3 lg:col-span-5">
            {[
              { step: "1", title: "Escribe tu plantilla", desc: "Nombre, categoría y el texto del mensaje." },
              { step: "2", title: "Meta la revisa", desc: "Aprobación automática, normalmente en minutos u horas." },
              { step: "3", title: "Envía la campaña", desc: "Pega tu lista de números y listo — se manda a todos." },
            ].map((s) => (
              <div key={s.step} className="flex items-start gap-3 rounded-xl border border-site-border bg-white/[0.02] p-4">
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
  return (
    <section id="whatsapp" className="relative border-t border-site-border py-28">
      <div className="mx-auto max-w-[1280px] px-6">
        <div className="grid grid-cols-12 gap-8 lg:gap-12">
          <div className="col-span-12 lg:col-span-5 lg:pt-6">
            <SectionHeading
              eyebrow="WhatsApp · API Oficial"
              title={<>Automatización real, <br className="hidden md:block" />sobre la infraestructura de Meta.</>}
              desc="Conectas tu número mediante el flujo oficial de Meta (Embedded Signup). Nada de extensiones de navegador ni trucos que arriesguen tu cuenta."
            />
            <ul className="mt-8 space-y-3 text-[13.5px]">
              {[
                "Conexión oficial vía Embedded Signup de Meta",
                "Plantillas y mensajes interactivos nativos",
                "Modo coexistencia: tú y la IA, en paralelo",
                "IA entrenada con tus precios y horarios",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-site-fg/90">
                  <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-site-primary" />
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Link href="/business" className="inline-flex items-center gap-1 text-[13.5px] font-medium text-site-fg hover:text-site-primary">
                Ver planes y precios <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-7">
            <div className="relative">
              <div className="absolute -inset-10 -z-10 opacity-70">
                <div className="absolute inset-0 rounded-full bg-site-primary/15 blur-[100px]" />
              </div>
              <Panel className="p-4 md:p-6">
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-12 md:col-span-6">
                    <PhoneMock
                      header={
                        <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.02] px-3 py-2.5 text-[11px] text-site-fg">
                          <div className="grid h-6 w-6 place-items-center rounded-full bg-site-primary/15 ring-1 ring-site-primary/25">
                            <Bot className="h-3 w-3 text-site-primary" />
                          </div>
                          <div>
                            <div className="font-medium leading-none">Du IA Business</div>
                            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-site-primary">En línea</div>
                          </div>
                        </div>
                      }
                    >
                      <MsgIn>Hola, ¿cuánto cuesta el servicio básico?</MsgIn>
                      <MsgOut>
                        ¡Hola! El servicio básico cuesta $45.000. ¿Quieres agendar una cita?
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          <button className="rounded-md bg-site-primary/15 py-1 text-[10px] font-medium text-site-primary ring-1 ring-site-primary/25">Agendar</button>
                          <button className="rounded-md bg-white/5 py-1 text-[10px] text-site-fg ring-1 ring-white/10">Ver más</button>
                        </div>
                      </MsgOut>
                      <div className="text-center font-mono text-[9px] uppercase tracking-widest text-site-muted-fg">escribiendo…</div>
                    </PhoneMock>
                  </div>

                  <div className="col-span-12 space-y-3 md:col-span-6">
                    <div className="site-panel p-3">
                      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">Cómo funciona</div>
                      <div className="space-y-1.5 font-mono text-[10.5px]">
                        <TraceLine k="webhook.recibido" v="Meta Cloud API" ok />
                        <TraceLine k="ia.responde" v="con tu prompt entrenado" ok />
                        <TraceLine k="wa.enviado" v="entregado" ok />
                      </div>
                    </div>
                    <div className="site-panel p-3">
                      <div className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">Modelo de IA</div>
                      <div className="mt-1 font-display text-[15px] font-medium text-site-fg">Claude (Anthropic)</div>
                      <div className="mt-1 text-[11px] text-site-muted-fg">Entrenado con el prompt de tu negocio: precios, horarios y tono.</div>
                    </div>
                  </div>
                </div>
              </Panel>
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

const AGENT_FEATURES = [
  {
    icon: Bot,
    title: "Nombre propio",
    desc: "Cada número tiene un solo agente, con el nombre que tú le pongas — no un rol genérico ni una plantilla.",
  },
  {
    icon: Sparkles,
    title: "Instrucciones personalizadas",
    desc: "Un cuadro de texto simple, sin código. Le escribes tus precios, horarios y tono, y responde así desde el próximo mensaje.",
  },
  {
    icon: FileUp,
    title: "Base de conocimiento",
    desc: "Sube tu listado de precios (Excel o CSV) o un documento (PDF) y el agente lo usa como referencia real al responder.",
  },
  {
    icon: Play,
    title: "Playground de prueba",
    desc: "Chatea con tu agente en un entorno de prueba, con sus instrucciones y conocimiento reales, antes de que hable con un cliente.",
  },
];

export function TrainingSection() {
  return (
    <section id="entrenamiento" className="relative border-t border-site-border py-28">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow="Tu agente de IA"
          title={<>Un agente por número, <br className="hidden md:block" />a tu manera — no un rol genérico.</>}
          desc="Nada de roles preconfigurados de ventas o soporte. Cada número tiene un solo agente, con el nombre, las instrucciones y el conocimiento que tú le des."
        />

        <div className="mt-12 grid grid-cols-12 gap-4">
          <Reveal variant="left" className="col-span-12 lg:col-span-5">
            <Panel className="p-6">
              <div className="flex items-center justify-between border-b border-site-border pb-3">
                <span className="font-display text-[13px] font-medium text-site-fg">Entrenar a Ava</span>
                <span className="font-mono text-[9.5px] uppercase tracking-widest text-site-primary">Guardado</span>
              </div>
              <div className="mt-4 rounded-lg border border-site-border bg-white/[0.02] p-4 text-[13px] leading-relaxed text-site-fg/80">
                Eres el asistente de WhatsApp de &quot;Peluquería Estilo&quot;. Responde de forma
                breve y amable. Cortes desde $25.000, tinte desde $60.000. Atendemos de
                martes a sábado, 9am a 6pm.
              </div>
              <div className="mt-4 flex items-center justify-between text-[11px] text-site-muted-fg">
                <span>312 / 4000</span>
                <span className="inline-flex items-center gap-1.5 text-site-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Ava ya responde con esto
                </span>
              </div>
            </Panel>
          </Reveal>

          <div className="col-span-12 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-7">
            {AGENT_FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 80}>
                <div className="h-full rounded-xl border border-site-border bg-white/[0.02] p-4">
                  <f.icon className="h-4 w-4 text-site-primary" />
                  <div className="mt-2 font-display text-[13.5px] font-medium text-site-fg">{f.title}</div>
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
   4b. Base de conocimiento
========================================================= */

export function KnowledgeSection() {
  const knowledgeItems = [
    { icon: FileText, title: "Excel, CSV o PDF", desc: "Listados de precios, catálogos o políticas — los formatos que ya usas." },
    { icon: Gauge, title: "Un archivo por número", desc: "Cada agente tiene su propia base de conocimiento, independiente de los demás." },
    { icon: ShieldCheck, title: "Solo lo que tú subiste", desc: "El agente responde con tus instrucciones y tu archivo, nada más." },
  ];

  return (
    <section id="conocimiento" className="relative border-t border-site-border py-28">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow="Base de conocimiento"
          title={<>Sube un archivo. <br className="hidden md:block" />El agente lo usa como referencia real.</>}
          desc="Un listado de precios en Excel o CSV, o un documento en PDF. Sin bases de datos complicadas — un archivo por número, listo para responder con eso."
        />

        <div className="mt-12 grid grid-cols-12 gap-4">
          <Reveal variant="left" className="col-span-12 lg:col-span-7">
            <Panel className="h-full p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileUp className="h-4 w-4 text-site-primary" />
                  <span className="font-display text-[13px] font-medium text-site-fg">Base de conocimiento</span>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-site-border bg-white/[0.02] px-3 py-1.5 text-[11px] text-site-muted-fg">
                  Reemplazar archivo
                </span>
              </div>
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-site-border bg-white/[0.02] px-3 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white/[0.04]">
                  <FileText className="h-4 w-4 text-site-muted-fg" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-site-fg">precios-peluqueria.xlsx</div>
                  <div className="text-[11px] text-site-muted-fg">4.820 caracteres</div>
                </div>
                <CheckCircle2 className="h-4 w-4 shrink-0 text-site-primary" />
              </div>
              <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
                El agente combina esto con sus instrucciones de tono y horarios para responder con tus datos reales
                — nunca inventa precios que no le diste.
              </p>
            </Panel>
          </Reveal>

          <div className="col-span-12 space-y-3 lg:col-span-5">
            {knowledgeItems.map((f, i) => (
              <Reveal key={f.title} delay={i * 80}>
                <div className="rounded-xl border border-site-border bg-white/[0.02] p-4">
                  <f.icon className="h-4 w-4 text-site-primary" />
                  <div className="mt-2 font-display text-[13.5px] font-medium text-site-fg">{f.title}</div>
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
   4c. Infraestructura oficial de WhatsApp
========================================================= */

const INFRA_ITEMS = [
  { icon: ShieldCheck, title: "API Oficial de WhatsApp Business", desc: "Construido directamente sobre la Cloud API de Meta — sin atajos no oficiales, sin riesgo de bloqueo." },
  { icon: UserPlus, title: "Embedded Signup", desc: "Conecta un número nuevo en minutos con el flujo nativo de Meta." },
  { icon: Layers, title: "Múltiples números", desc: "Administra cada línea conectada desde un solo panel." },
  { icon: FileCheck2, title: "Gestión de plantillas", desc: "Crea, envía a revisión y sigue el estado real de aprobación de tus plantillas." },
  { icon: Radio, title: "Campañas masivas", desc: "Llega a toda tu lista de contactos con plantillas aprobadas por Meta." },
  { icon: BadgeCheck, title: "Verificación de Meta", desc: "Consulta la calidad real de tu número y desbloquea límites de mensajería más altos." },
  { icon: Users, title: "Traspaso a un humano", desc: "Toma cualquier conversación desde tu celular cuando quieras, sin perder el hilo." },
];

export function WhatsappInfraSection() {
  return (
    <section id="infraestructura" className="relative border-t border-site-border bg-site-card/20 py-28">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow="Infraestructura confiable"
          title={<>Construido sobre la infraestructura <br className="hidden md:block" />oficial de WhatsApp.</>}
          desc="Cada mensaje pasa por la plataforma verificada de Meta. Confiabilidad, cumplimiento y entrega, por defecto."
        />

        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-site-border bg-white/5 sm:grid-cols-2 lg:grid-cols-3">
          {INFRA_ITEMS.map((item, i) => (
            <Reveal key={item.title} delay={(i % 3) * 60} className="h-full">
              <div className="group h-full bg-site-bg p-6 transition-colors hover:bg-white/[0.02]">
                <span className="flex size-10 items-center justify-center rounded-lg border border-site-border bg-white/[0.02]">
                  <item.icon className="h-5 w-5 text-site-primary" />
                </span>
                <h3 className="mt-4 font-display text-[15px] font-medium tracking-tight text-site-fg">{item.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-site-muted-fg">{item.desc}</p>
              </div>
            </Reveal>
          ))}
          <div className="flex flex-col justify-center bg-site-primary/5 p-6">
            <ShieldCheck className="h-6 w-6 text-site-primary" />
            <p className="mt-3 text-[13px] leading-relaxed text-site-muted-fg">
              Corre sobre la red global de mensajería de Meta — la misma infraestructura que usan las marcas más
              grandes del mundo.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   5. Mensajes centralizados (reemplaza "Integrations")
========================================================= */

export function InboxSection() {
  const chats = [
    { name: "Peluquería Estilo", last: "Listo, te espero a las 5:30", active: true },
    { name: "+57 300 123 4567", last: "¿Cuánto cuesta el servicio básico?", active: false },
    { name: "+57 310 555 8899", last: "Perfecto, muchas gracias", active: true },
  ];
  return (
    <section id="mensajes" className="relative border-t border-site-border py-28">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow="Mensajes"
          title={<>Todas tus conversaciones, <br className="hidden md:block" />en un solo lugar.</>}
          desc="Revisa cada chat, mira si la IA está activa o si pausaste para responder tú mismo, y ten el historial completo siempre a mano."
        />
        <Panel className="mt-12 overflow-hidden">
          <div className="grid grid-cols-12">
            <div className="col-span-12 divide-y divide-site-border md:col-span-5">
              {chats.map((c) => (
                <div key={c.name} className="flex items-center justify-between px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-site-fg">{c.name}</div>
                    <div className="mt-0.5 truncate text-[12px] text-site-muted-fg">{c.last}</div>
                  </div>
                  <span
                    className={`ml-3 shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest ring-1 ${
                      c.active
                        ? "bg-site-primary/10 text-site-primary ring-site-primary/25"
                        : "bg-white/5 text-site-muted-fg ring-white/10"
                    }`}
                  >
                    {c.active ? "IA activa" : "Pausado"}
                  </span>
                </div>
              ))}
            </div>
            <div className="col-span-12 hidden border-l border-site-border p-5 md:col-span-7 md:block">
              <div className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">Peluquería Estilo</div>
              <div className="mt-3 space-y-2">
                <MsgIn>Hola, ¿tienen turno para hoy?</MsgIn>
                <MsgOut>¡Hola! Sí, tengo espacio a las 4pm y 5:30pm. ¿Cuál prefieres?</MsgOut>
                <MsgIn>A las 5:30</MsgIn>
                <MsgOut>Listo, te espero a las 5:30. ¡Nos vemos!</MsgOut>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </section>
  );
}

/* =========================================================
   5b. Una plataforma completa (7 módulos reales)
========================================================= */

const PLATFORM_MODULES = [
  {
    key: "resumen",
    icon: LayoutGrid,
    label: "Resumen",
    headline: "Cada número, agente y conversación en una sola vista.",
    points: ["Automatización real por número", "Consumo del plan en vivo", "Actividad reciente"],
  },
  {
    key: "agentes",
    icon: Bot,
    label: "Agentes de IA",
    headline: "Configura tu agente en minutos, sin código.",
    points: ["Un agente por número, con nombre propio", "Instrucciones y base de conocimiento", "Pausa manual o por coexistencia"],
  },
  {
    key: "plantillas",
    icon: FileText,
    label: "Plantillas",
    headline: "Crea y sigue tus plantillas hasta la aprobación.",
    points: ["Estado real de aprobación de Meta", "Variables detectadas automáticamente", "Borradores locales antes de publicar"],
  },
  {
    key: "campanas",
    icon: Megaphone,
    label: "Campañas",
    headline: "Lanza campañas masivas con confianza.",
    points: ["Entrega y lectura en tiempo real", "Embudo de conversión por campaña", "Solo plantillas aprobadas por Meta"],
  },
  {
    key: "numeros",
    icon: Phone,
    label: "Números",
    headline: "Administra cada línea desde un solo lugar.",
    points: ["Conexión con Embedded Signup", "Calidad y límite reales de Meta", "Cupo diario en vivo"],
  },
  {
    key: "analytics",
    icon: BarChart3,
    label: "Analytics",
    headline: "Mide el desempeño real de toda tu operación.",
    points: ["Embudo de entrega real", "Mapa de actividad por hora", "Desempeño real por plantilla"],
  },
  {
    key: "cuenta",
    icon: CreditCard,
    label: "Cuenta",
    headline: "Tu plan y consumo, siempre visibles.",
    points: ["Plan mensual fijo", "Consumo real de conversaciones", "Pagos y renovación con Wompi"],
  },
] as const;

export function PlatformOverviewSection() {
  const [active, setActive] = useState(0);
  const current = PLATFORM_MODULES[active];

  return (
    <section id="plataforma-completa" className="relative border-t border-site-border py-28">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow="Una plataforma"
          title={<>Una plataforma. <br className="hidden md:block" />Cada conversación, en un solo lugar.</>}
          desc="Entiende todo el producto en menos de diez segundos. Siete módulos, un solo panel de control."
        />

        <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
          <div
            className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible"
            role="tablist"
            aria-label="Módulos de la plataforma"
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
                    : "border-site-border bg-white/[0.02] text-site-muted-fg hover:text-site-fg"
                }`}
              >
                <m.icon className={`h-4 w-4 ${i === active ? "text-site-primary" : ""}`} />
                {m.label}
              </button>
            ))}
          </div>

          <Panel className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-site-border bg-white/[0.02] px-5 py-3">
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
              <div className="rounded-xl border border-site-border bg-white/[0.02] p-4">
                <div className="flex items-center justify-between border-b border-site-border pb-3">
                  <span className="font-mono text-[10.5px] uppercase tracking-widest text-site-muted-fg">
                    {current.label}
                  </span>
                  <span className="h-2 w-2 rounded-full bg-site-primary animate-site-pulse-glow" />
                </div>
                <div className="mt-3 flex flex-col gap-2.5">
                  {[0, 1, 2, 3].map((row) => (
                    <div key={row} className="flex items-center gap-2.5">
                      <span className="size-6 shrink-0 rounded-md bg-white/[0.04]" />
                      <span className="h-2 rounded-full bg-white/[0.04]" style={{ width: `${70 - row * 12}%` }} />
                      <span className="ml-auto h-2 w-8 rounded-full bg-site-primary/30" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   5c. Diseñado para crecer
========================================================= */

const SCALE_ITEMS = [
  { icon: Phone, title: "Varios números", desc: "Conecta las líneas que necesites y adminístralas desde un solo panel." },
  { icon: Bot, title: "Un agente por número", desc: "Cada línea tiene su propio asistente, con nombre e instrucciones independientes." },
  { icon: Megaphone, title: "Plantillas y campañas sin límite", desc: "Crea las plantillas y campañas que necesites, según el consumo de tu plan." },
  { icon: Gauge, title: "Consumo siempre visible", desc: "Ve en tiempo real cuántas conversaciones has usado y cuántas te quedan." },
];

export function ScaleSection() {
  return (
    <section id="escala" className="relative py-28">
      <div className="mx-auto max-w-[1280px] px-6">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
          <SectionHeading
            eyebrow="Diseñado para crecer"
            title={<>Desde tu primer número <br className="hidden md:block" />hasta toda tu operación.</>}
            desc="Du Labs crece contigo. Ya sea que manejes una línea o varias, el panel se mantiene igual de simple."
          />
          <Reveal variant="zoom">
            <div className="relative flex items-center justify-center rounded-2xl border border-site-border bg-white/[0.02] p-8">
              <div className="pointer-events-none absolute inset-0 rounded-2xl site-grid-bg opacity-40" />
              <div className="relative flex flex-col items-center text-center">
                <span className="flex size-16 items-center justify-center rounded-2xl border border-site-primary/30 bg-site-primary/10">
                  <InfinityIcon className="h-8 w-8 text-site-primary" />
                </span>
                <div className="mt-4 font-display text-[26px] font-medium tracking-tight text-site-fg">
                  Crece con tu negocio
                </div>
                <p className="mt-1 text-[13px] text-site-muted-fg">Sin cambiar de plataforma cuando sumas números.</p>
              </div>
            </div>
          </Reveal>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SCALE_ITEMS.map((item, i) => (
            <Reveal key={item.title} delay={i * 70}>
              <div className="h-full rounded-2xl border border-site-border bg-white/[0.02] p-6">
                <span className="flex size-10 items-center justify-center rounded-lg border border-site-border bg-white/[0.02]">
                  <item.icon className="h-5 w-5 text-site-primary" />
                </span>
                <h3 className="mt-4 font-display text-[15px] font-medium tracking-tight text-site-fg">{item.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-site-muted-fg">{item.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   5d. Hecho para Latinoamérica
========================================================= */

const LATAM_ITEMS = [
  { icon: ShieldCheck, title: "APIs oficiales de Meta", desc: "Cumplimiento total con la plataforma de negocios de Meta en cualquier mercado." },
  { icon: Languages, title: "Pensado en español", desc: "Un producto, agentes y soporte diseñados en español desde el primer día." },
  { icon: Store, title: "Negocios locales", desc: "Construido para cómo se hace comercio de verdad: dentro de conversaciones de WhatsApp." },
  { icon: ServerCog, title: "Confiabilidad real", desc: "Infraestructura que funciona igual, desde tu primer número hasta cuando crezcas." },
];

export function LatamSection() {
  return (
    <section className="relative border-t border-site-border bg-site-card/20 py-28">
      <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-[720px] -translate-x-1/2 rounded-full bg-site-primary/5 blur-[120px]" />
      <div className="relative mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow="Hecho para Latinoamérica"
          title={<>Infraestructura pensada <br className="hidden md:block" />para cómo la región hace negocios.</>}
          desc="El comercio conversacional ya es el estándar en Latinoamérica. Du Labs está construido para eso, de forma nativa."
          align="center"
        />
        <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LATAM_ITEMS.map((item, i) => (
            <Reveal key={item.title} delay={i * 70}>
              <div className="h-full rounded-2xl border border-site-border bg-white/[0.02] p-6 text-center">
                <span className="mx-auto flex size-11 items-center justify-center rounded-xl border border-site-border bg-white/[0.02]">
                  <item.icon className="h-5 w-5 text-site-primary" />
                </span>
                <h3 className="mt-4 font-display text-[15px] font-medium tracking-tight text-site-fg">{item.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-site-muted-fg">{item.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   5e. El ecosistema Du
========================================================= */

const ECOSYSTEM_PILLARS = [
  {
    icon: Briefcase,
    name: "Du IA Business",
    desc: "La capa de plataforma — agentes de IA e infraestructura conversacional que corren tu operación en WhatsApp.",
  },
  {
    icon: GraduationCap,
    name: "Du Academy",
    desc: "Aprende a diseñar y escalar IA conversacional, con formación pensada para equipos y operadores.",
  },
  {
    icon: HeartPulse,
    name: "Du Life",
    desc: "Tecnología conversacional aplicada al día a día — llevando IA a los canales que la gente ya usa.",
  },
];

export function EcosystemSection() {
  return (
    <section className="relative py-28">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow="El ecosistema Du"
          title={<>IA donde ya vive <br className="hidden md:block" />la conversación.</>}
          desc="Du Labs cree en una idea: el futuro del software es conversacional. Nuestro ecosistema lleva esa idea a los negocios, la formación y el día a día."
        />
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
          {ECOSYSTEM_PILLARS.map((p, i) => (
            <Reveal key={p.name} delay={i * 80}>
              <div className="group relative h-full overflow-hidden rounded-2xl border border-site-border bg-white/[0.02] p-6 transition-colors hover:border-site-primary/30">
                <div className="flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-xl border border-site-border bg-white/[0.02]">
                    <p.icon className="h-5 w-5 text-site-primary" />
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-site-muted-fg transition-colors group-hover:text-site-primary" />
                </div>
                <h3 className="mt-5 font-display text-[16px] font-medium tracking-tight text-site-fg">{p.name}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-site-muted-fg">{p.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   6. Métricas (afirmaciones honestas, no cifras inventadas)
========================================================= */

export function MetricsSection() {
  const metrics = [
    { v: "100%", l: "API Oficial de Meta", s: "Cada mensaje pasa por la infraestructura oficial de WhatsApp." },
    { v: "0%", l: "Riesgo de bloqueo", s: "Sin extensiones ni trucos que arriesguen tu número." },
    { v: "24/7", l: "IA respondiendo", s: "Mientras tú sigues usando tu WhatsApp normal." },
    { v: "<2s", l: "Tiempo de respuesta", s: "Respuestas instantáneas para tus clientes." },
  ];
  return (
    <section id="metricas" className="relative border-t border-site-border py-28">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading eyebrow="Por qué Du Labs" title={<>Construido sobre lo que Meta exige, <br className="hidden md:block" />no sobre atajos.</>} align="center" />
        <div className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-site-border bg-white/5 md:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.l} className="bg-site-bg p-8 text-center">
              <div className="font-display text-[44px] font-medium leading-none tracking-tight site-text-gradient-primary md:text-[52px]">
                {m.v}
              </div>
              <div className="mt-4 text-[13.5px] font-medium text-site-fg">{m.l}</div>
              <div className="mt-1 text-[11.5px] text-site-muted-fg">{m.s}</div>
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

const tiers = [
  {
    name: "Plan Básico",
    price: "$59.990",
    tag: "Emprendedores y pequeños negocios locales.",
    features: ["1 número de WhatsApp", "IA en Modo Coexistencia", "Hasta 1.000 mensajes / mes", "Soporte estándar por correo"],
  },
  {
    name: "Plan Pro",
    price: "$129.990",
    tag: "Negocios en crecimiento y marcas comerciales.",
    features: ["Todo lo del Plan Básico", "Plantillas y campañas masivas", "Hasta 5.000 mensajes / mes", "Soporte prioritario por WhatsApp"],
    featured: true,
  },
  {
    name: "Plan Enterprise",
    price: "$299.990",
    tag: "Empresas con operaciones de alta demanda.",
    features: ["Todo lo del Plan Pro", "Mensajes ilimitados*", "Múltiples números en paralelo", "Soporte dedicado 24/7"],
  },
];

export function PricingSection() {
  return (
    <section id="precios" className="relative border-t border-site-border py-28">
      <div className="mx-auto max-w-[1280px] px-6">
        <SectionHeading
          eyebrow="Precios"
          title={<>Un plan para cada etapa de tu negocio.</>}
          desc="Precios en pesos colombianos (COP), cobro recurrente mensual."
          align="center"
        />
        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative overflow-hidden rounded-2xl border p-7 ${
                t.featured
                  ? "border-site-primary/30 bg-gradient-to-b from-site-primary/[0.08] to-site-card/60 ring-1 ring-site-primary/20"
                  : "border-site-border bg-site-card/50"
              }`}
            >
              {t.featured && (
                <div className="absolute right-5 top-5 rounded-full bg-site-primary px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-widest text-site-primary-fg">
                  Recomendado
                </div>
              )}
              <div className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">{t.name}</div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-display text-[36px] font-medium tracking-tight text-site-fg">{t.price}</span>
                <span className="text-[12px] text-site-muted-fg">COP / mes</span>
              </div>
              <p className="mt-2 text-[13px] text-site-muted-fg">{t.tag}</p>
              <PlanButton
                plan={t.name}
                className={`mt-6 inline-flex h-10 w-full items-center justify-center rounded-lg text-[13px] font-medium transition-all ${
                  t.featured
                    ? "bg-site-primary text-site-primary-fg hover:brightness-110"
                    : "border border-site-border text-site-fg hover:border-white/20 hover:bg-white/[0.03]"
                }`}
              />
              <div className="mt-6 space-y-2.5 border-t border-site-border pt-6">
                {t.features.map((f) => (
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
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-site-primary" /> API Oficial de Meta</span>
          <span className="inline-flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-site-primary" /> Datos alojados de forma segura</span>
          <span className="inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-site-primary" /> IA con Claude (Anthropic)</span>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   8. FAQ (respuestas reales)
========================================================= */

const faqs = [
  {
    q: "¿Qué tan rápido puedo conectar mi WhatsApp?",
    a: "El flujo de conexión con Meta (Embedded Signup) toma unos minutos. En cuanto conectas tu número, ya puedes entrenar tu IA y empezar a recibir mensajes.",
  },
  {
    q: "¿Usan la API oficial de WhatsApp?",
    a: "Sí. Todo pasa por la API Oficial de WhatsApp Business (Meta Cloud API) — sin hacks no oficiales, sin riesgo de baneo.",
  },
  {
    q: "¿Qué modelo de IA usan?",
    a: "Usamos Claude, de Anthropic, entrenado con el prompt específico de tu negocio: precios, horarios y tono de atención.",
  },
  {
    q: "¿Pierdo el control de mi WhatsApp?",
    a: "No. Con Modo Coexistencia sigues usando tu WhatsApp Business normal desde el celular. La IA responde en paralelo y se pausa sola en cualquier chat donde tú respondas.",
  },
  {
    q: "¿Puedo enviar mensajes masivos?",
    a: "Sí, con plantillas aprobadas por Meta. Creas la plantilla, Meta la aprueba, y envías la campaña a tu lista de clientes desde tu panel.",
  },
  {
    q: "¿Con qué se integra Du Labs hoy?",
    a: "Hoy nos enfocamos 100% en hacer WhatsApp Business excelente: conexión oficial, IA entrenada, plantillas y campañas, y bandeja de mensajes centralizada.",
  },
];

export function FaqSection() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="relative border-t border-site-border py-28">
      <div className="mx-auto max-w-3xl px-6">
        <SectionHeading eyebrow="Preguntas frecuentes" title={<>Respuestas, antes de que preguntes.</>} align="center" />
        <div className="mt-12 divide-y divide-site-border overflow-hidden rounded-2xl border border-site-border bg-site-card/40">
          {faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <button
                key={f.q}
                onClick={() => setOpen(isOpen ? null : i)}
                className="w-full px-6 py-5 text-left transition-colors hover:bg-white/[0.02]"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="font-display text-[15px] font-medium text-site-fg">{f.q}</span>
                  <ChevronDown className={`h-4 w-4 flex-shrink-0 text-site-muted-fg transition-transform ${isOpen ? "rotate-180 text-site-primary" : ""}`} />
                </div>
                <div className={`grid overflow-hidden text-[13.5px] leading-relaxed text-site-muted-fg transition-all ${isOpen ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                  <div className="min-h-0 overflow-hidden">{f.a}</div>
                </div>
              </button>
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
  return (
    <section id="demo" className="relative overflow-hidden border-t border-site-border py-32">
      <div className="pointer-events-none absolute inset-0 site-ambient-bg animate-site-ambient opacity-90" />
      <div className="pointer-events-none absolute inset-0 site-grid-bg [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_70%)]" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-site-primary/15 blur-[140px]" />

      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <SectionLabel>Empecemos</SectionLabel>
        <h2 className="mt-5 font-display text-[38px] font-medium leading-[1.05] tracking-[-0.025em] site-text-gradient md:text-[56px]">
          Conecta tu WhatsApp <br />
          <span className="site-text-gradient-primary">y deja que la IA atienda hoy.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-site-muted-fg">
          API Oficial de Meta, sin bloqueos, IA en Modo Coexistencia. Listo para
          producción desde el primer día.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/business"
            className="group inline-flex h-11 items-center rounded-full bg-site-fg px-5 text-[13.5px] font-medium text-site-bg transition-all hover:bg-site-fg/90"
          >
            Activar mi API Oficial <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="https://wa.me/573148127388"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center rounded-full border border-site-border bg-white/[0.02] px-5 text-[13.5px] font-medium text-site-fg backdrop-blur-md hover:border-white/20"
          >
            Hablar por WhatsApp
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
  const cols = [
    {
      title: "Producto",
      links: [
        { l: "Modo coexistencia", h: "#coexistencia" },
        { l: "Agentes de IA", h: "#entrenamiento" },
        { l: "Base de conocimiento", h: "#conocimiento" },
        { l: "Plantillas y campañas", h: "#campanas" },
        { l: "Infraestructura", h: "#infraestructura" },
        { l: "Precios", h: "#precios" },
      ],
    },
    {
      title: "Legal",
      links: [
        { l: "Privacidad", h: "/privacidad" },
        { l: "Términos", h: "/terminos" },
        { l: "Eliminación de datos - WhatsApp", h: "/eliminacion-de-datos-whatsapp" },
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
              Automatización de WhatsApp Business con IA, sobre la API Oficial de Meta.
              Hecho en Montería, Colombia.
            </p>
            <div className="mt-6 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">
              <span className="h-1.5 w-1.5 rounded-full bg-site-primary shadow-[0_0_6px_var(--color-site-primary)]" />
              Todo funcionando con normalidad
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

        <div className="mt-14 grid gap-10 border-t border-site-border pt-10 md:grid-cols-2">
          <div>
            <h3 className="text-[12.5px] font-semibold text-site-fg">Información legal</h3>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
              <span className="text-site-muted-fg/70">Titular del servicio:</span>
              <br />
              RAMOS PADILLA DUVAN ANDRES
            </p>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
              <span className="text-site-muted-fg/70">Nombre comercial:</span>
              <br />
              DULABS
            </p>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
              <span className="text-site-muted-fg/70">Dirección principal:</span>
              <br />
              BRR SANTA ELENA V CR 36 47 17
              <br />
              Montería, Córdoba 230001
              <br />
              Colombia
            </p>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
              <span className="text-site-muted-fg/70">Correo electrónico:</span>
              <br />
              contacto@dulabs.co
            </p>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg">
              <span className="text-site-muted-fg/70">Sitio web:</span>
              <br />
              https://www.dulabs.co
            </p>
            <p className="mt-4 text-[12.5px] leading-relaxed text-site-muted-fg/80">
              Du Labs es una marca comercial y plataforma digital operada por
              RAMOS PADILLA DUVAN ANDRES.
            </p>
          </div>
          <div className="md:justify-self-end">
            <h3 className="text-[12.5px] font-semibold text-site-fg">Contacto</h3>
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
          <p>© {new Date().getFullYear()} Du Labs. Todos los derechos reservados.</p>
          <p>Hecho en Colombia 🇨🇴</p>
        </div>
      </div>
    </footer>
  );
}
