import type { Metadata } from "next";
import { JsonLd } from "@/components/site/JsonLd";
import { Footer } from "@/components/site/Sections";
import { breadcrumbSchema, softwareApplicationSchema } from "@/lib/schema";
import { DevNav } from "@/components/developer-platform/DevNav";
import { DevHero } from "@/components/developer-platform/DevHero";
import { DevPlataforma, DevApi, DevEventos, DevControl, DevProduccion } from "@/components/developer-platform/DevSections";
import { DevPricing } from "@/components/developer-platform/DevPricing";
import { DevDocsFaq, DevFinalCta } from "@/components/developer-platform/DevFaqCta";

// DuLabs Developer -- landing comercial PÚBLICA de la plataforma (CPaaS). Superficie distinta de /developers (docs) y de /developer
// (dashboard privado). Server component: metadata + JSON-LD reales; el contenido bilingüe vive en componentes cliente (useI18n).
//
// Una sola narrativa en 8 bloques: hero -> 01 plataforma (el sistema) -> 02 API (el request y su ciclo de vida) -> 03 webhooks y eventos
// -> 04 control (dashboard) -> 05 producción (controles + coexistencia) -> 06 pricing y docs (+ preguntas) -> 07 cierre.
// Sin Reveal genérico: cada bloque decide su propio movimiento (components/developer-platform/motion.ts).

const TITULO = "DuLabs Developer | WhatsApp Cloud API para developers: API, webhooks y eventos";
const DESCRIPCION =
  "Infraestructura sobre WhatsApp Cloud API oficial de Meta: envía mensajes con un POST, recibe webhooks firmados con HMAC-SHA256 y observa cada entrega. API keys, idempotencia, rate limits y workspaces.";

export const metadata: Metadata = {
  title: TITULO,
  description: DESCRIPCION,
  alternates: { canonical: "https://www.dulabs.co/developer-platform" },
  openGraph: {
    title: TITULO,
    description: DESCRIPCION,
    url: "https://www.dulabs.co/developer-platform",
    siteName: "DuLabs",
    images: [{ url: "/logo.png", width: 512, height: 512 }],
    locale: "es_CO",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITULO,
    description: DESCRIPCION,
    images: ["/logo.png"],
  },
};

export default function DeveloperPlatformPage() {
  return (
    <div className="dev-scope dp relative min-h-screen bg-dp-bg text-dp-text">
      <JsonLd data={breadcrumbSchema([{ name: "Inicio", path: "/" }, { name: "Developer", path: "/developer-platform" }])} />
      <JsonLd data={softwareApplicationSchema({ name: "DuLabs Developer", description: DESCRIPCION, path: "/developer-platform" })} />
      <DevNav />
      <main>
        <DevHero />
        <DevPlataforma />
        <DevApi />
        <DevEventos />
        <DevControl />
        <DevProduccion />
        <DevPricing>
          <DevDocsFaq />
        </DevPricing>
        <DevFinalCta />
      </main>
      <Footer />
    </div>
  );
}
