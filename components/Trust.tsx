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
    <section className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-5 rounded-2xl border border-edge bg-card/40 px-8 py-8">
            {pillars.map((pillar) => (
              <span
                key={pillar}
                className="flex items-center gap-2.5 text-sm font-medium text-white/85"
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-lime/15 text-[9px] text-lime">
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
