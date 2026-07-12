import Reveal from "./Reveal";

const capabilities = [
  {
    title: "Memoria",
    description:
      "Cada conversación construye sobre la anterior. Nada se pierde, nada se repite.",
  },
  {
    title: "Contexto",
    description:
      "Entiende quién eres, qué necesitas y en qué momento de la conversación estás.",
  },
  {
    title: "Personalización",
    description:
      "Cada respuesta se adapta a la persona, al equipo y al negocio detrás del mensaje.",
  },
  {
    title: "Automatización",
    description:
      "De la conversación a la acción: agenda, registra, responde y ejecuta sin intervención.",
  },
  {
    title: "Aprendizaje continuo",
    description:
      "Los sistemas mejoran con cada interacción y se ajustan a cómo trabajas.",
  },
  {
    title: "Integraciones",
    description:
      "Conectado con las herramientas donde ya vive tu operación: CRM, ERP y más.",
  },
];

export default function Differential() {
  return (
    <section id="soluciones" className="scroll-mt-20 py-28">
      <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <Reveal className="mb-16 max-w-3xl">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.25em] text-lime">
            Diferencial
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            No construimos chatbots.
            <br />
            <span className="text-mist">
              Construimos sistemas que entienden conversaciones.
            </span>
          </h2>
        </Reveal>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((capability, i) => (
            <Reveal key={capability.title} delay={i * 60}>
              <div className="h-full rounded-2xl border border-edge bg-card/60 p-7 transition-colors duration-300 hover:border-lime/25">
                <span className="mb-5 flex h-9 w-9 items-center justify-center rounded-lg bg-lime/10 font-mono text-xs font-bold text-lime">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="text-lg font-semibold text-white">
                  {capability.title}
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-mist">
                  {capability.description}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
