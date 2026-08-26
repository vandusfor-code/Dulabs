import { Bot, Database } from "lucide-react";
import { Reveal } from "./Reveal";

type Caso = {
  icon: typeof Bot;
  nombre: string;
  tagline: string;
  problema: string;
  solucion: string;
  tecnologia: string[];
  implementado: string[];
};

const CASOS: Caso[] = [
  {
    icon: Database,
    nombre: "DuMo",
    tagline: "CRM para gestión de leads, conversaciones y ventas.",
    problema:
      "Gestionar leads y conversaciones de WhatsApp sin una herramienta centralizada: información dispersa entre chats, hojas de cálculo y memoria del equipo, sin visibilidad clara del embudo de ventas.",
    solucion:
      "Un CRM propio, desarrollado por DuLabs, con bandeja de conversaciones centralizada, asignación de leads al vendedor correcto y seguimiento del proceso de venta en un solo lugar.",
    tecnologia: ["Next.js", "Supabase", "WhatsApp Business Platform"],
    implementado: [
      "Bandeja de mensajes centralizada por negocio",
      "Asignación y etiquetado de conversaciones",
      "Seguimiento de leads y estado de venta",
      "Dashboard de actividad del equipo",
    ],
  },
  {
    icon: Bot,
    nombre: "Spa de belleza — Montería",
    tagline: "Asistente de WhatsApp con IA para atención y gestión de citas.",
    problema:
      "Un negocio de servicios de belleza recibía solicitudes de citas por WhatsApp de forma completamente manual, con riesgo de choques de horario y tiempo de respuesta lento fuera de horario de atención.",
    solucion:
      "Un asistente de WhatsApp con IA que atiende consultas sobre servicios y precios, y recibe solicitudes de cita por chat para que el equipo las confirme manualmente.",
    tecnologia: ["WhatsApp Business Platform (Meta Cloud API)", "Claude (Anthropic)", "Supabase"],
    implementado: [
      "Atención automática con base de conocimiento de servicios y precios",
      "Recepción de solicitudes de cita por WhatsApp",
      "Asistente con IA entrenado con el tono del negocio",
      "El equipo confirma las citas manualmente",
    ],
  },
];

export function CasosSections() {
  return (
    <section className="relative py-4">
      <div className="mx-auto max-w-[1440px] px-6">
        <div className="flex flex-col gap-8">
          {CASOS.map((caso, i) => (
            <Reveal key={caso.nombre} delay={i * 80}>
              <div className="rounded-3xl border border-site-border bg-site-card/50 p-6 md:p-10">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-site-primary/10 ring-1 ring-site-primary/20">
                    <caso.icon className="h-5 w-5 text-site-primary" />
                  </div>
                  <div>
                    <h2 className="font-display text-[20px] font-medium tracking-tight text-site-fg md:text-[24px]">
                      {caso.nombre}
                    </h2>
                    <p className="mt-1 text-[13.5px] text-site-muted-fg">{caso.tagline}</p>
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">Problema</p>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-site-fg/90">{caso.problema}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">Solución</p>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-site-fg/90">{caso.solucion}</p>
                  </div>
                </div>

                <div className="mt-8 border-t border-site-border pt-6">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">Qué se implementó</p>
                  <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {caso.implementado.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-[13px] text-site-fg/85">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-site-primary" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 flex flex-wrap gap-1.5 border-t border-site-border pt-5">
                  {caso.tecnologia.map((t) => (
                    <span key={t} className="rounded-full border border-site-border bg-black/20 px-2.5 py-1 font-mono text-[10px] text-site-muted-fg">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
