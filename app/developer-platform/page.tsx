import type { Metadata } from "next";
import { Reveal } from "@/components/site/Reveal";
import { JsonLd } from "@/components/site/JsonLd";
import { Footer } from "@/components/site/Sections";
import { breadcrumbSchema, softwareApplicationSchema } from "@/lib/schema";
import { DevNav } from "@/components/developer-platform/DevNav";
import { DevHero } from "@/components/developer-platform/DevHero";
import { DevPlatform, DevApiFirst, DevWebhooks, DevObservability, DevSecurity, DevDocs } from "@/components/developer-platform/DevSections";
import { DevPricing } from "@/components/developer-platform/DevPricing";
import { DevFaq, DevFinalCta } from "@/components/developer-platform/DevFaqCta";

// DuLabs Developer V1 -- Fase 15. Landing comercial PÚBLICA de la plataforma
// Developer (CPaaS). Superficie distinta de /developers (docs, Fase 14) y de
// /developer (dashboard privado). Server component: metadata + JSON-LD reales;
// el contenido bilingüe se renderiza en componentes cliente (useI18n).

const TITULO = "DuLabs Developer | API de WhatsApp, webhooks y eventos";
const DESCRIPCION =
  "Plataforma CPaaS para construir sobre WhatsApp: envía mensajes por API, recibe eventos por webhook firmados con HMAC y observa cada entrega. API keys, workspaces, idempotencia y rate limits.";

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
    <div className="dev-scope relative min-h-screen bg-site-bg text-site-fg">
      <JsonLd data={breadcrumbSchema([{ name: "Inicio", path: "/" }, { name: "Developer", path: "/developer-platform" }])} />
      <JsonLd data={softwareApplicationSchema({ name: "DuLabs Developer", description: DESCRIPCION, path: "/developer-platform" })} />
      <DevNav />
      <main>
        <DevHero />
        <Reveal><DevPlatform /></Reveal>
        <Reveal><DevApiFirst /></Reveal>
        <Reveal><DevWebhooks /></Reveal>
        <Reveal><DevObservability /></Reveal>
        <Reveal><DevSecurity /></Reveal>
        <Reveal><DevPricing /></Reveal>
        <Reveal><DevDocs /></Reveal>
        <Reveal><DevFaq /></Reveal>
        <DevFinalCta />
      </main>
      <Footer />
    </div>
  );
}
