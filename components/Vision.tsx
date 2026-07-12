import Reveal from "./Reveal";

export default function Vision() {
  return (
    <section
      id="nosotros"
      className="scroll-mt-20 border-y border-edge/60 bg-ink-2/50 py-28"
    >
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.25em] text-lime">
            Visión
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            El futuro del software es conversacional.
          </h2>
          <p className="mt-8 text-lg leading-relaxed text-mist">
            Durante décadas aprendimos a usar software. Creemos que durante las
            próximas décadas el software aprenderá a hablar nuestro idioma.
          </p>
          <p className="mt-4 text-lg font-medium text-white">
            Du Labs existe para construir ese futuro.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
