import Reveal from "./Reveal";

export default function Philosophy() {
  return (
    <section className="border-y border-edge/60 bg-ink-2/50 py-28">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.25em] text-lime">
            Filosofía
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">
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
