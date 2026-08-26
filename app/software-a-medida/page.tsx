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
  title: "Desarrollo de software a medida | DuLabs",
  description:
    "Desarrollamos plataformas web, sistemas internos, dashboards y herramientas empresariales cuando una solución estándar no se adapta a tu proceso.",
  alternates: { canonical: "https://www.dulabs.co/software-a-medida" },
};

const CAPACIDADES = [
  "Plataformas web para operar tu negocio o atender a tus clientes.",
  "Sistemas internos hechos para la forma en que realmente trabaja tu equipo.",
  "Dashboards para ver en un solo lugar lo que hoy está disperso.",
  "Herramientas empresariales que automatizan una parte específica de tu operación.",
  "Portales para clientes, aliados o equipos internos.",
  "Aplicaciones a la medida de un proceso concreto de tu empresa.",
  "Sistemas personalizados diseñados desde cero alrededor de tu caso.",
];

export default function SoftwareAMedidaPage() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Inicio", path: "/" },
          { name: "Software a medida", path: "/software-a-medida" },
        ])}
      />
      <JsonLd
        data={serviceSchema({
          name: "Desarrollo de software a medida",
          description: "Desarrollo de plataformas web, sistemas internos, dashboards y herramientas empresariales personalizadas.",
          path: "/software-a-medida",
        })}
      />
      <PageSpotlight />
      <Nav />
      <main>
        <ServiceHero
          breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Software a medida" }]}
          eyebrow="Software a medida"
          title="Desarrollo de software a medida"
          description="Cuando una solución estándar no se adapta a tu proceso, construimos la herramienta que necesitas: plataformas, sistemas internos, dashboards y aplicaciones diseñadas alrededor de tu negocio."
          ctaLabel="Hablar sobre mi proyecto"
          ctaHref={whatsappVentasUrl("Hola, quiero hablar sobre un proyecto de software a medida con DuLabs.")}
          ctaExternal
        />

        <Reveal>
          <ServiceCapabilities title="Qué desarrollamos" items={CAPACIDADES} />
        </Reveal>

        <ServiceCallout>
          Cuando una solución estándar no se adapta a tu proceso, construimos la herramienta que necesitas — desde
          cero, alrededor de cómo trabaja tu empresa, no al revés.
        </ServiceCallout>

        <ServiceRelated
          items={[
            { label: "CRM personalizado", href: "/crm-personalizado" },
            { label: "Integraciones", href: "/integraciones" },
            { label: "Soluciones Enterprise", href: "/soluciones-empresariales" },
          ]}
        />
      </main>
      <Footer />
    </div>
  );
}
