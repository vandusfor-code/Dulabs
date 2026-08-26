// Helpers de datos estructurados (JSON-LD, schema.org). Solo tipos que
// realmente corresponden a DuLabs -- Organization (no LocalBusiness: el
// footer ya decidió deliberadamente no publicar dirección física por
// privacidad, y LocalBusiness implica un local que se visita). Nada de
// teléfonos, ratings, reseñas ni certificaciones que no existen.

const SITE_URL = "https://www.dulabs.co";

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "DuLabs",
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/logo.png`,
    email: "contacto@dulabs.co",
    description:
      "DuLabs es una empresa de tecnología con sede en Montería, Colombia, que diseña e implementa soluciones de inteligencia artificial, automatización, software e integraciones para empresas.",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Montería",
      addressCountry: "CO",
    },
    areaServed: "CO",
  };
}

export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "DuLabs",
    url: `${SITE_URL}/`,
    inLanguage: "es-CO",
  };
}

export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}

export function serviceSchema(params: { name: string; description: string; path: string; areaServed?: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: params.name,
    description: params.description,
    url: `${SITE_URL}${params.path}`,
    provider: {
      "@type": "Organization",
      name: "DuLabs",
      url: `${SITE_URL}/`,
    },
    areaServed: params.areaServed ?? "CO",
  };
}

export function articleSchema(params: { title: string; description: string; path: string; datePublished: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: params.title,
    description: params.description,
    url: `${SITE_URL}${params.path}`,
    datePublished: params.datePublished,
    author: {
      "@type": "Organization",
      name: "DuLabs",
    },
  };
}
