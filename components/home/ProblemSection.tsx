import { Caption, HomeSection, Panel, PanelBar, SectionHeader } from "./atoms";
import { retraso } from "./ChatBubbles";

// El problema, en corto. La bandeja no muestra cifras ni tiempos: son mensajes típicos, no una estadística.
const MENSAJES: { tipo: string; texto: string }[] = [
  { tipo: "Precio", texto: "Hola, ¿cuánto cuesta el corte de cabello?" },
  { tipo: "Cita", texto: "¿Tienen espacio mañana en la tarde?" },
  { tipo: "Cotización", texto: "¿Me cotizas manicure y pedicure?" },
  { tipo: "Cambio", texto: "Necesito cambiar mi cita del jueves." },
  { tipo: "Horario", texto: "¿Hasta qué hora atienden los sábados?" },
  { tipo: "Persona", texto: "Quiero hablar con alguien del equipo." },
];

export function ProblemSection() {
  return (
    <HomeSection id="problema" titleId="problema-titulo">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-center lg:gap-20">
        <SectionHeader eyebrow="El problema" titleId="problema-titulo" title="Tu WhatsApp ya es un canal de ventas y atención. Pero se atiende a mano.">
          <p>
            Precios, cotizaciones, citas, cambios de horario, seguimientos y datos que se piden una y otra vez. Cuando la atención al cliente por WhatsApp depende de una
            persona en cada conversación, las respuestas tardan y las oportunidades se enfrían.
          </p>
          <p className="mt-4 text-site-fg">DuLabs convierte esas conversaciones en procesos que se ejecutan solos, con las reglas de tu negocio.</p>
        </SectionHeader>

        <figure>
          <Panel>
            <PanelBar left="Bandeja de WhatsApp" right="sin responder" />
            <ul>
              {MENSAJES.map((m, i) => (
                <li key={m.tipo} className="home-seq flex items-start gap-3 border-t border-site-border px-4 py-3 first:border-t-0" style={retraso(150 + i * 170)}>
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-site-fg/45" />
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-site-muted-fg">{m.tipo}</p>
                    <p className="mt-0.5 text-[14px] leading-snug text-site-fg">{m.texto}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <Caption>Mensajes típicos de un WhatsApp de negocio.</Caption>
        </figure>
      </div>
    </HomeSection>
  );
}
