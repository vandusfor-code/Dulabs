import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { ENLACE_FLECHA, HomeSection, SectionHeader } from "./atoms";
import { TrackedLink } from "./TrackedLink";

// Agendamiento: el flujo Cliente -> Agente -> Google Calendar -> Cita creada presentado como un REGISTRO DE EVENTOS (filas con actor y
// resultado, unidas por una línea vertical), no como tarjetas. Al entrar en pantalla las filas aparecen en orden y la línea avanza de un
// evento al siguiente UNA vez (CSS, data-fx); el último nodo confirma en verde. Refleja lo que el agente hace hoy: identificar el servicio, consultar la disponibilidad REAL en
// Google Calendar (la calcula el sistema con horarios y duración, no la IA) y crear la cita. Los datos (jueves, 3:30 p. m.) son un ejemplo.
const NODOS = [
  { etiqueta: "Cliente", titulo: "Escribe por WhatsApp", texto: "«Quiero una cita el jueves en la tarde.»" },
  { etiqueta: "Agente", titulo: "Entiende y organiza", texto: "Identifica el servicio y pide los horarios libres." },
  { etiqueta: "Google Calendar", titulo: "Disponibilidad real", texto: "Horarios de atención, duración del servicio y eventos que ya tienes." },
  { etiqueta: "Cita creada", titulo: "Confirmada al cliente", texto: "Jueves · 3:30 p. m. Queda en tu calendario." },
] as const;

const d = (i: number): CSSProperties => ({ ["--fx-d" as string]: `${200 + i * 420}ms` });

export function SchedulingSection() {
  return (
    <HomeSection id="agendamiento" titleId="agendamiento-titulo">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20 xl:gap-28">
        <div className="lg:self-center">
          <SectionHeader eyebrow="Agendamiento" titleId="agendamiento-titulo" title="De la conversación a la cita confirmada." />
          <p className="mt-5 max-w-[34rem] text-[16px] leading-[1.65] text-site-muted-fg md:text-[17px]">
            El agente ofrece solo horarios libres de tu Google Calendar y crea la cita cuando el cliente elige. La disponibilidad y las reglas las calcula el sistema: la IA nunca
            inventa un horario.
          </p>
          <TrackedLink href="/integraciones" source="agendamiento_integraciones" className={`mt-4 ${ENLACE_FLECHA}`}>
            Ver integraciones
            <span aria-hidden className="transition-transform group-hover/enlace:translate-x-0.5">→</span>
          </TrackedLink>
        </div>

        <figure data-fx className="home-log" aria-label="Flujo de agendamiento: cliente, agente, Google Calendar y cita creada">
          <div className="flex items-center justify-between border-b border-site-border pb-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-site-muted-fg">
            <span>agenda · flujo</span>
            <span className="flex items-center gap-2">
              <span aria-hidden className="home-log-vivo" />
              Ejemplo
            </span>
          </div>
          <ol className="relative">
            {NODOS.map((n, i) => {
              const ultimo = i === NODOS.length - 1;
              return (
                <li key={n.etiqueta} className={`home-log-fila ${ultimo ? "home-log-fila--ok" : ""}`} style={d(i)}>
                  <span aria-hidden className="home-log-nodo">
                    {ultimo ? <Check className="size-2.5" strokeWidth={3} /> : null}
                  </span>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-site-muted-fg">
                    <span className="mr-2 text-white/35">{String(i + 1).padStart(2, "0")}</span>
                    <span className={ultimo ? "text-site-fg" : ""}>{n.etiqueta}</span>
                  </p>
                  <div className="mt-2 md:mt-0">
                    <p className="text-[17px] font-medium leading-snug tracking-tight text-site-fg">{n.titulo}</p>
                    <p className="mt-1 text-[14.5px] leading-relaxed text-site-muted-fg">{n.texto}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <figcaption className="mt-5 font-mono text-[11px] leading-relaxed text-site-muted-fg">
            Ejemplo ilustrativo. Cancelar y reprogramar desde WhatsApp funciona con Google Calendar conectado.
          </figcaption>
        </figure>
      </div>
    </HomeSection>
  );
}
