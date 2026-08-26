"use client";

import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Bot,
  Building2,
  Code2,
  Database,
  Loader2,
  Mail,
  MessageCircle,
  Plug,
} from "lucide-react";
import { SectionHeading } from "./Sections";
import { Reveal } from "./Reveal";
import { useI18n } from "@/lib/i18n";
import { whatsappVentasUrl } from "@/lib/site-contact";

/* =========================================================
   Soluciones — DuLabs no es solo el bot de WhatsApp
========================================================= */

export function SolutionsSection() {
  const { t } = useI18n();
  const areas = [
    {
      icon: Bot,
      title: t("IA & Automatización", "AI & Automation"),
      desc: t(
        "Agentes de IA, automatización de procesos, atención inteligente y flujos que trabajan por tu equipo.",
        "AI agents, process automation, smart support and workflows that work for your team."
      ),
      ejemplos: [
        t("Agentes de IA", "AI agents"),
        t("WhatsApp con IA", "WhatsApp with AI"),
        t("Automatización de procesos", "Process automation"),
        t("Seguimiento de clientes", "Customer follow-up"),
      ],
    },
    {
      icon: Code2,
      title: t("Software a medida", "Custom software"),
      desc: t(
        "Construimos las herramientas que tu empresa necesita cuando una solución estándar no es suficiente.",
        "We build the tools your business needs when an off-the-shelf solution isn't enough."
      ),
      ejemplos: [
        t("CRM personalizados", "Custom CRMs"),
        t("Plataformas web", "Web platforms"),
        t("Sistemas internos", "Internal systems"),
        t("Dashboards", "Dashboards"),
      ],
    },
    {
      icon: Plug,
      title: t("Integraciones", "Integrations"),
      desc: t(
        "Conectamos tus herramientas para que la información fluya automáticamente entre tus sistemas.",
        "We connect your tools so information flows automatically between your systems."
      ),
      ejemplos: ["WhatsApp API", "Meta", "CRM", "Supabase"],
    },
    {
      icon: Database,
      title: t("Datos & Operaciones", "Data & Operations"),
      desc: t(
        "Convertimos información y procesos en sistemas más simples, medibles y automatizados.",
        "We turn information and processes into systems that are simpler, measurable and automated."
      ),
      ejemplos: [
        t("Dashboards", "Dashboards"),
        t("Reportes", "Reports"),
        t("Analítica", "Analytics"),
        t("Control operativo", "Operational control"),
      ],
    },
  ];

  return (
    <section id="soluciones" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <SectionHeading
          eyebrow={t("Soluciones", "Solutions")}
          title={t("Más que WhatsApp. Construimos tecnología para tu negocio.", "More than WhatsApp. We build technology for your business.")}
          desc={t(
            "Desde automatizaciones inteligentes hasta plataformas empresariales, diseñamos soluciones adaptadas a la forma en que realmente funciona tu empresa.",
            "From smart automations to enterprise platforms, we design solutions shaped around how your business actually works."
          )}
          align="center"
        />
        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {areas.map((a, i) => (
            <Reveal key={a.title} delay={i * 80}>
              <div className="flex h-full flex-col rounded-2xl border border-site-border bg-site-card/50 p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-site-primary/10 ring-1 ring-site-primary/20">
                  <a.icon className="h-4.5 w-4.5 text-site-primary" />
                </div>
                <h3 className="mt-4 font-display text-[16.5px] font-medium tracking-tight text-site-fg">{a.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-site-muted-fg">{a.desc}</p>
                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-site-border pt-4">
                  {a.ejemplos.map((e) => (
                    <span key={e} className="rounded-full border border-site-border bg-black/20 px-2.5 py-1 font-mono text-[10px] text-site-muted-fg">
                      {e}
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   Cómo trabajamos — genérico, aplica a cualquier proyecto (WhatsApp o Enterprise)
========================================================= */

export function HowWeWorkSection() {
  const { t } = useI18n();
  const pasos = [
    { n: "01", title: t("Entendemos", "We understand"), desc: t("Conocemos tu negocio, procesos y objetivo.", "We learn your business, processes and goal.") },
    { n: "02", title: t("Diseñamos", "We design"), desc: t("Definimos la solución y la experiencia.", "We define the solution and the experience.") },
    { n: "03", title: t("Desarrollamos", "We build"), desc: t("Construimos e integramos la tecnología.", "We build and integrate the technology.") },
    { n: "04", title: t("Implementamos", "We deploy"), desc: t("Ponemos la solución en funcionamiento y te acompañamos.", "We put the solution to work and stay with you.") },
  ];
  return (
    <section id="como-trabajamos" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <SectionHeading
          eyebrow={t("Cómo trabajamos", "How we work")}
          labelStyle="kicker"
          size="md"
          title={t("De la idea a una solución funcionando.", "From idea to a working solution.")}
          align="center"
        />
        <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2 xl:grid-cols-4">
          {pasos.map((p, i) => (
            <Reveal key={p.n} delay={i * 80}>
              <div className="text-center xl:text-left">
                <span className="font-mono text-[13px] text-site-primary">{p.n}</span>
                <h3 className="mt-2 font-display text-[16.5px] font-medium tracking-tight text-site-fg">{p.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-site-muted-fg">{p.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   Enterprise — sección comercial independiente, NO un plan más
========================================================= */

const PROYECTOS_ENTERPRISE = [
  { es: "CRM empresarial", en: "Enterprise CRM" },
  { es: "Sistemas internos", en: "Internal systems" },
  { es: "Agentes de IA personalizados", en: "Custom AI agents" },
  { es: "Automatización de procesos", en: "Process automation" },
  { es: "Integraciones entre plataformas", en: "Cross-platform integrations" },
  { es: "Dashboards empresariales", en: "Enterprise dashboards" },
  { es: "Plataformas web", en: "Web platforms" },
  { es: "Soluciones de datos", en: "Data solutions" },
  { es: "Flujos operativos personalizados", en: "Custom operational workflows" },
];

export function EnterpriseSection() {
  const { t, lang } = useI18n();
  return (
    <section id="enterprise" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <div className="relative overflow-hidden rounded-3xl border border-site-primary/20 bg-gradient-to-b from-site-primary/[0.06] to-site-card/40 p-8 md:p-14">
          <div className="pointer-events-none absolute inset-0 site-grid-bg opacity-40 [mask-image:radial-gradient(ellipse_at_top_right,black_0%,transparent_65%)]" />

          <div className="relative grid gap-12 xl:grid-cols-[1fr_auto]">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-site-primary/25 bg-site-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-site-primary">
                <Building2 className="h-3 w-3" /> Enterprise
              </span>
              <h2 className="mt-5 max-w-xl font-display text-[32px] font-medium leading-[1.1] tracking-[-0.02em] text-site-fg md:text-[42px]">
                {t("¿Necesitas algo más?", "Need something more?")}
              </h2>
              <p className="mt-5 max-w-lg text-[15.5px] leading-relaxed text-site-fg/90">
                {t(
                  "Construimos soluciones a medida para empresas que necesitan ir más allá de una plataforma estándar.",
                  "We build custom solutions for companies that need to go beyond a standard platform."
                )}
              </p>
              <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-site-muted-fg">
                {t(
                  "Cuéntanos qué quieres resolver y diseñaremos contigo la solución tecnológica adecuada para tu negocio.",
                  "Tell us what you need to solve and we'll design the right technology solution with you."
                )}
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <a
                  href="#contacto"
                  className="group inline-flex h-11 items-center rounded-full bg-site-primary px-5 text-[13.5px] font-medium text-site-primary-fg transition-all hover:brightness-110"
                >
                  {t("Cuéntanos tu proyecto", "Tell us about your project")}
                  <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>
                <a
                  href={whatsappVentasUrl(
                    lang === "en" ? "Hi, I'd like to talk about an Enterprise project." : "Hola, quiero hablar sobre un proyecto Enterprise."
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 items-center rounded-full border border-site-border bg-site-card px-5 text-[13.5px] font-medium text-site-fg transition-all hover:border-white/20"
                >
                  {t("Hablar con DuLabs", "Talk to DuLabs")}
                </a>
              </div>

              <div className="mt-10 max-w-lg border-t border-site-border pt-6">
                <p className="font-display text-[15px] font-medium text-site-fg">
                  {t("No creemos que todas las empresas necesiten la misma tecnología.", "We don't believe every company needs the same technology.")}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-site-muted-fg">
                  {t(
                    "Por eso no solo ofrecemos productos listos para usar. También desarrollamos soluciones alrededor de tus procesos, herramientas y objetivos.",
                    "That's why we don't just offer ready-made products. We also build solutions around your processes, tools and goals."
                  )}
                </p>
              </div>
            </div>

            {/* Ejemplos de proyecto -- deliberadamente NO en formato de tarjeta de precios */}
            <div className="xl:w-[280px]">
              <p className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">
                {t("Algunos ejemplos", "Some examples")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 xl:flex-col xl:gap-1.5">
                {PROYECTOS_ENTERPRISE.map((p) => (
                  <span
                    key={p.es}
                    className="rounded-full border border-site-border bg-black/20 px-3 py-1.5 text-[12px] text-site-fg/90 xl:rounded-lg xl:px-3 xl:py-2"
                  >
                    {lang === "en" ? p.en : p.es}
                  </span>
                ))}
              </div>
              <p className="mt-4 text-[11px] italic leading-relaxed text-site-muted-fg">
                {t(
                  "Ejemplos de lo que podemos desarrollar -- no todos los proyectos incluyen todo esto.",
                  "Examples of what we can build -- not every project includes all of this."
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   Contacto Enterprise — correo + WhatsApp + formulario real
========================================================= */

type EstadoForm = "listo" | "enviando" | "exito" | "error";

export function EnterpriseContactSection() {
  const { t, lang } = useI18n();
  const [estado, setEstado] = useState<EstadoForm>("listo");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [correo, setCorreo] = useState("");
  const [telefono, setTelefono] = useState("");
  const [necesidad, setNecesidad] = useState("");
  const [detalle, setDetalle] = useState("");

  const opcionesNecesidad = [
    t("IA & Automatización", "AI & Automation"),
    t("Software a medida", "Custom software"),
    t("Integraciones", "Integrations"),
    t("Datos & Operaciones", "Data & Operations"),
    t("Otro", "Other"),
  ];

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEstado("enviando");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/enterprise/contacto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, empresa, correo, telefono, necesidad, detalle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("No se pudo enviar la solicitud.", "Couldn't send the request."));
      setEstado("exito");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t("Error enviando la solicitud.", "Error sending the request."));
      setEstado("error");
    }
  };

  const inputClass =
    "w-full rounded-lg border border-site-border bg-black/20 px-3.5 py-2.5 text-[13.5px] text-site-fg outline-none transition-colors placeholder:text-site-muted-fg/60 focus:border-site-primary/40";

  return (
    <section id="contacto" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[900px] px-6">
        <SectionHeading
          eyebrow={t("Contacto", "Contact")}
          title={t("Cuéntanos qué necesitas", "Tell us what you need")}
          desc={t(
            "Nuestro equipo revisará tu proyecto y te contactará para entender el alcance y proponerte la mejor solución.",
            "Our team will review your project and reach out to understand the scope and propose the right solution."
          )}
          align="center"
        />

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <a
            href="mailto:contacto@dulabs.co"
            className="group flex items-center justify-between gap-3 rounded-xl border border-site-border bg-site-card/50 p-5 transition-colors hover:border-white/20"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-site-primary/10 ring-1 ring-site-primary/20">
                <Mail className="h-4 w-4 text-site-primary" />
              </div>
              <div>
                <p className="text-[13.5px] font-medium text-site-fg">{t("Correo", "Email")}</p>
                <p className="text-[12.5px] text-site-muted-fg">contacto@dulabs.co</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-site-muted-fg transition-transform group-hover:translate-x-0.5 group-hover:text-site-fg" />
          </a>
          <a
            href={whatsappVentasUrl(
              lang === "en" ? "Hi, I'd like to talk to DuLabs about a project." : "Hola, quiero hablar con DuLabs sobre un proyecto."
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between gap-3 rounded-xl border border-site-border bg-site-card/50 p-5 transition-colors hover:border-white/20"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-site-primary/10 ring-1 ring-site-primary/20">
                <MessageCircle className="h-4 w-4 text-site-primary" />
              </div>
              <div>
                <p className="text-[13.5px] font-medium text-site-fg">WhatsApp</p>
                <p className="text-[12.5px] text-site-muted-fg">{t("Habla directamente con DuLabs", "Talk directly to DuLabs")}</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-site-muted-fg transition-transform group-hover:translate-x-0.5 group-hover:text-site-fg" />
          </a>
        </div>

        <div className="mt-6 rounded-2xl border border-site-border bg-site-card/40 p-6 md:p-8">
          {estado === "exito" ? (
            <div className="py-6 text-center">
              <p className="font-display text-[17px] font-medium text-site-fg">
                {t("¡Listo! Ya recibimos tu solicitud.", "Done! We've received your request.")}
              </p>
              <p className="mt-2 text-[13.5px] text-site-muted-fg">
                {t("Te contactaremos para entender el alcance de tu proyecto.", "We'll reach out to understand the scope of your project.")}
              </p>
            </div>
          ) : (
            <form onSubmit={enviar} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-site-muted-fg">{t("Nombre", "Name")}</label>
                  <input required value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputClass} placeholder={t("Tu nombre", "Your name")} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-site-muted-fg">{t("Empresa", "Company")}</label>
                  <input required value={empresa} onChange={(e) => setEmpresa(e.target.value)} className={inputClass} placeholder={t("Nombre de tu empresa", "Your company's name")} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-site-muted-fg">{t("Correo electrónico", "Email")}</label>
                  <input required type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} className={inputClass} placeholder="tu@empresa.com" />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-site-muted-fg">{t("Teléfono / WhatsApp", "Phone / WhatsApp")}</label>
                  <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className={inputClass} placeholder="+57 300 000 0000" />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-site-muted-fg">{t("¿Qué necesitas?", "What do you need?")}</label>
                <select
                  required
                  value={necesidad}
                  onChange={(e) => setNecesidad(e.target.value)}
                  className={`${inputClass} appearance-none`}
                >
                  <option value="" disabled>
                    {t("Selecciona una opción", "Choose an option")}
                  </option>
                  {opcionesNecesidad.map((o) => (
                    <option key={o} value={o} className="bg-site-bg">
                      {o}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-site-muted-fg">
                  {t("Cuéntanos brevemente sobre tu proyecto", "Tell us briefly about your project")}
                </label>
                <textarea
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                  rows={4}
                  className={`${inputClass} resize-none`}
                  placeholder={t("¿Qué te gustaría resolver o automatizar?", "What would you like to solve or automate?")}
                />
              </div>

              {estado === "error" && errorMsg && <p className="text-[12.5px] text-red-400">{errorMsg}</p>}

              <button
                type="submit"
                disabled={estado === "enviando"}
                className="mt-1 inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-site-primary px-6 text-[13.5px] font-medium text-site-primary-fg transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {estado === "enviando" && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("Enviar solicitud", "Send request")} <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
