import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { Nav } from "@/components/site/Nav";
import { PageSpotlight } from "@/components/site/PageSpotlight";
import { Reveal } from "@/components/site/Reveal";
import { JsonLd } from "@/components/site/JsonLd";
import { breadcrumbSchema, serviceSchema } from "@/lib/schema";
import { ServiceBreadcrumb } from "@/components/site/ServicePage";
import { SolutionsSection, EnterpriseContactSection } from "@/components/site/EnterpriseSections";
import { Footer } from "@/components/site/Sections";

export const metadata: Metadata = {
  title: "Soluciones Enterprise para empresas | DuLabs",
  description:
    "Diseñamos e implementamos soluciones tecnológicas a medida para empresas: IA, automatización, software, integraciones y sistemas internos. Cotización personalizada según el alcance del proyecto.",
  alternates: { canonical: "https://www.dulabs.co/soluciones-empresariales" },
};

export default function SolucionesEmpresarialesPage() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Inicio", path: "/" },
          { name: "Soluciones Enterprise", path: "/soluciones-empresariales" },
        ])}
      />
      <JsonLd
        data={serviceSchema({
          name: "Soluciones tecnológicas a medida para empresas",
          description: "Proyectos Enterprise a medida: IA, automatización, software, integraciones y sistemas internos, con cotización personalizada.",
          path: "/soluciones-empresariales",
        })}
      />
      <PageSpotlight />
      <Nav />
      <main>
        <section className="relative pt-24 pb-16 md:pt-32 md:pb-20">
          <div className="mx-auto max-w-[1440px] px-6">
            <ServiceBreadcrumb items={[{ label: "Inicio", href: "/" }, { label: "Soluciones Enterprise" }]} />
            <div className="mt-6 max-w-2xl">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-site-primary/25 bg-site-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-site-primary">
                <Building2 className="h-3 w-3" /> Enterprise
              </span>
              <h1 className="mt-4 font-display text-[34px] font-medium leading-[1.08] tracking-[-0.025em] text-site-fg md:text-[48px]">
                Soluciones tecnológicas a medida para empresas
              </h1>
              <p className="mt-5 text-[15.5px] leading-relaxed text-site-muted-fg md:text-[16.5px]">
                No todas las empresas tienen los mismos procesos. Diseñamos e implementamos soluciones alrededor de
                las necesidades reales de cada organización: IA, automatización, software, integraciones, datos y
                sistemas internos. El tiempo depende del alcance del proyecto.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  href="#contacto"
                  className="group inline-flex h-11 items-center rounded-full bg-site-primary px-5 text-[13.5px] font-medium text-site-primary-fg transition-all hover:brightness-110"
                >
                  Cuéntanos tu proyecto
                  <span aria-hidden className="ml-1.5 transition-transform group-hover:translate-x-0.5">→</span>
                </a>
                <span className="inline-flex h-11 items-center rounded-full border border-site-border bg-site-card px-5 text-[13.5px] font-medium text-site-muted-fg">
                  Cotización personalizada
                </span>
              </div>
            </div>
          </div>
        </section>

        <Reveal>
          <SolutionsSection />
        </Reveal>

        <Reveal>
          <EnterpriseContactSection />
        </Reveal>
      </main>
      <Footer />
    </div>
  );
}
