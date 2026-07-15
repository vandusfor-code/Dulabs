import Reveal from "./Reveal";

export default function Vision() {
  return (
    <section
      id="nosotros"
      className="cv-auto scroll-mt-20 border-y border-edge/60 bg-ink-2/50 py-28"
    >
      <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <Reveal className="mx-auto max-w-4xl text-center">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.25em] text-lime-text">
            Visión
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-fg sm:text-5xl">
            El futuro del software es{" "}
            <span className="text-shimmer">conversacional.</span>
          </h2>
          <p className="mt-8 text-lg leading-relaxed text-mist">
            Durante décadas aprendimos a usar software. Creemos que durante las
            próximas décadas el software aprenderá a hablar nuestro idioma.
          </p>
          <p className="mt-4 text-lg font-medium text-fg">
            Du Labs existe para construir ese futuro.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
