import type { Metadata } from "next";
import { JsonLd } from "@/components/site/JsonLd";
import { Footer } from "@/components/site/Sections";
import { breadcrumbSchema, softwareApplicationSchema } from "@/lib/schema";
import { DevNav } from "@/components/developer-platform/DevNav";
import { DevHero } from "@/components/developer-platform/DevHero";
import { Capacidades } from "@/components/developer-platform/Capacidades";
import { InfraProducto } from "@/components/developer-platform/InfraProducto";
import { DevApi } from "@/components/developer-platform/DevApi";
import { CasosDeUso } from "@/components/developer-platform/CasosDeUso";
import { DevWebhooks } from "@/components/developer-platform/DevWebhooks";
import { DevControl } from "@/components/developer-platform/DashboardPreview";
import { DevPricing } from "@/components/developer-platform/DevPricing";
import { DocsFaq } from "@/components/developer-platform/DocsFaq";
import { DeveloperCTA } from "@/components/developer-platform/DeveloperCTA";

// DuLabs Developer -- landing comercial PÚBLICA de la plataforma (CPaaS). Superficie distinta de /developers (docs) y de /developer
// (dashboard privado). Server component: metadata + JSON-LD reales; el contenido bilingüe vive en componentes cliente (useI18n).
//
// Recorrido mental: qué es -> qué puedo construir -> por qué -> cómo -> qué producto -> confianza -> precio -> cómo empiezo.
//   hero (la ruta de un mensaje, viva = «Plataforma») -> 01 qué puedes construir (8 capacidades, incl. coexistencia) -> 02 DuLabs resuelve
//   la infraestructura / tú el producto -> 03 API (request + ciclo de vida) -> 04 webhooks y eventos -> 05 casos de uso -> 06 control y
//   seguridad (dashboard + controles) -> 07 pricing -> 08 docs + preguntas -> cierre.
// Sin Reveal genérico: cada visualización explica un mecanismo real del producto y se mueve con el sistema de
// components/developer-platform/motion.ts (secuencias por bloque, en pausa fuera de pantalla, estáticas con reduced motion).

const TITULO = "DuLabs Developer | WhatsApp Cloud API para developers: API, webhooks y eventos";
const DESCRIPCION =
  "Infraestructura para construir sobre WhatsApp Cloud API oficial de Meta: API de mensajes, webhooks firmados con HMAC-SHA256, modo coexistencia y control de envíos. Construye agentes de IA, recordatorios, automatizaciones y envíos masivos.";

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
        <Capacidades />
        <InfraProducto />
        <DevApi />
        <DevWebhooks />
        <CasosDeUso />
        <DevControl />
        <DevPricing />
        <DocsFaq />
        <DeveloperCTA />
      </main>
      <Footer />
    </div>
  );
}
