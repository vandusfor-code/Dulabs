import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/Hero";
import { Reveal } from "@/components/site/Reveal";
import { PageSpotlight } from "@/components/site/PageSpotlight";
import {
  CoexistenceSection,
  TrainingSection,
  KnowledgeSection,
  CampaignsSection,
  WhatsAppSection,
  PlatformOverviewSection,
  MetricsSection,
  GrowthSection,
  FinalCta,
  Footer,
} from "@/components/site/Sections";

export default function Home() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <PageSpotlight />
      <Nav />
      <main>
        <Hero />

        <Reveal>
          <MetricsSection />
        </Reveal>

        <Reveal>
          <CoexistenceSection />
        </Reveal>

        {/* Un agente por número — con nombre propio, no un rol genérico */}
        <TrainingSection />
        <KnowledgeSection />

        <Reveal>
          <CampaignsSection />
        </Reveal>

        {/* WhatsAppSection incluye la antigua grilla de infraestructura */}
        <Reveal>
          <WhatsAppSection />
        </Reveal>

        {/* PlatformOverviewSection incluye la antigua pestaña "Mensajes" */}
        <PlatformOverviewSection />

        {/* GrowthSection fusiona Escala + LatAm + Ecosistema en pestañas */}
        <GrowthSection />

        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
