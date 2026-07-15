import Link from "next/link";
import Reveal from "./Reveal";
import ChatShowcase from "./ChatShowcase";

export default function Hero() {
  return (
    <section className="hero-glow relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-24">
      <div className="dot-grid pointer-events-none absolute inset-0" />
      <div className="aurora aurora-a" aria-hidden />
      <div className="aurora aurora-b" aria-hidden />
      <div className="relative mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-5xl text-center">
          <p className="rise rise-d1 mb-6 inline-flex items-center gap-2 rounded-full border border-edge bg-ink-2/80 px-4 py-1.5 text-xs text-mist">
            <span className="typing-dot h-1.5 w-1.5 rounded-full bg-lime" />
            Tecnología conversacional para personas y empresas
          </p>
          <h1 className="rise rise-d2 text-4xl font-semibold leading-[1.08] tracking-tight text-fg sm:text-6xl xl:text-7xl">
            La inteligencia artificial funciona mejor cuando vive donde ya
            hablas <span className="text-shimmer">todos los días.</span>
          </h1>
          <p className="rise rise-d3 mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-mist sm:text-xl">
            Automatiza tu WhatsApp Business con Inteligencia Artificial
            utilizando la API Oficial de Meta. Olvídate de los bloqueos y
            baneos de números, envía mensajes masivos autorizados a tus
            clientes y mantén el control total respondiendo en paralelo desde
            tu celular con nuestro Modo Coexistencia.
          </p>
          <div className="rise rise-d4 mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/business"
              className="btn-shine rounded-lg bg-lime px-6 py-3 text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97]"
            >
              Activar mi API Oficial →
            </Link>
            <a
              href="#contacto"
              className="rounded-lg border border-edge px-6 py-3 text-sm text-fg transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-mist/40"
            >
              Hablar con nosotros
            </a>
          </div>
        </div>

        <Reveal delay={150} className="mt-16 sm:mt-20">
          <ChatShowcase />
        </Reveal>
      </div>
    </section>
  );
}
