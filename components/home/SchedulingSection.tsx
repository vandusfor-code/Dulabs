import { Check } from "lucide-react";
import { ENLACE_FLECHA, HomeSection, SectionHeader } from "./atoms";
import { TrackedLink } from "./TrackedLink";

// Agendamiento: un flujo compacto Cliente -> Agente -> Google Calendar -> Cita creada. Solo lo esencial; el detalle técnico vive en las
// páginas internas. Refleja lo que el agente hace hoy: identificar el servicio, consultar la disponibilidad REAL en Google Calendar (la calcula
// el sistema con horarios y duración, no la IA) y crear la cita. Los datos (jueves, 3:30 p. m.) son un ejemplo y así se rotula.
const NODOS = [
  { etiqueta: "Cliente", titulo: "Escribe por WhatsApp", texto: "«Quiero una cita el jueves en la tarde.»" },
  { etiqueta: "Agente", titulo: "Entiende y organiza", texto: "Identifica el servicio y pide los horarios libres." },
  { etiqueta: "Google Calendar", titulo: "Disponibilidad real", texto: "Horarios de atención, duración del servicio y eventos que ya tienes." },
  { etiqueta: "Cita creada", titulo: "Confirmada al cliente", texto: "Jueves · 3:30 p. m. Queda en tu calendario." },
] as const;

export function SchedulingSection() {
  return (
    <HomeSection id="agendamiento" titleId="agendamiento-titulo">
      <div className="grid gap-8 lg:grid-cols-2 lg:items-end lg:gap-16">
        <SectionHeader eyebrow="Agendamiento" titleId="agendamiento-titulo" title="De la conversación a la cita confirmada." />
        <div>
          <p className="max-w-[40rem] text-[16px] leading-[1.65] text-site-muted-fg md:text-[17px]">
            El agente ofrece solo horarios libres de tu Google Calendar y crea la cita cuando el cliente elige. La disponibilidad y las reglas las calcula el sistema: la IA nunca
            inventa un horario.
          </p>
          <TrackedLink href="/integraciones" source="agendamiento_integraciones" className={`mt-2 ${ENLACE_FLECHA}`}>
            Ver integraciones
            <span aria-hidden className="transition-transform group-hover/enlace:translate-x-0.5">→</span>
          </TrackedLink>
        </div>
      </div>

      <figure className="mt-10 xl:mt-12" aria-label="Flujo de agendamiento: cliente, agente, Google Calendar y cita creada">
        <ol className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          {NODOS.map((n, i) => {
            const ultimo = i === NODOS.length - 1;
            return (
              <li
                key={n.etiqueta}
                className={`relative rounded-xl border p-4 sm:p-5 xl:p-6 ${ultimo ? "border-white/30 bg-dev-accent-soft" : "border-site-border bg-site-card/50"}`}
              >
                <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-site-muted-fg">
                  {ultimo ? <Check className="size-3.5 text-site-fg" strokeWidth={2.5} aria-hidden /> : <span className="text-site-muted-fg">{String(i + 1).padStart(2, "0")}</span>}
                  <span className={ultimo ? "text-site-fg" : ""}>{n.etiqueta}</span>
                </p>
                <p className="mt-3 text-[18px] font-medium leading-snug tracking-tight text-site-fg sm:mt-4">{n.titulo}</p>
                <p className="mt-2 text-[14.5px] leading-relaxed text-site-muted-fg">{n.texto}</p>
                {!ultimo ? (
                  <span
                    aria-hidden
                    className="absolute -bottom-[14px] left-1/2 z-10 grid size-6 -translate-x-1/2 place-items-center rounded-full border border-site-border bg-site-bg text-[11px] text-site-muted-fg md:hidden"
                  >
                    ↓
                  </span>
                ) : null}
                {!ultimo ? (
                  <span
                    aria-hidden
                    className="absolute -right-[14px] top-1/2 z-10 hidden size-6 -translate-y-1/2 place-items-center rounded-full border border-site-border bg-site-bg text-[11px] text-site-muted-fg lg:grid"
                  >
                    →
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        <figcaption className="mt-4 font-mono text-[11px] leading-relaxed text-site-muted-fg">
          Ejemplo ilustrativo. Cancelar y reprogramar desde WhatsApp funciona con Google Calendar conectado.
        </figcaption>
      </figure>
    </HomeSection>
  );
}
