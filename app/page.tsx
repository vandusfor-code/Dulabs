import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/Hero";
import { Reveal } from "@/components/site/Reveal";
import {
  CoexistenceSection,
  TrainingSection,
  KnowledgeSection,
  CampaignsSection,
  WhatsappInfraSection,
  WhatsAppSection,
  InboxSection,
  PlatformOverviewSection,
  MetricsSection,
  ScaleSection,
  LatamSection,
  EcosystemSection,
  PricingSection,
  FaqSection,
  FinalCta,
  Footer,
} from "@/components/site/Sections";

export default function Home() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <Nav />
      <main>
        <Hero />

        <Reveal>
          <CoexistenceSection />
        </Reveal>

        {/* Un agente por número — con nombre propio, no un rol genérico */}
        <TrainingSection />
        <KnowledgeSection />

        <Reveal>
          <CampaignsSection />
        </Reveal>

        <WhatsappInfraSection />

        <Reveal>
          <WhatsAppSection />
        </Reveal>
        <Reveal>
          <InboxSection />
        </Reveal>

        <PlatformOverviewSection />

        <Reveal>
          <MetricsSection />
        </Reveal>

        <ScaleSection />
        <LatamSection />
        <EcosystemSection />

        <Reveal>
          <PricingSection />
        </Reveal>
        <Reveal>
          <FaqSection />
        </Reveal>

        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
