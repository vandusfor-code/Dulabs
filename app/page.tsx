import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/Hero";
import { Reveal } from "@/components/site/Reveal";
import { PageSpotlight } from "@/components/site/PageSpotlight";
import {
  HowItWorksSection,
  PricingSection,
  NextLevelSection,
  FeaturesGridSection,
  MetricsSection,
  FaqSection,
  FinalCta,
  Footer,
} from "@/components/site/Sections";

const FAQ_HOME_IDS = ["cancelar", "conexion", "quien-configura", "seguridad", "meta-cobra"];

export default function Home() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <PageSpotlight />
      <Nav />
      <main>
        <Hero />

        <Reveal>
          <HowItWorksSection />
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
          <FaqSection ids={FAQ_HOME_IDS} showMoreLink />
        </Reveal>

        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
