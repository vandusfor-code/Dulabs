import Reveal from "./Reveal";

export default function Philosophy() {
  return (
    <section className="cv-auto border-y border-edge/60 bg-ink-2/50 py-28">
      <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <Reveal className="mx-auto max-w-4xl text-center">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.25em] text-lime-text">
            Filosofía
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-fg sm:text-5xl">
            Menos aplicaciones.
            <br />
            Más conversaciones.
          </h2>
          <p className="mt-8 text-lg leading-relaxed text-mist">
            Creemos que las personas no necesitan otra aplicación más.
            Necesitan herramientas que vivan donde ya trabajan, aprenden y se
            comunican. Por eso construimos inteligencia artificial que funciona
            dentro de las conversaciones diarias.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
