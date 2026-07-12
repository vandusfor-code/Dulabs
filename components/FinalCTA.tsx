import Reveal from "./Reveal";

export default function FinalCTA() {
  return (
    <section id="contacto" className="scroll-mt-20 py-28">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <div className="hero-glow relative overflow-hidden rounded-3xl border border-edge bg-ink-2/80 px-8 py-20 text-center sm:px-16">
            <div className="dot-grid pointer-events-none absolute inset-0" />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Construyamos juntos la próxima generación de experiencias
                conversacionales.
              </h2>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
                <a
                  href="mailto:hola@dulabs.co?subject=Solicitud%20de%20demo"
                  className="rounded-lg bg-lime px-6 py-3 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-lime-hover"
                >
                  Solicitar demo
                </a>
                <a
                  href="https://wa.me/573000000000"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-edge px-6 py-3 text-sm text-white transition-colors duration-200 hover:border-mist/40"
                >
                  Hablar por WhatsApp
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
