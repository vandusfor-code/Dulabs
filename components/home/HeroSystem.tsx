import { Check } from "lucide-react";

// Visualización del hero: cuatro placas de vidrio en profundidad (Du IA -> Sistemas conectados -> Procesos automatizados -> Resultados
// reales), una señal que las recorre en bucle lento. Todo el 3D, los reflejos y la animación viven en globals.css (.home-system*, sin JS).
// Componente de servidor puro: solo estructura + texto real (indexable). El único acento de color es la señal verde de marca, aplicada en
// CSS (--home-signal), casi imperceptible en reposo. Se anula con prefers-reduced-motion.

const ETAPAS = [
  { id: "sistemas", l1: "Sistemas", l2: "conectados" },
  { id: "procesos", l1: "Procesos", l2: "automatizados" },
  { id: "resultados", l1: "Resultados", l2: "reales" },
] as const;

export function HeroSystem() {
  return (
    <figure className="home-system" aria-label="Sistema DuLabs: sistemas conectados, procesos automatizados y resultados reales.">
      <div className="home-system-stage">
        <div className="home-panel home-panel--lead">
          <span aria-hidden className="home-panel-streak" />
          <span aria-hidden className="home-panel-edge" />
          <div className="home-panel-mark">
            <span className="home-panel-word">Du</span>
            <span className="home-panel-sup">IA</span>
            <span aria-hidden className="home-panel-rule" />
          </div>
          <span aria-hidden className="home-panel-dot" />
        </div>

        {ETAPAS.map((e) => (
          <div key={e.id} className="home-panel">
            <span aria-hidden className="home-panel-edge" />
            <div className="home-panel-label">
              <span>{e.l1}</span>
              <span>{e.l2}</span>
              <span aria-hidden className="home-panel-tick" />
            </div>
            {e.id === "resultados" ? (
              <span aria-hidden className="home-panel-done">
                <Check strokeWidth={2.5} aria-hidden />
              </span>
            ) : null}
            <span aria-hidden className="home-panel-dot" />
          </div>
        ))}
      </div>
      <span aria-hidden className="home-system-floor" />
    </figure>
  );
}
