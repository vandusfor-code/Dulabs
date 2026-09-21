// SEO de la home principal: metadata, imagen social y datos estructurados (SoftwareApplication + FAQPage). Todo sale de UNA definición para
// que la home ("/") y sus pruebas no puedan divergir.
//
// Reparto de palabras clave (evita canibalizar /whatsapp-ia, que conserva "WhatsApp con IA para empresas"):
//   Home  -> agentes de IA (para empresas y para WhatsApp) + automatización empresarial + IA para empresas.
//   /whatsapp-ia -> WhatsApp con IA.
// Organization y WebSite ya se publican en app/layout.tsx para todo el sitio: no se duplican aquí. SoftwareApplication va SIN `offers` ni
// ratings a propósito (los precios viven solo en lib/planes.ts y no hay reseñas que publicar), igual que el criterio de lib/schema.ts.
import type { Metadata } from "next";
import { CAPABILITY_BACKING, CAPABILITY_KEYS } from "@/lib/agent-compiler/spec/capabilities";
import { ETIQUETA_CAPACIDAD } from "./capabilities";
import { GRUPOS_FAQ, textoRespuesta, todasLasFaq } from "./faq";

export const SITE_URL = "https://www.dulabs.co";

export const HOME_SEO = {
  /** <= 60 caracteres. No contiene "WhatsApp con IA": esa frase es de /whatsapp-ia. */
  title: "Agentes de IA y automatización para empresas | DuLabs",
  /** <= 160 caracteres. */
  description: "Crea tu agente de IA para WhatsApp: agenda citas con Google Calendar y responde con tu catálogo. Y si necesitas más, automatización empresarial a la medida.",
  ogTitle: "DuLabs: crea tu agente de IA o pide automatización a la medida",
  ogDescription: "Crea, configura, prueba y publica tu agente de IA para WhatsApp desde el panel de DuLabs, sin programar. Y si necesitas más, desarrollamos automatización e integraciones a la medida.",
  ogImage: {
    url: "/og/dulabs-agentes-ia.png",
    width: 1200,
    height: 630,
    alt: "DuLabs: agentes de IA que hacen más que responder",
  },
  descripcionAplicacion:
    "Plataforma para crear agentes de IA que atienden a clientes por WhatsApp, agendan citas con Google Calendar, responden con el catálogo y el conocimiento del negocio y transfieren la conversación a una persona.",
} as const;

/**
 * Metadata de la home: { path: "/", indexable: true } (indexable, canónica a sí misma). Con `indexable: false` emite noindex/nofollow.
 * Con `indexable: false` NO se declara una canónica hacia "/" (Google desaconseja mezclar noindex con canónicas hacia otra URL).
 */
export function homeMetadata({ path, indexable }: { path: string; indexable: boolean }): Metadata {
  const imagen = { ...HOME_SEO.ogImage };
  return {
    title: { absolute: HOME_SEO.title },
    description: HOME_SEO.description,
    alternates: { canonical: path },
    robots: indexable
      ? { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } }
      : { index: false, follow: false },
    openGraph: {
      title: HOME_SEO.ogTitle,
      description: HOME_SEO.ogDescription,
      url: path,
      siteName: "DuLabs",
      locale: "es_CO",
      type: "website",
      images: [imagen],
    },
    twitter: {
      card: "summary_large_image",
      title: HOME_SEO.ogTitle,
      description: HOME_SEO.ogDescription,
      images: [{ url: imagen.url, alt: imagen.alt }],
    },
  };
}

/** SoftwareApplication: `featureList` sale de las capacidades con respaldo real en el Runtime (las mismas etiquetas que muestra la página). */
export function homeSoftwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "DuLabs",
    url: `${SITE_URL}/`,
    description: HOME_SEO.descripcionAplicacion,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: "es-CO",
    featureList: CAPABILITY_KEYS.filter((k) => CAPABILITY_BACKING[k].available).map((k) => ETIQUETA_CAPACIDAD[k]),
    publisher: { "@type": "Organization", name: "DuLabs", url: `${SITE_URL}/` },
  };
}

/** FAQPage: cada pregunta/respuesta es EXACTAMENTE la que se ve en la página (misma fuente: lib/home/faq.ts). */
export function homeFaqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: "es-CO",
    mainEntity: todasLasFaq().map((item) => ({
      "@type": "Question",
      name: item.pregunta,
      acceptedAnswer: { "@type": "Answer", text: textoRespuesta(item) },
    })),
  };
}

export const TOTAL_FAQ = GRUPOS_FAQ.reduce((n, g) => n + g.items.length, 0);
