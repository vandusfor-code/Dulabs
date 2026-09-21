import type { Metadata } from "next";
import { AgentActionsSection } from "@/components/home/AgentActionsSection";
import { CatalogSection } from "@/components/home/CatalogSection";
import { ConfigSection } from "@/components/home/ConfigSection";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeNav } from "@/components/home/HomeNav";
import { KnowledgeSection } from "@/components/home/KnowledgeSection";
import { PathsBridge } from "@/components/home/PathsBridge";
import { ProblemSection } from "@/components/home/ProblemSection";
import { SchedulingSection } from "@/components/home/SchedulingSection";
import { Footer } from "@/components/site/Sections";
import { HOME_V3_PATH } from "@/lib/home/links";

// Home principal v3 -- RUTA TEMPORAL DE REVISIÓN. noindex/nofollow y fuera de sitemap.ts: no compite con "/" ni se indexa.
// Al promoverla a "/", esta metadata se reemplaza por la definitiva (Fase 5: SEO) y esta ruta se elimina.
export const metadata: Metadata = {
  title: "DuLabs | Agentes de IA y automatización para empresas (borrador)",
  description: "Borrador de la nueva home de DuLabs. No indexable.",
  robots: { index: false, follow: false },
  alternates: { canonical: HOME_V3_PATH },
};

export default function HomeV3Page() {
  return (
    <div className="dev-scope home-scope min-h-screen">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-site-fg focus:px-4 focus:py-2 focus:text-[14px] focus:text-site-bg"
      >
        Saltar al contenido
      </a>
      <HomeNav />
      <main id="contenido">
        <HomeHero />
        <ProblemSection />
        <AgentActionsSection />
        <SchedulingSection />
        <ConfigSection />
        <CatalogSection />
        <KnowledgeSection />
        <PathsBridge />
      </main>
      <Footer />
    </div>
  );
}
