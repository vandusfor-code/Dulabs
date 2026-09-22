import Image from "next/image";
import { Check } from "lucide-react";
import { Agente, Cliente, retraso } from "./ChatBubbles";

// Producto del hero: una conversación de agendamiento por WhatsApp junto a lo que el agente hizo por detrás. Es HTML/CSS real
// (texto seleccionable e indexable), sin imágenes ni JS. La secuencia aparece UNA vez (no en bucle) y se anula con
// prefers-reduced-motion. Todo lo que muestra corresponde a acciones que el agente ejecuta hoy: identificar el servicio del
// catálogo, consultar disponibilidad en Google Calendar (la calcula el sistema con horarios y duración, no la IA) y crear la cita.
// Los datos (servicio, precio, horarios) son un EJEMPLO y así se rotula.

function Accion({ ms, titulo, detalle, estado }: { ms: number; titulo: string; detalle: string; estado?: string }) {
  return (
    <li className="home-seq flex items-start gap-3 py-2.5" style={retraso(ms)}>
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-dev-accent-soft text-site-fg">
        <Check className="size-2.5" strokeWidth={3} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-tight text-site-fg xl:text-[14.5px]">{titulo}</p>
        <p className="mt-0.5 font-mono text-[11px] leading-snug text-site-muted-fg xl:text-[12px]">{detalle}</p>
      </div>
      {estado ? <span className="shrink-0 rounded-md border border-site-border px-1.5 py-0.5 font-mono text-[10px] text-site-muted-fg">{estado}</span> : null}
    </li>
  );
}

export function HeroProduct() {
  return (
    <figure className="relative w-full lg:justify-self-end" aria-label="Ejemplo de una conversación de un agente de DuLabs agendando una cita">
      <div className="home-seq overflow-hidden rounded-xl border border-site-border bg-site-card" style={retraso(40)}>
        <div className="flex items-center justify-between gap-3 border-b border-site-border px-4 py-3 xl:px-6 xl:py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <Image src="/logo.png" alt="" width={24} height={24} className="rounded-full" />
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-medium leading-tight text-site-fg xl:text-[14px]">Agente DuLabs</p>
              <p className="truncate font-mono text-[10.5px] leading-tight text-site-muted-fg">WhatsApp · Cloud API oficial</p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-site-muted-fg">
            <span className="dev-live-dot size-1.5 rounded-full bg-site-fg" />
            activo
          </span>
        </div>

        <div className="space-y-2.5 px-4 py-4 sm:px-5 sm:py-5 xl:space-y-3.5 xl:px-6 xl:py-7">
          <Cliente ms={300}>Hola, quiero una manicure para el jueves en la tarde.</Cliente>
          <Agente ms={1800}>
            <p>Manicure básica · 30&nbsp;min · $30.000. Estos son los horarios libres del jueves:</p>
            <p className="mt-2 flex flex-wrap gap-1.5">
              {["2:00 p. m.", "3:30 p. m.", "5:00 p. m."].map((h, i) => (
                <span key={h} className="rounded-md border border-site-border bg-site-bg px-2 py-0.5 font-mono text-[12px] text-site-fg xl:px-2.5 xl:py-1 xl:text-[13px]">
                  <span className="text-site-muted-fg">{i + 1}</span> {h}
                </span>
              ))}
            </p>
            <p className="mt-2">¿Cuál prefieres?</p>
          </Agente>
          <Cliente ms={3000}>La segunda.</Cliente>
          <Agente ms={3900}>Listo. Tu cita de manicure básica quedó agendada para el jueves a las 3:30&nbsp;p.&nbsp;m.</Agente>
        </div>

        <div className="border-t border-site-border px-4 pb-2 pt-3.5 sm:px-5 xl:px-6 xl:pt-5">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-site-muted-fg">Lo que hizo el agente</p>
          <ol className="mt-1 divide-y divide-site-border">
            <Accion ms={800} titulo="Servicio identificado" detalle="Manicure básica · 30 min" />
            <Accion ms={1300} titulo="Disponibilidad consultada" detalle="Google Calendar · horarios del negocio" />
            <Accion ms={3500} titulo="Cita creada" detalle="Jueves · 3:30 p. m." estado="confirmada" />
          </ol>
        </div>
      </div>

      <figcaption className="mt-3 font-mono text-[11px] text-site-muted-fg">Ejemplo ilustrativo de una conversación de agendamiento.</figcaption>
    </figure>
  );
}
