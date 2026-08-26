import type { Metadata } from "next";
import { Nav } from "@/components/site/Nav";
import { PageSpotlight } from "@/components/site/PageSpotlight";
import { Reveal } from "@/components/site/Reveal";
import { JsonLd } from "@/components/site/JsonLd";
import { breadcrumbSchema, serviceSchema } from "@/lib/schema";
import { ServiceHero, ServiceCapabilities, ServiceCallout, ServiceRelated } from "@/components/site/ServicePage";
import { Footer } from "@/components/site/Sections";
import { whatsappVentasUrl } from "@/lib/site-contact";

export const metadata: Metadata = {
  title: "Automatización de procesos empresariales | DuLabs",
  description:
    "Automatizamos tareas repetitivas, notificaciones, seguimiento y flujos operativos de tu empresa, conectando las herramientas que ya usas.",
  alternates: { canonical: "https://www.dulabs.co/automatizacion-empresas" },
};

const CAPACIDADES = [
  "Tareas repetitivas que hoy hace una persona manualmente.",
  "Notificaciones automáticas de eventos: citas, pagos, solicitudes nuevas.",
  "Seguimiento de clientes o leads sin que se te olvide escribirles.",
  "Asignación de conversaciones o tareas al miembro correcto del equipo.",
  "Flujos operativos de varios pasos que hoy dependen de coordinación manual.",
  "Procesos administrativos repetitivos: recordatorios, confirmaciones, reportes.",
  "Integraciones entre las herramientas que ya usa tu empresa.",
];

const EJEMPLOS_REALES = [
  {
    titulo: "Recordatorios automáticos de citas",
    desc: "El sistema le escribe al cliente antes de su cita sin que nadie tenga que revisar la agenda manualmente.",
  },
  {
    titulo: "Aviso inmediato de solicitudes nuevas",
    desc: "Cuando entra una solicitud de proyecto o una cita nueva, el negocio recibe el aviso por WhatsApp al instante.",
  },
  {
    titulo: "Asignación de conversaciones al agente correcto",
    desc: "Cada conversación se asigna automáticamente a la persona del equipo responsable de atenderla.",
  },
];

export default function AutomatizacionEmpresasPage() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Inicio", path: "/" },
          { name: "Automatización", path: "/automatizacion-empresas" },
        ])}
      />
      <JsonLd
        data={serviceSchema({
          name: "Automatización de procesos empresariales",
          description: "Automatización de tareas repetitivas, notificaciones, seguimiento y flujos operativos para empresas.",
          path: "/automatizacion-empresas",
        })}
      />
      <PageSpotlight />
      <Nav />
      <main>
        <ServiceHero
          breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Automatización" }]}
          eyebrow="Automatización"
          title="Automatización de procesos empresariales"
          description="Identificamos las tareas que le quitan tiempo a tu equipo y las convertimos en procesos automáticos, conectando las herramientas que ya usa tu empresa."
          ctaLabel="Automatizar mi proceso"
          ctaHref={whatsappVentasUrl("Hola, quiero automatizar un proceso de mi empresa con DuLabs.")}
          ctaExternal
        />

        <Reveal>
          <ServiceCapabilities title="Qué podemos automatizar" items={CAPACIDADES} />
        </Reveal>

        <section className="relative border-t border-site-border py-16 md:py-20">
          <div className="mx-auto max-w-[1440px] px-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">Ejemplos que ya construimos</p>
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              {EJEMPLOS_REALES.map((e) => (
                <div key={e.titulo} className="rounded-2xl border border-site-border bg-site-card/50 p-5">
                  <h3 className="font-display text-[15px] font-medium text-site-fg">{e.titulo}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-site-muted-fg">{e.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <ServiceCallout>
          No automatizamos por automatizar. Entendemos tu proceso primero y diseñamos la automatización alrededor de la
          forma en que realmente trabaja tu equipo.
        </ServiceCallout>

        <ServiceRelated
          items={[
            { label: "WhatsApp con IA", href: "/whatsapp-ia" },
            { label: "Integraciones", href: "/integraciones" },
            { label: "Inteligencia artificial para empresas", href: "/inteligencia-artificial-empresas" },
          ]}
        />
      </main>
      <Footer />
    </div>
  );
}
