import type { Metadata } from "next";
import { CapabilitiesSection } from "@/components/home/CapabilitiesSection";
import { ContactSection } from "@/components/home/ContactSection";
import { CustomSolutionsSection } from "@/components/home/CustomSolutionsSection";
import { DevelopersSection } from "@/components/home/DevelopersSection";
import { FaqSection } from "@/components/home/FaqSection";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeNav } from "@/components/home/HomeNav";
import { HowItWorksSection } from "@/components/home/HowItWorksSection";
import { MoreThanWhatsappSection } from "@/components/home/MoreThanWhatsappSection";
import { SchedulingSection } from "@/components/home/SchedulingSection";
import { ScrollFx } from "@/components/home/ScrollFx";
import { WorkProcessSection } from "@/components/home/WorkProcessSection";
import { JsonLd } from "@/components/site/JsonLd";
import { Footer, PricingSection } from "@/components/site/Sections";
import { HOME_PATH } from "@/lib/home/links";
import { homeFaqJsonLd, homeMetadata, homeSoftwareApplicationJsonLd } from "@/lib/home/seo";

// Home principal ("/"). Metadata, imagen social y datos estructurados salen de lib/home/seo.ts (indexable, canónica a "/").
//
// UNA sola narrativa, de lo que el agente hace a cómo se contrata DuLabs para algo más grande:
//   hero -> capacidades del agente -> crea tu agente (flujo) -> agendamiento -> más que WhatsApp -> planes -> cómo trabajamos -> FAQ ->
//   a la medida (enterprise) -> developers -> contacto -> footer.
// Cada bloque tiene su propia interacción (índice, flujo por scroll, registro de eventos, selector con visualización, línea de tiempo,
// acordeón, red, código) sobre el mismo lenguaje: negro, blanco, grises, líneas finas y el azul de la aurora solo como señal tecnológica.
// ScrollFx es el único motor de animación por scroll (un IntersectionObserver). PricingSection y Footer son los componentes compartidos,
// en su variante "home". Organization y WebSite ya se publican desde app/layout.tsx.
export const metadata: Metadata = homeMetadata({ path: HOME_PATH, indexable: true });

export default function HomePage() {
  return (
    <div className="dev-scope home-scope min-h-screen">
      <JsonLd data={homeSoftwareApplicationJsonLd()} />
      <JsonLd data={homeFaqJsonLd()} />
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-site-fg focus:px-4 focus:py-2 focus:text-[14px] focus:text-site-bg"
      >
        Saltar al contenido
      </a>
      <HomeNav />
      <main id="contenido">
        <HomeHero />
        <CapabilitiesSection />
        <HowItWorksSection />
        <SchedulingSection />
        <MoreThanWhatsappSection />
        <PricingSection
          variante="home"
          showComparisonLink
          descripcion="Elige tu plan y crea tu agente desde el panel de DuLabs. Precios en pesos colombianos (COP)."
          notaImplementacion="Pago único que se suma al primer cobro; el desglose aparece antes de pagar."
          notaSuscripcion="Tu suscripción a DuLabs cubre la plataforma y el uso de la IA según el plan elegido."
        />
        <WorkProcessSection />
        <FaqSection />
        <CustomSolutionsSection />
        <DevelopersSection />
        <ContactSection />
      </main>
      <Footer variante="home" />
      <ScrollFx />
    </div>
  );
}
