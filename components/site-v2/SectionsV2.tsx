"use client";

import Link from "next/link";
import Image from "next/image";
import {
  BrainCircuit,
  Workflow,
  Code2,
  MessageSquare,
  Users,
  Zap,
  Megaphone,
  BarChart3,
  Puzzle,
  ArrowRight,
  ArrowUpRight,
} from "lucide-react";
import { LogoV2 } from "./LogoV2";
import { trackConversion } from "@/lib/site-analytics";
import {
  MENSAJE_WHATSAPP_GENERICO_ES,
  MENSAJE_WHATSAPP_ENTERPRISE_ES,
  whatsappVentasUrl,
} from "@/lib/site-contact";

/* ============================ 02 · Problema ============================ */
export function ProblemaSection() {
  return (
    <section className="border-t border-sitev2-border">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8 md:py-32">
        <h2 className="mx-auto max-w-4xl text-center font-display text-[clamp(1.9rem,4.6vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-sitev2-fg">
          Tu empresa no necesita más herramientas.
          <br className="hidden sm:block" />{" "}
          <span className="text-sitev2-muted-fg">Necesita que trabajen juntas.</span>
        </h2>
      </div>
    </section>
  );
}

/* ========================== 03 · Capacidades ========================== */
const CAPACIDADES = [
  {
    icon: BrainCircuit,
    title: "IA",
    desc: "Agentes que entienden, responden y actúan por tu empresa.",
  },
  {
    icon: Workflow,
    title: "Automatización",
    desc: "Procesos que ocurren sin intervención manual.",
  },
  {
    icon: Code2,
    title: "Software",
    desc: "Sistemas construidos alrededor de cómo trabaja tu empresa.",
  },
];

export function CapacidadesSection() {
  return (
    <section id="soluciones" className="border-t border-sitev2-border bg-sitev2-surface">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-sitev2-subtle-fg">
            Qué hacemos
          </p>
          <h2 className="mt-4 font-display text-[clamp(1.9rem,4vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-sitev2-fg">
            Tres formas de poner la tecnología a trabajar
          </h2>
        </div>

        <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-sitev2-border bg-sitev2-border md:grid-cols-3">
          {CAPACIDADES.map((c) => (
            <div key={c.title} className="bg-sitev2-card p-8">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sitev2-primary-soft">
                <c.icon className="h-5 w-5 text-sitev2-primary" strokeWidth={1.8} />
              </span>
              <h3 className="mt-6 font-display text-[22px] font-semibold tracking-tight text-sitev2-fg">
                {c.title}
              </h3>
              <p className="mt-2.5 max-w-xs text-[14.5px] leading-relaxed text-sitev2-muted-fg">
                {c.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================== 04 · Plataforma =========================== */
const MODULOS = [
  { icon: MessageSquare, title: "Conversaciones", desc: "Todos los canales en una sola bandeja." },
  { icon: Users, title: "Contactos", desc: "Cada cliente y su historial, siempre a mano." },
  { icon: Zap, title: "Automatizaciones", desc: "Flujos que responden y hacen seguimiento solos." },
  { icon: Megaphone, title: "Campañas", desc: "Mensajes masivos con botones y variables." },
  { icon: BarChart3, title: "Analítica", desc: "Lo que pasa en tu operación, en datos claros." },
  { icon: Puzzle, title: "Integraciones", desc: "Conecta DuLabs con las herramientas que ya usas." },
];

export function PlataformaSection() {
  return (
    <section id="plataforma" className="border-t border-sitev2-border">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-sitev2-subtle-fg">
            La plataforma
          </p>
          <h2 className="mt-4 font-display text-[clamp(1.9rem,4vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-sitev2-fg">
            Un producto real, no una demo
          </h2>
          <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-sitev2-muted-fg">
            Conversaciones, contactos, automatización y datos en un mismo lugar — la operación
            completa de atención de tu empresa.
          </p>
        </div>

        <div className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {MODULOS.map((m) => (
            <div key={m.title} className="flex gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sitev2-border bg-sitev2-surface">
                <m.icon className="h-[18px] w-[18px] text-sitev2-fg" strokeWidth={1.8} />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-sitev2-fg">{m.title}</h3>
                <p className="mt-1 text-[13.5px] leading-relaxed text-sitev2-muted-fg">{m.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================== 05 · Casos ============================== */
const LOGOS = [
  { src: "/logos-clientes/icontec.png", alt: "ICONTEC" },
  { src: "/logos-clientes/ur.png", alt: "Universidad del Rosario" },
  { src: "/logos-clientes/wom-chile.png", alt: "WOM" },
  { src: "/logos-clientes/farmasi.png", alt: "Farmasi" },
  { src: "/logos-clientes/cofrem.svg", alt: "Cofrem" },
  { src: "/logos-clientes/claro.svg", alt: "Claro" },
  { src: "/logos-clientes/huspy.svg", alt: "Huspy" },
];

export function CasosSection() {
  return (
    <section id="casos" className="border-t border-sitev2-border bg-sitev2-surface">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-xl">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-sitev2-subtle-fg">
              Casos
            </p>
            <h2 className="mt-4 font-display text-[clamp(1.9rem,4vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-sitev2-fg">
              Empresas que ya trabajan con DuLabs
            </h2>
          </div>
          <Link
            href="/casos"
            className="group inline-flex items-center gap-1.5 text-[14px] font-medium text-sitev2-fg"
          >
            Ver casos
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>

        <div className="mt-14 grid grid-cols-2 items-center gap-x-8 gap-y-10 sm:grid-cols-3 lg:grid-cols-7">
          {LOGOS.map((l) => (
            <div key={l.src} className="flex items-center justify-center">
              <Image
                src={l.src}
                alt={l.alt}
                width={120}
                height={40}
                className="h-8 w-auto object-contain opacity-60 grayscale transition-all hover:opacity-100 hover:grayscale-0"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================== 06 · Enterprise =========================== */
export function EnterpriseSection() {
  const href = whatsappVentasUrl(MENSAJE_WHATSAPP_ENTERPRISE_ES);
  return (
    <section id="empresa" className="border-t border-sitev2-border">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8 md:py-32">
        <div className="grid gap-12 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-16">
          <div className="max-w-2xl">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-sitev2-subtle-fg">
              Desarrollo a medida
            </p>
            <h2 className="mt-4 font-display text-[clamp(2rem,4.4vw,3.25rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-sitev2-fg">
              Cuando el problema no cabe en un software estándar,
              <span className="text-sitev2-primary"> construimos la solución.</span>
            </h2>
            <p className="mt-6 max-w-lg text-[16px] leading-relaxed text-sitev2-muted-fg">
              Para empresas con procesos propios: IA, automatización, software e integraciones
              diseñados alrededor de cómo trabaja tu operación.
            </p>
            <div className="mt-8 flex flex-wrap gap-2.5">
              {["IA", "Automatización", "Software", "Integraciones"].map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-sitev2-border bg-sitev2-surface px-4 py-1.5 text-[13px] text-sitev2-fg"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackConversion("cta_whatsapp", { source: "enterprise_v2" })}
            className="group inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-sitev2-fg px-6 text-[14.5px] font-medium text-sitev2-bg transition-all hover:-translate-y-0.5 hover:bg-black"
          >
            Hablar con DuLabs
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
          </a>
        </div>
      </div>
    </section>
  );
}

/* ============================ 08 · CTA final ============================ */
export function FinalCtaSection() {
  const href = whatsappVentasUrl(MENSAJE_WHATSAPP_GENERICO_ES);
  return (
    <section className="border-t border-sitev2-border bg-sitev2-surface">
      <div className="mx-auto max-w-[1280px] px-5 py-28 text-center sm:px-8 md:py-36">
        <h2 className="mx-auto max-w-3xl font-display text-[clamp(2.25rem,5.5vw,4rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-sitev2-fg">
          ¿Qué podemos construir juntos
          <span className="text-sitev2-primary">?</span>
        </h2>
        <div className="mt-10 flex justify-center">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackConversion("cta_whatsapp", { source: "final_cta_v2" })}
            className="group inline-flex h-[52px] items-center gap-2 rounded-full bg-sitev2-fg px-7 text-[15px] font-medium text-sitev2-bg transition-all hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_16px_40px_-14px_rgba(17,17,17,0.45)]"
          >
            Hablar con DuLabs
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>
      </div>
    </section>
  );
}

/* ============================== Footer ============================== */
const FOOTER_COLS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Producto",
    links: [
      { label: "WhatsApp con IA", href: "/whatsapp-ia" },
      { label: "Precios", href: "#precios" },
      { label: "Iniciar sesión", href: "/login" },
    ],
  },
  {
    title: "Soluciones",
    links: [
      { label: "Soluciones", href: "#soluciones" },
      { label: "Enterprise", href: "/soluciones-empresariales" },
      { label: "Casos", href: "/casos" },
    ],
  },
  {
    title: "Empresa",
    links: [
      { label: "Recursos", href: "/recursos" },
      { label: "Preguntas frecuentes", href: "/preguntas-frecuentes" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacidad", href: "/privacidad" },
      { label: "Términos", href: "/terminos" },
      { label: "Eliminación de datos", href: "/eliminacion-de-datos-whatsapp" },
    ],
  },
];

export function FooterV2() {
  return (
    <footer className="border-t border-sitev2-border bg-sitev2-bg">
      <div className="mx-auto max-w-[1280px] px-5 py-16 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <LogoV2 className="text-[19px]" />
            <p className="mt-4 max-w-[24ch] text-[13.5px] leading-relaxed text-sitev2-muted-fg">
              IA, automatización y software para que tu operación funcione mejor.
            </p>
          </div>
          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-sitev2-subtle-fg">
                {col.title}
              </h3>
              <ul className="mt-4 flex flex-col gap-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-[13.5px] text-sitev2-muted-fg transition-colors hover:text-sitev2-fg"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-3 border-t border-sitev2-border pt-6 sm:flex-row sm:items-center">
          <p className="text-[12.5px] text-sitev2-subtle-fg">
            © {new Date().getFullYear()} DuLabs · by People BPO
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-sitev2-subtle-fg">
            Tecnología con propósito
          </p>
        </div>
      </div>
    </footer>
  );
}
