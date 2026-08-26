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
  title: "CRM personalizado para empresas | DuLabs",
  description:
    "Desarrollamos CRM a medida para gestionar leads, conversaciones, asignación y seguimiento de ventas, integrado con WhatsApp.",
  alternates: { canonical: "https://www.dulabs.co/crm-personalizado" },
};

const CAPACIDADES = [
  "Gestión de leads desde que entran hasta que se cierran.",
  "Conversaciones centralizadas, sin depender de un celular o un chat aparte.",
  "Asignación de leads o conversaciones al vendedor correcto.",
  "Seguimiento de ventas con el historial completo en un solo lugar.",
  "Automatización de recordatorios y próximos pasos.",
  "Dashboards para ver el estado real de tu embudo de ventas.",
  "Integración con WhatsApp para que las conversaciones alimenten el CRM.",
];

export default function CrmPersonalizadoPage() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Inicio", path: "/" },
          { name: "CRM personalizado", path: "/crm-personalizado" },
        ])}
      />
      <JsonLd
        data={serviceSchema({
          name: "CRM personalizado para empresas",
          description: "Desarrollo de CRM a medida para gestión de leads, conversaciones, asignación y seguimiento de ventas.",
          path: "/crm-personalizado",
        })}
      />
      <PageSpotlight />
      <Nav />
      <main>
        <ServiceHero
          breadcrumb={[{ label: "Inicio", href: "/" }, { label: "CRM personalizado" }]}
          eyebrow="CRM personalizado"
          title="CRM personalizado para empresas"
          description="Diseñamos y desarrollamos el CRM que se adapta a cómo vende tu empresa, no al revés: gestión de leads, conversaciones, asignación, seguimiento y ventas, con dashboards e integración con WhatsApp."
          ctaLabel="Hablar sobre mi proyecto"
          ctaHref={whatsappVentasUrl("Hola, quiero hablar sobre un CRM personalizado con DuLabs.")}
          ctaExternal
        />

        <Reveal>
          <ServiceCapabilities title="Qué incluye" items={CAPACIDADES} />
        </Reveal>

        <section className="relative border-t border-site-border py-16 md:py-20">
          <div className="mx-auto max-w-[1440px] px-6">
            <div className="rounded-2xl border border-site-border bg-site-card/50 p-6 md:p-8">
              <p className="font-mono text-[10px] uppercase tracking-widest text-site-primary">Un caso propio</p>
              <h3 className="mt-2 font-display text-[18px] font-medium text-site-fg">DuMo</h3>
              <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-site-muted-fg">
                DuMo es una solución desarrollada por DuLabs: un CRM para gestionar leads, conversaciones y ventas,
                integrado con WhatsApp. Es el mismo tipo de sistema que podemos construir a la medida de tu empresa.
              </p>
            </div>
          </div>
        </section>

        <ServiceCallout>
          No vendemos un CRM genérico. Construimos el sistema alrededor de cómo tu equipo realmente gestiona leads y
          conversaciones hoy.
        </ServiceCallout>

        <ServiceRelated
          items={[
            { label: "WhatsApp con IA", href: "/whatsapp-ia" },
            { label: "Integraciones", href: "/integraciones" },
            { label: "Software a medida", href: "/software-a-medida" },
          ]}
        />
      </main>
      <Footer />
    </div>
  );
}
