import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Nav } from "@/components/site/Nav";
import { PageSpotlight } from "@/components/site/PageSpotlight";
import { Reveal } from "@/components/site/Reveal";
import { JsonLd } from "@/components/site/JsonLd";
import { breadcrumbSchema } from "@/lib/schema";
import { ServiceBreadcrumb } from "@/components/site/ServicePage";
import { Footer } from "@/components/site/Sections";
import { ARTICULOS } from "@/lib/recursos";

export const metadata: Metadata = {
  title: "Recursos | DuLabs",
  description:
    "Artículos sobre IA, automatización, WhatsApp Business y CRM para empresas: guías prácticas escritas por el equipo de DuLabs.",
  alternates: { canonical: "https://www.dulabs.co/recursos" },
};

export default function RecursosPage() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <JsonLd data={breadcrumbSchema([{ name: "Inicio", path: "/" }, { name: "Recursos", path: "/recursos" }])} />
      <PageSpotlight />
      <Nav />
      <main>
        <section className="relative pt-24 pb-14 md:pt-32 md:pb-16">
          <div className="mx-auto max-w-[1440px] px-6">
            <ServiceBreadcrumb items={[{ label: "Inicio", href: "/" }, { label: "Recursos" }]} />
            <div className="mt-6 max-w-2xl">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.28em] text-site-primary">Recursos</p>
              <h1 className="mt-4 font-display text-[34px] font-medium leading-[1.08] tracking-[-0.025em] text-site-fg md:text-[48px]">
                Guías sobre IA, automatización y WhatsApp para empresas
              </h1>
              <p className="mt-5 text-[15.5px] leading-relaxed text-site-muted-fg md:text-[16.5px]">
                Contenido práctico sobre los temas que más nos preguntan los negocios con los que trabajamos.
              </p>
            </div>
          </div>
        </section>

        <section className="relative border-t border-site-border py-16">
          <div className="mx-auto max-w-[1440px] px-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {ARTICULOS.map((a, i) => (
                <Reveal key={a.slug} delay={i * 60}>
                  <Link
                    href={`/recursos/${a.slug}`}
                    className="group flex h-full flex-col rounded-2xl border border-site-border bg-site-card/50 p-6 transition-colors hover:border-white/20"
                  >
                    <h2 className="font-display text-[17px] font-medium leading-snug text-site-fg">{a.titulo}</h2>
                    <p className="mt-2.5 flex-1 text-[13.5px] leading-relaxed text-site-muted-fg">{a.resumen}</p>
                    <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-site-primary">
                      Leer artículo
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
