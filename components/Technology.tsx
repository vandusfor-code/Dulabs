import Reveal from "./Reveal";

const stack = ["WhatsApp", "OpenAI", "Claude", "Gemini", "Meta", "Google Cloud"];

export default function Technology() {
  return (
    <section
      id="tecnologia"
      className="scroll-mt-20 border-y border-edge/60 bg-ink-2/50 py-24"
    >
      <div className="mx-auto w-full max-w-[1440px] px-5 text-center sm:px-8 lg:px-12">
        <Reveal>
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.25em] text-lime">
            Tecnología
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Construido sobre infraestructura empresarial.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-mist">
            Utilizamos la mejor tecnología disponible para construir soluciones
            fiables, seguras y escalables.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
            {stack.map((name) => (
              <span
                key={name}
                className="text-lg font-semibold tracking-tight text-mist/50 transition-colors duration-300 hover:text-mist"
              >
                {name}
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
