import type { Metadata } from "next";
import { CapabilitiesSection } from "@/components/home/CapabilitiesSection";
import { CustomSolutionsSection } from "@/components/home/CustomSolutionsSection";
import { FaqSection } from "@/components/home/FaqSection";
import { FinalCta } from "@/components/home/FinalCta";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeNav } from "@/components/home/HomeNav";
import { HowItWorksSection } from "@/components/home/HowItWorksSection";
import { SchedulingSection } from "@/components/home/SchedulingSection";
import { JsonLd } from "@/components/site/JsonLd";
import { Footer, PricingSection } from "@/components/site/Sections";
import { HOME_PATH } from "@/lib/home/links";
import { homeFaqJsonLd, homeMetadata, homeSoftwareApplicationJsonLd } from "@/lib/home/seo";

// Home principal ("/"). Metadata, imagen social y datos estructurados salen de lib/home/seo.ts (indexable, canónica a "/").
//
// La home es la PUERTA DE ENTRADA al producto, no el sitio completo: 8 bloques y nada más. La profundidad (qué es un agente, seguridad,
// integraciones, soluciones empresariales, Developer, casos, FAQ completa) vive en las páginas internas y se enlaza desde aquí.
//   1 hero (+ las dos vías: Crea tu agente / A la medida) · 2 qué puede hacer tu agente · 3 cómo funciona Crea tu agente (crea -> configura ->
//   prueba -> publica -> administra) · 4 agendamiento · 5 planes · 6 A la medida · 7 preguntas frecuentes (8) · 8 cierre.
// PricingSection y Footer son los componentes existentes (PricingSection solo recibe tres frases propias de la home -- introducción y notas de
// cobro --; su ancho lo amplía globals.css acotado a .home-scope). Organization y WebSite ya se publican desde app/layout.tsx.
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
        <PricingSection
          showComparisonLink
          descripcion="Elige tu plan y crea tu agente desde el panel de DuLabs. Precios en pesos colombianos (COP)."
          notaImplementacion="Pago único que se suma al primer cobro; el desglose aparece antes de pagar."
          notaSuscripcion="Tu suscripción a DuLabs cubre la plataforma y el uso de la IA según el plan elegido."
        />
        <CustomSolutionsSection />
        <FaqSection />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
