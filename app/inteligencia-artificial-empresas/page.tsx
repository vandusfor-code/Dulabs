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
  title: "Soluciones de inteligencia artificial para empresas | DuLabs",
  description:
    "Diseñamos agentes de IA, asistentes internos y automatización con inteligencia artificial para empresas: para automatizar, asistir y mejorar procesos, no para reemplazar a tu equipo.",
  alternates: { canonical: "https://www.dulabs.co/inteligencia-artificial-empresas" },
};

const CAPACIDADES = [
  "Agentes de IA entrenados con la información real de tu negocio.",
  "Asistentes internos que ayudan a tu equipo a resolver dudas más rápido.",
  "Agentes de atención al cliente por WhatsApp u otros canales.",
  "Base de conocimiento empresarial que el agente consulta al responder.",
  "Automatización de tareas con IA: clasificar, resumir, responder, agendar.",
  "Análisis de información para apoyar decisiones, no para tomarlas solas.",
  "Integración de IA en procesos ya existentes, no procesos aislados.",
];

export default function InteligenciaArtificialEmpresasPage() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Inicio", path: "/" },
          { name: "Inteligencia artificial para empresas", path: "/inteligencia-artificial-empresas" },
        ])}
      />
      <JsonLd
        data={serviceSchema({
          name: "Soluciones de inteligencia artificial para empresas",
          description: "Agentes de IA, asistentes internos y automatización con inteligencia artificial para empresas.",
          path: "/inteligencia-artificial-empresas",
        })}
      />
      <PageSpotlight />
      <Nav />
      <main>
        <ServiceHero
          breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Inteligencia artificial" }]}
          eyebrow="Inteligencia artificial"
          title="Soluciones de inteligencia artificial para empresas"
          description="Diseñamos agentes y asistentes de IA que automatizan tareas, atienden clientes y ayudan a tu equipo a trabajar mejor. Nuestro enfoque no es reemplazar a las personas: es automatizar lo repetitivo, asistir en lo operativo y mejorar procesos que hoy toman más tiempo del necesario."
          ctaLabel="Hablar sobre mi proyecto"
          ctaHref={whatsappVentasUrl("Hola, quiero hablar sobre una solución de IA para mi empresa.")}
          ctaExternal
        />

        <Reveal>
          <ServiceCapabilities title="Qué construimos con IA" items={CAPACIDADES} />
        </Reveal>

        <ServiceCallout>
          La IA que construimos está pensada para automatizar, asistir y mejorar procesos — no para reemplazar
          completamente a tu equipo. El objetivo es que tus personas hagan menos trabajo repetitivo, no que dejen de
          ser necesarias.
        </ServiceCallout>

        <ServiceRelated
          items={[
            { label: "WhatsApp con IA", href: "/whatsapp-ia" },
            { label: "Automatización de procesos", href: "/automatizacion-empresas" },
            { label: "Software a medida", href: "/software-a-medida" },
          ]}
        />
      </main>
      <Footer />
    </div>
  );
}
