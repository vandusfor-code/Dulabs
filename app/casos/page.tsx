import type { Metadata } from "next";
import { Nav } from "@/components/site/Nav";
import { PageSpotlight } from "@/components/site/PageSpotlight";
import { JsonLd } from "@/components/site/JsonLd";
import { breadcrumbSchema } from "@/lib/schema";
import { ServiceBreadcrumb, ServiceRelated } from "@/components/site/ServicePage";
import { CasosSections } from "@/components/site/CasosSections";
import { Footer } from "@/components/site/Sections";

export const metadata: Metadata = {
  title: "Casos y proyectos | DuLabs",
  description:
    "Proyectos reales construidos por DuLabs: DuMo, un CRM para gestión de leads y ventas, y un asistente de WhatsApp con IA para atención y agendamiento de citas.",
  alternates: { canonical: "https://www.dulabs.co/casos" },
};

export default function CasosPage() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <JsonLd data={breadcrumbSchema([{ name: "Inicio", path: "/" }, { name: "Casos", path: "/casos" }])} />
      <PageSpotlight />
      <Nav />
      <main>
        <section className="relative pt-24 pb-14 md:pt-32 md:pb-16">
          <div className="mx-auto max-w-[1440px] px-6">
            <ServiceBreadcrumb items={[{ label: "Inicio", href: "/" }, { label: "Casos" }]} />
            <div className="mt-6 max-w-2xl">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.28em] text-site-primary">Casos</p>
              <h1 className="mt-4 font-display text-[34px] font-medium leading-[1.08] tracking-[-0.025em] text-site-fg md:text-[48px]">
                Lo que construimos
              </h1>
              <p className="mt-5 text-[15.5px] leading-relaxed text-site-muted-fg md:text-[16.5px]">
                Proyectos reales, no ejemplos hipotéticos. Así resolvimos el problema, con qué tecnología y qué
                quedó implementado en cada caso.
              </p>
            </div>
          </div>
        </section>

        <CasosSections />

        <ServiceRelated
          items={[
            { label: "CRM personalizado", href: "/crm-personalizado" },
            { label: "WhatsApp con IA", href: "/whatsapp-ia" },
            { label: "Soluciones Enterprise", href: "/soluciones-empresariales" },
          ]}
        />
      </main>
      <Footer />
    </div>
  );
}
