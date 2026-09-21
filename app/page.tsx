import type { Metadata } from "next";
import { AgentActionsSection } from "@/components/home/AgentActionsSection";
import { BusinessTypesSection } from "@/components/home/BusinessTypesSection";
import { CatalogSection } from "@/components/home/CatalogSection";
import { ConfigSection } from "@/components/home/ConfigSection";
import { CustomSolutionsSection } from "@/components/home/CustomSolutionsSection";
import { DeveloperStrip } from "@/components/home/DeveloperStrip";
import { FaqSection } from "@/components/home/FaqSection";
import { FinalCta } from "@/components/home/FinalCta";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeNav } from "@/components/home/HomeNav";
import { KnowledgeSection } from "@/components/home/KnowledgeSection";
import { ProblemSection } from "@/components/home/ProblemSection";
import { SchedulingSection } from "@/components/home/SchedulingSection";
import { StepsSection } from "@/components/home/StepsSection";
import { TrackBand } from "@/components/home/TrackBand";
import { TrustSection } from "@/components/home/TrustSection";
import { JsonLd } from "@/components/site/JsonLd";
import { Footer, PricingSection } from "@/components/site/Sections";
import { HOME_PATH } from "@/lib/home/links";
import { homeFaqJsonLd, homeMetadata, homeSoftwareApplicationJsonLd } from "@/lib/home/seo";

// Home principal ("/"). Metadata, imagen social y datos estructurados salen de lib/home/seo.ts (indexable, canónica a "/").
//
// Estructura: hero -> 01 CREA TU AGENTE (agente estándar que el cliente configura solo, planes) -> 02 A LA MEDIDA (soluciones empresariales
// que DuLabs desarrolla con el cliente) -> confianza -> línea Developer (aparte de las dos) -> preguntas frecuentes -> cierre. PricingSection y Footer son los
// componentes existentes (PricingSection solo recibe tres frases propias de la home -- introducción y notas de cobro --; el resto no se toca). Organization y WebSite ya se publican desde app/layout.tsx.
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

        <TrackBand n="01" etiqueta="Crea tu agente" texto="Agente estándar: lo configuras tú mismo. Creas, configuras, pruebas, publicas y administras." />
        <ProblemSection />
        <AgentActionsSection />
        <SchedulingSection />
        <ConfigSection />
        <CatalogSection />
        <KnowledgeSection />
        <BusinessTypesSection />
        <StepsSection />
        <PricingSection
          showComparisonLink
          descripcion="Elige tu plan y crea tu agente desde el panel de DuLabs. Precios en pesos colombianos (COP)."
          notaImplementacion="Pago único que se suma al primer cobro; el desglose aparece antes de pagar."
          notaSuscripcion="Tu suscripción a DuLabs cubre la plataforma y el uso de la IA según el plan elegido."
        />

        <TrackBand n="02" etiqueta="A la medida" texto="Soluciones empresariales: DuLabs lo desarrolla contigo." />
        <CustomSolutionsSection />

        <TrustSection />
        <DeveloperStrip />
        <FaqSection />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
