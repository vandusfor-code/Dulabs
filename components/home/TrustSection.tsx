import { Caption, HomeSection, Panel, PanelBar, SectionHeader, Tag } from "./atoms";

// Confianza SIN prueba social: DuLabs no tiene clientes, logos, cifras ni testimonios verificables para publicar, así que la confianza
// se construye con hechos del producto y de la tecnología que se pueden comprobar en el código: conexión oficial con Meta (incluido el
// modo coexistencia), reglas que evalúa el sistema y no el modelo, publicación con validación y versiones, cifrado AES-256-GCM de tokens y
// claves, y producto propio (panel, DuMo, Developer). Nada de certificaciones ni resultados.

const HECHOS: { titulo: string; texto: string }[] = [
  {
    titulo: "WhatsApp",
    texto:
      "Conexión con la API oficial de WhatsApp Business Platform de Meta. Si ya usas WhatsApp Business en el celular, puedes conectar ese número en modo coexistencia, según los requisitos de Meta.",
  },
  { titulo: "Sin inventar", texto: "Los precios y servicios salen de tu catálogo; las respuestas, de tus preguntas y documentos. Si no hay información, el agente lo dice." },
  { titulo: "Publicación controlada", texto: "Vista previa simulada, validación de la configuración antes de publicar e historial de versiones." },
  { titulo: "Datos", texto: "Los tokens de acceso a Meta y las claves de IA se guardan cifrados con AES-256." },
  { titulo: "Producto propio", texto: "El panel de agentes, el CRM DuMo y la plataforma para developers con documentación pública son desarrollos de DuLabs." },
];

const LA_IA = ["Entiende el mensaje del cliente", "Redacta la respuesta", "Propone la acción a ejecutar"];
const EL_SISTEMA = ["Disponibilidad y horarios", "Precios y cotizaciones", "Reglas y prohibiciones", "Transferencia a una persona", "Validación y publicación"];

export function TrustSection() {
  return (
    <HomeSection id="confianza" titleId="confianza-titulo">
      <SectionHeader eyebrow="Confianza" titleId="confianza-titulo" title="Tecnología propia, con reglas claras.">
        <p>Esto es lo que puedes comprobar del producto: qué hace la IA, qué decide el sistema y cómo se publica un agente.</p>
      </SectionHeader>

      <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
        <dl className="divide-y divide-site-border border-y border-site-border">
          {HECHOS.map((h) => (
            <div key={h.titulo} className="grid gap-1.5 py-5 sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:gap-6">
              <dt className="text-[14.5px] font-medium text-site-fg">{h.titulo}</dt>
              <dd className="text-[14.5px] leading-relaxed text-site-muted-fg">{h.texto}</dd>
            </div>
          ))}
        </dl>

        <figure className="lg:sticky lg:top-28 lg:self-start">
          <Panel>
            <PanelBar left="La IA conversa. El sistema decide." />
            <div className="grid divide-y divide-site-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <div className="px-4 py-5 sm:px-5">
                <Tag tono="light">La IA</Tag>
                <ul className="mt-4 space-y-2.5 text-[14px] leading-snug text-site-fg">
                  {LA_IA.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
              <div className="px-4 py-5 sm:px-5">
                <Tag tono="accent">El sistema</Tag>
                <ul className="mt-4 space-y-2.5 text-[14px] leading-snug text-site-fg">
                  {EL_SISTEMA.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Panel>
          <Caption>Las reglas de tu negocio no dependen de lo que decida el modelo.</Caption>
        </figure>
      </div>
    </HomeSection>
  );
}
