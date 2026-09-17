import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Nota (Fase 15): "/developer$" y "/developer/" protegen el DASHBOARD
      // privado sin bloquear las superficies públicas "/developer-platform"
      // (landing) ni "/developers" (docs) -- por eso NO se usa el prefijo
      // "/developer" a secas, que sí las atraparía.
      disallow: [
        "/dashboard",
        "/agenda",
        "/config-bot",
        "/login",
        "/checkout",
        "/api",
        "/webhook-dulabs",
        "/developer$",
        "/developer/",
      ],
    },
    sitemap: "https://www.dulabs.co/sitemap.xml",
  };
}
