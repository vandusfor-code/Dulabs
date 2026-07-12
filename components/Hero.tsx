import Reveal from "./Reveal";
import ChatShowcase from "./ChatShowcase";

export default function Hero() {
  return (
    <section className="hero-glow relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-24">
      <div className="dot-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <Reveal className="mx-auto max-w-5xl text-center">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-edge bg-ink-2/80 px-4 py-1.5 text-xs text-mist">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" />
            Tecnología conversacional para personas y empresas
          </p>
          <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-6xl xl:text-7xl">
            La inteligencia artificial funciona mejor cuando vive donde ya
            hablas <span className="text-lime">todos los días.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-mist sm:text-xl">
            Creamos productos y soluciones que transforman WhatsApp en
            asistentes inteligentes capaces de organizar vidas, formar equipos
            y automatizar empresas.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <a
              href="#productos"
              className="rounded-lg bg-lime px-6 py-3 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-lime-hover"
            >
              Ver productos
            </a>
            <a
              href="#contacto"
              className="rounded-lg border border-edge px-6 py-3 text-sm text-white transition-colors duration-200 hover:border-mist/40"
            >
              Hablar con nosotros
            </a>
          </div>
        </Reveal>

        <Reveal delay={150} className="mt-16 sm:mt-20">
          <ChatShowcase />
        </Reveal>
      </div>
    </section>
  );
}
