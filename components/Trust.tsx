import Reveal from "./Reveal";

const pillars = [
  "Productos activos",
  "Infraestructura propia",
  "API oficial de WhatsApp",
  "IA empresarial",
  "Automatizaciones reales",
];

export default function Trust() {
  return (
    <section className="cv-auto py-20">
      <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <Reveal>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-5 rounded-2xl border border-edge bg-card/40 px-8 py-8">
            {pillars.map((pillar) => (
              <span
                key={pillar}
                className="group flex items-center gap-2.5 text-sm font-medium text-fg/85 transition-colors duration-200 hover:text-fg"
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-lime/15 text-[9px] text-lime-text transition-transform duration-300 group-hover:scale-125">
                  ✓
                </span>
                {pillar}
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
