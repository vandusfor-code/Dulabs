import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/Hero";
import {
  CoexistenceSection,
  CampaignsSection,
  WhatsAppSection,
  TrainingSection,
  InboxSection,
  MetricsSection,
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
        <CoexistenceSection />
        <CampaignsSection />
        <WhatsAppSection />
        <TrainingSection />
        <InboxSection />
        <MetricsSection />
        <PricingSection />
        <FaqSection />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
