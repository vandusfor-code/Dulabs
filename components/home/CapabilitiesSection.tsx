import { ArrowRight, BookOpen, CalendarCheck, CalendarDays, Headset, MessageCircle, Tags, UserPlus, type LucideIcon } from "lucide-react";
import { CAPACIDADES_HOME } from "@/lib/home/capabilities";
import { Caption, HomeSection, SectionHeader } from "./atoms";
import { TrackedLink } from "./TrackedLink";

// Qué puede hacer tu agente: UNA sección compacta con las 7 capacidades (no una sección por capacidad). Cada tarjeta sale de
// lib/home/capabilities.ts, que un test contrasta con las capacidades reales del Runtime. La octava celda enlaza a la página con el detalle.
const ICONOS: Record<string, LucideIcon> = {
  responder: MessageCircle,
  informacion: BookOpen,
  catalogo: Tags,
  agendar: CalendarCheck,
  calendar: CalendarDays,
  leads: UserPlus,
  asesor: Headset,
};

export function CapabilitiesSection() {
  return (
    <HomeSection id="capacidades" titleId="capacidades-titulo">
      <SectionHeader eyebrow="Qué puede hacer tu agente" titleId="capacidades-titulo" title="Lo que tu agente hace por tu negocio.">
        <p>Todo con la información de tu negocio. Tú eliges qué capacidades activar y cómo se comporta.</p>
      </SectionHeader>

      <ul className="mt-8 grid border-t border-site-border sm:mt-10 sm:gap-3 sm:border-t-0 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4 xl:mt-12">
        {CAPACIDADES_HOME.map((c) => {
          const Icono = ICONOS[c.id];
          return (
            <li
              key={c.id}
              className="border-b border-site-border py-4 transition-colors last:border-b-0 sm:rounded-xl sm:border sm:border-b sm:bg-site-card/50 sm:p-5 sm:last:border-b sm:hover:border-white/20 xl:p-6"
            >
              <div className="flex items-center gap-3 sm:block">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-site-border bg-site-bg text-site-fg sm:size-9">
                  <Icono className="size-[18px]" strokeWidth={1.6} aria-hidden />
                </span>
                <h3 className="text-[16px] font-medium leading-snug tracking-tight text-site-fg sm:mt-5 xl:text-[17px]">{c.titulo}</h3>
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-site-muted-fg sm:mt-1.5 xl:text-[14.5px]">{c.texto}</p>
            </li>
          );
        })}
        <li>
          <TrackedLink
            href="/whatsapp-ia"
            source="capacidades_mas"
            className="group flex h-full min-h-14 items-center justify-between gap-4 py-3 text-[15px] text-site-fg transition-colors sm:min-h-[5.5rem] sm:rounded-xl sm:border sm:border-dashed sm:border-white/20 sm:p-5 sm:hover:border-white/40 xl:p-6"
          >
            <span>Ver todo lo que puede hacer</span>
            <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </TrackedLink>
        </li>
      </ul>

      <Caption>El agente no cobra ni toma pedidos: cuando el cliente quiere comprar, pasa la conversación a tu equipo.</Caption>
    </HomeSection>
  );
}
