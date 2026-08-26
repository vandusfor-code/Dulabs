import type { Metadata } from "next";
import { Nav } from "@/components/site/Nav";
import { PageSpotlight } from "@/components/site/PageSpotlight";
import { FaqSection, Footer } from "@/components/site/Sections";
import { JsonLd } from "@/components/site/JsonLd";
import { breadcrumbSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "Preguntas frecuentes | DuLabs",
  description:
    "Resolvemos las dudas más comunes sobre DuLabs: qué hacemos, cómo funciona una implementación, WhatsApp con IA, software a medida y proyectos Enterprise.",
  alternates: { canonical: "https://www.dulabs.co/preguntas-frecuentes" },
};

export default function PreguntasFrecuentesPage() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <JsonLd
        data={breadcrumbSchema([{ name: "Inicio", path: "/" }, { name: "Preguntas frecuentes", path: "/preguntas-frecuentes" }])}
      />
      <PageSpotlight />
      <Nav />
      <main className="pt-24 md:pt-28">
        <FaqSection />
      </main>
      <Footer />
    </div>
  );
}
