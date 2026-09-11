import type { Metadata } from "next";
import { Nav } from "@/components/site/Nav";
import { PageSpotlight } from "@/components/site/PageSpotlight";
import { PricingSection, NextLevelSection, FaqSection, Footer } from "@/components/site/Sections";
import { JsonLd } from "@/components/site/JsonLd";
import { breadcrumbSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "Precios | DuLabs — Automatización, IA y Software",
  description:
    "Planes de DuLabs para automatizar tu empresa con IA, WhatsApp Business Platform, CRM e integraciones: Essential, Business, Pro y Enterprise.",
  alternates: { canonical: "https://www.dulabs.co/precios" },
};

export default function PreciosPage() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <JsonLd data={breadcrumbSchema([{ name: "Inicio", path: "/" }, { name: "Precios", path: "/precios" }])} />
      <PageSpotlight />
      <Nav />
      <main className="pt-24 md:pt-28">
        <PricingSection />
        <NextLevelSection />
        <FaqSection />
      </main>
      <Footer />
    </div>
  );
}
