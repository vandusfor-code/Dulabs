import type { Metadata } from "next";
import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/Hero";
import { Reveal } from "@/components/site/Reveal";
import { PageSpotlight } from "@/components/site/PageSpotlight";
import { JsonLd } from "@/components/site/JsonLd";
import { breadcrumbSchema } from "@/lib/schema";
import {
  TrustedBySection,
  HowItWorksSection,
  PricingSection,
  NextLevelSection,
  FeaturesGridSection,
  MetricsSection,
  FaqSection,
  FinalCta,
  Footer,
} from "@/components/site/Sections";
import { SolutionsSection, HowWeWorkSection, EnterpriseSection, EnterpriseContactSection } from "@/components/site/EnterpriseSections";

// Preview del diseño ANTERIOR (dark, componentes de components/site/*) con la
// INFORMACIÓN COMERCIAL ACTUAL -- no es el diseño en producción, no es la V2/V3.
// Estos mismos componentes ya se actualizaron en Fase 6 (antes de promover V2
// a "/") con: pricing Essential/Business/Pro/Enterprise (PLANES_WHATSAPP en
// Sections.tsx), cero legacy Start/Growth/Scale como oferta nueva, cero
// referencias a Claude/Anthropic. No se modificó nada aquí -- solo se vuelve
// a montar la misma estructura que ya existía en app/page.tsx antes de la
// migración (ver commit 5669930), para comparar visualmente. NO pública, NO
// indexada.
export const metadata: Metadata = {
  title: "DuLabs — Diseño anterior (revisión)",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  alternates: { canonical: undefined },
};

const FAQ_HOME_IDS = ["que-es-dulabs", "solo-whatsapp", "cancelar", "conexion", "quien-configura", "seguridad", "meta-cobra"];

export default function HomeDarkPreview() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <JsonLd data={breadcrumbSchema([{ name: "Inicio", path: "/newversion-dark" }])} />
      <PageSpotlight />
      <Nav />
      <main>
        <Hero />

        <TrustedBySection />

        <Reveal>
          <HowItWorksSection />
        </Reveal>

        <Reveal>
          <SolutionsSection />
        </Reveal>

        <Reveal>
          <PricingSection showComparisonLink />
        </Reveal>

        <Reveal>
          <NextLevelSection />
        </Reveal>

        <Reveal>
          <FeaturesGridSection />
        </Reveal>

        <Reveal>
          <MetricsSection />
        </Reveal>

        <Reveal>
          <HowWeWorkSection />
        </Reveal>

        <Reveal>
          <FaqSection ids={FAQ_HOME_IDS} showMoreLink />
        </Reveal>

        <FinalCta />

        <Reveal>
          <EnterpriseSection />
        </Reveal>

        <Reveal>
          <EnterpriseContactSection />
        </Reveal>
      </main>
      <Footer />
    </div>
  );
}
