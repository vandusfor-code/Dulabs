import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/agenda", "/login", "/checkout", "/api", "/webhook-dulabs"],
    },
    sitemap: "https://www.dulabs.co/sitemap.xml",
  };
}
