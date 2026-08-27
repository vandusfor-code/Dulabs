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

const FAQ_HOME_IDS = ["que-es-dulabs", "solo-whatsapp", "cancelar", "conexion", "quien-configura", "seguridad", "meta-cobra"];

export default function Home() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <JsonLd data={breadcrumbSchema([{ name: "Inicio", path: "/" }])} />
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
