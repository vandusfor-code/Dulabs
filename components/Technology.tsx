import Reveal from "./Reveal";

const stack = ["WhatsApp", "OpenAI", "Claude", "Gemini", "Meta", "Google Cloud"];

export default function Technology() {
  return (
    <section
      id="tecnologia"
      className="cv-auto scroll-mt-20 border-y border-edge/60 bg-ink-2/50 py-24"
    >
      <div className="mx-auto w-full max-w-[1440px] px-5 text-center sm:px-8 lg:px-12">
        <Reveal>
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.25em] text-lime-text">
            Tecnología
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
            Construido sobre infraestructura empresarial.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-mist">
            Utilizamos la mejor tecnología disponible para construir soluciones
            fiables, seguras y escalables.
          </p>
        </Reveal>
        <Reveal delay={120} variant="zoom">
          <div className="marquee-mask mt-12">
            <div className="marquee flex items-center gap-20">
              {[...stack, ...stack].map((name, i) => (
                <span
                  key={i}
                  aria-hidden={i >= stack.length}
                  className="whitespace-nowrap text-xl font-semibold tracking-tight text-mist/50 transition-colors duration-300 hover:text-lime-text"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
