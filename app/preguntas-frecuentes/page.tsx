import { Nav } from "@/components/site/Nav";
import { PageSpotlight } from "@/components/site/PageSpotlight";
import { FaqSection, Footer } from "@/components/site/Sections";

export default function PreguntasFrecuentesPage() {
  return (
    <div className="relative min-h-screen bg-site-bg text-site-fg">
      <div className="site-grain" aria-hidden />
      <PageSpotlight />
      <Nav />
      <main className="pt-24 md:pt-28">
        <FaqSection />
      </main>
      <Footer />
    </div>
  );
}
