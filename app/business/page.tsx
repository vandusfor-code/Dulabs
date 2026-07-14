import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";
import PlanButton from "@/components/PlanButton";

export const metadata: Metadata = {
  title: "Du IA Business — API Oficial de WhatsApp con IA | Du Labs",
  description:
    "Conecta tu WhatsApp Business a la API Oficial de Meta, envía mensajes masivos autorizados y atiende con IA en Modo Coexistencia. Sin bloqueos ni baneos.",
};

type Pillar = {
  numero: string;
  titulo: string;
  descripcion: string;
};

const pilares: Pillar[] = [
  {
    numero: "01",
    titulo: "Cero Bloqueos — API Oficial de Meta",
    descripcion:
      "Al conectarte mediante el flujo oficial de Meta (Embedded Signup), tu negocio opera bajo las reglas legales de WhatsApp. Sin trucos raros ni extensiones de navegador que arriesguen tu línea. Tu número queda blindado contra suspensiones, garantizando estabilidad total.",
  },
  {
    numero: "02",
    titulo: "Envío de Mensajes Masivos Autorizados",
    descripcion:
      "Llega a cientos de clientes de un solo golpe de forma segura. Utiliza las plantillas oficiales aprobadas por Meta para enviar campañas de marketing, promociones o recordatorios masivos sin miedo a ser marcado como spam.",
  },
  {
    numero: "03",
    titulo: "Inteligencia Artificial en Modo Coexistencia",
    descripcion:
      "Entrena a la IA desde tu dashboard con tus precios y horarios. Disfruta de lo mejor de dos mundos: el bot atiende en la nube 24/7, pero tú sigues viendo los chats y puedes responder desde tu aplicación móvil de WhatsApp normal cuando quieras.",
  },
];

type Plan = {
  nombre: string;
  precio: string;
  destacado?: boolean;
  idealPara: string;
  incluye: string[];
};

const planes: Plan[] = [
  {
    nombre: "Plan Básico",
    precio: "$59.990",
    idealPara: "Emprendedores y pequeños negocios locales.",
    incluye: [
      "Conexión de 1 número de WhatsApp",
      "Automatización de IA básica (Modo Coexistencia)",
      "Soporte estándar por correo",
      "Hasta 1.000 mensajes procesados por mes",
      "Acceso a métricas básicas",
    ],
  },
  {
    nombre: "Plan Pro",
    precio: "$129.990",
    destacado: true,
    idealPara: "Negocios en crecimiento y marcas comerciales.",
    incluye: [
      "Todo lo del Plan Básico",
      "Envío de Mensajes Masivos (Módulo de Campañas)",
      "IA Avanzada con mayor memoria de contexto",
      "Hasta 5.000 mensajes procesados por mes",
      "Soporte prioritario por WhatsApp",
      "Plantillas de Meta ilimitadas",
    ],
  },
  {
    nombre: "Plan Enterprise",
    precio: "$299.990",
    idealPara: "Grandes empresas y operaciones de alta demanda.",
    incluye: [
      "Todo lo del Plan Pro",
      "Mensajes ilimitados (aplican costos directos de Meta)",
      "Múltiples agentes en paralelo",
      "Integración a medida con CRM/ERP",
      "Soporte dedicado 24/7 y entrenamiento personalizado del prompt de la IA",
    ],
  },
];

export default function BusinessPage() {
  return (
    <>
      <Header />
      <main>
        <section className="hero-glow relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-24">
          <div className="dot-grid pointer-events-none absolute inset-0" />
          <div className="aurora aurora-a" aria-hidden />
          <div className="aurora aurora-b" aria-hidden />
          <div className="relative mx-auto w-full max-w-[1440px] px-5 text-center sm:px-8 lg:px-12">
            <p className="rise rise-d1 mb-6 inline-flex items-center gap-2 rounded-full border border-edge bg-ink-2/80 px-4 py-1.5 text-xs text-mist">
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-lime" />
              Du IA Business
            </p>
            <h1 className="rise rise-d2 mx-auto max-w-4xl text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-6xl">
              La forma oficial y segura de{" "}
              <span className="text-shimmer">automatizar tu WhatsApp.</span>
            </h1>
            <p className="rise rise-d3 mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-mist">
              API Oficial de Meta, mensajes masivos autorizados e IA en Modo
              Coexistencia — todo desde un solo panel, sin arriesgar tu número.
            </p>
          </div>
        </section>

        <section className="cv-auto scroll-mt-20 py-20">
          <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <Reveal className="mb-16 max-w-3xl">
              <p className="mb-4 text-xs font-medium uppercase tracking-[0.25em] text-lime">
                Por qué Du IA Business
              </p>
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                Tres pilares técnicos que blindan tu operación.
              </h2>
            </Reveal>

            <div className="grid gap-8 lg:grid-cols-3">
              {pilares.map((pilar, i) => (
                <Reveal key={pilar.numero} delay={i * 100}>
                  <article className="h-full rounded-3xl border border-edge bg-card/60 p-8 transition-[border-color,transform,box-shadow] duration-300 hover:-translate-y-1 hover:border-lime/25 hover:shadow-[0_20px_60px_-24px_rgba(198,255,61,0.12)]">
                    <span className="text-sm font-semibold text-lime">
                      {pilar.numero}
                    </span>
                    <h3 className="mt-4 text-xl font-semibold tracking-tight text-white">
                      {pilar.titulo}
                    </h3>
                    <p className="mt-4 leading-relaxed text-mist">
                      {pilar.descripcion}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="cv-auto scroll-mt-20 py-20">
          <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <Reveal className="mb-16 max-w-3xl">
              <p className="mb-4 text-xs font-medium uppercase tracking-[0.25em] text-lime">
                Planes
              </p>
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                Un plan para cada etapa de tu negocio.
              </h2>
              <p className="mt-5 leading-relaxed text-mist">
                Precios en pesos colombianos (COP), cobro recurrente mensual.
              </p>
            </Reveal>

            <div className="grid gap-8 lg:grid-cols-3">
              {planes.map((plan, i) => (
                <Reveal key={plan.nombre} delay={i * 100}>
                  <article
                    className={`flex h-full flex-col rounded-3xl border p-8 transition-[border-color,transform,box-shadow] duration-300 sm:p-10 ${
                      plan.destacado
                        ? "border-lime/50 bg-card lg:-translate-y-4 lg:scale-[1.02]"
                        : "border-edge bg-card/60 hover:-translate-y-1 hover:border-lime/25"
                    }`}
                  >
                    {plan.destacado && (
                      <span className="mb-5 inline-flex w-fit items-center rounded-full bg-lime/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-lime">
                        Recomendado
                      </span>
                    )}
                    <h3 className="text-xl font-semibold text-white">
                      {plan.nombre}
                    </h3>
                    <p className="mt-4 flex items-baseline gap-1.5">
                      <span className="text-4xl font-semibold tracking-tight text-white">
                        {plan.precio}
                      </span>
                      <span className="text-sm text-mist">COP / mes</span>
                    </p>
                    <p className="mt-4 text-sm text-mist">
                      Ideal para: {plan.idealPara}
                    </p>
                    <ul className="mt-8 flex flex-col gap-3">
                      {plan.incluye.map((item) => (
                        <li
                          key={item}
                          className="flex items-start gap-3 text-sm leading-relaxed text-white/85"
                        >
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
                          {item}
                        </li>
                      ))}
                    </ul>
                    <PlanButton
                      plan={plan.nombre}
                      className={`mt-10 inline-flex items-center justify-center rounded-lg px-6 py-3 text-sm font-semibold transition-[background-color,transform] duration-200 hover:-translate-y-0.5 active:scale-[0.97] ${
                        plan.destacado
                          ? "btn-shine bg-lime text-ink hover:bg-lime-hover"
                          : "border border-edge text-white hover:border-mist/40"
                      }`}
                    />
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="cv-auto py-28">
          <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <Reveal>
              <div className="hero-glow relative overflow-hidden rounded-3xl border border-edge bg-ink-2/80 px-8 py-20 text-center sm:px-16">
                <div className="dot-grid pointer-events-none absolute inset-0" />
                <div className="relative">
                  <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                    ¿Listo para transformar la atención de tu negocio?
                  </h2>
                  <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
                    <Link
                      href="/dashboard/conexion"
                      className="btn-shine rounded-lg bg-lime px-6 py-3 text-sm font-semibold text-ink transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97]"
                    >
                      Conectar mi WhatsApp Business Ahora
                    </Link>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
