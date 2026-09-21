import { ConfigWizard } from "./ConfigWizard";
import { HomeSection, SectionHeader } from "./atoms";

// Configuración: el negocio configura su agente sin programar. Réplica del asistente real + el recorrido configurar -> probar -> publicar
// (pestañas Vista previa y Publicar del producto: la vista previa es una conversación SIMULADA; publicar valida que la configuración esté
// completa, guarda cada versión y conecta el agente a un número de WhatsApp).
const ETAPAS: { n: string; titulo: string; texto: string }[] = [
  { n: "01", titulo: "Crea", texto: "Empiezas tu agente eligiendo el tipo de negocio y cómo se presenta." },
  { n: "02", titulo: "Configura", texto: "Completas los pasos con la información de tu negocio." },
  { n: "03", titulo: "Prueba", texto: "La vista previa simula conversaciones con tu agente: no envía WhatsApp real ni ejecuta acciones de negocio." },
  { n: "04", titulo: "Publica", texto: "El sistema revisa que la configuración esté completa, guarda la versión y conecta el agente a tu número de WhatsApp." },
  { n: "05", titulo: "Administra", texto: "Cambias lo que necesites cuando quieras y publicas una versión nueva; queda el historial." },
];

export function ConfigSection() {
  return (
    <HomeSection id="configuracion" titleId="configuracion-titulo">
      <SectionHeader eyebrow="Configuración sin programar" titleId="configuracion-titulo" title="Configura tu negocio. DuLabs lo convierte en un agente.">
        <p>
          Crea agentes de IA configurables con un asistente paso a paso: cargas tus servicios, horarios y conocimiento, y DuLabs traduce esa información en el comportamiento del
          agente, lo valida y lo publica en tu WhatsApp. Lo creas, lo configuras y lo administras tú mismo, sin necesidad de programar.
        </p>
      </SectionHeader>

      <div className="mt-14">
        <ConfigWizard />
      </div>

      <ol className="mt-14 grid gap-8 border-t border-site-border pt-8 sm:grid-cols-2 lg:grid-cols-5 lg:gap-8">
        {ETAPAS.map((e) => (
          <li key={e.n}>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-site-fg">
              <span className="text-site-muted-fg">{e.n}</span> · {e.titulo}
            </p>
            <p className="mt-2.5 text-[14.5px] leading-relaxed text-site-muted-fg">{e.texto}</p>
          </li>
        ))}
      </ol>
    </HomeSection>
  );
}
