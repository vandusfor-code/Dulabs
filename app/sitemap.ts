import type { MetadataRoute } from "next";
import { ARTICULOS } from "@/lib/recursos";

const SITE_URL = "https://www.dulabs.co";

// Rutas públicas indexables. Deliberadamente NO incluye /dashboard, /agenda,
// /login, /checkout, /api ni /business (redirect stub) -- son privadas o
// duplicadas, ver robots.ts.
const RUTAS_ESTATICAS: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/whatsapp-ia", priority: 0.9, changeFrequency: "monthly" },
  { path: "/automatizacion-empresas", priority: 0.8, changeFrequency: "monthly" },
  { path: "/inteligencia-artificial-empresas", priority: 0.8, changeFrequency: "monthly" },
  { path: "/software-a-medida", priority: 0.8, changeFrequency: "monthly" },
  { path: "/crm-personalizado", priority: 0.8, changeFrequency: "monthly" },
  { path: "/integraciones", priority: 0.8, changeFrequency: "monthly" },
  { path: "/soluciones-empresariales", priority: 0.9, changeFrequency: "monthly" },
  { path: "/casos", priority: 0.7, changeFrequency: "monthly" },
  { path: "/recursos", priority: 0.7, changeFrequency: "weekly" },
  { path: "/precios", priority: 0.8, changeFrequency: "monthly" },
  { path: "/preguntas-frecuentes", priority: 0.6, changeFrequency: "monthly" },
  { path: "/privacidad", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terminos", priority: 0.3, changeFrequency: "yearly" },
  { path: "/eliminacion-de-datos-whatsapp", priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const estaticas = RUTAS_ESTATICAS.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: new Date(),
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  const articulos = ARTICULOS.map((a) => ({
    url: `${SITE_URL}/recursos/${a.slug}`,
    lastModified: new Date(a.fechaPublicacion),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [...estaticas, ...articulos];
}
