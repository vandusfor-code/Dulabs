import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { LangProvider } from "@/lib/i18n";
import { JsonLd } from "@/components/site/JsonLd";
import { SiteAnalytics } from "@/components/site/SiteAnalytics";
import { organizationSchema, websiteSchema } from "@/lib/schema";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DuLabs | IA, Automatización y Software para Empresas",
  description:
    "DuLabs diseña e implementa soluciones de IA, automatización, software e integraciones para empresas. WhatsApp con IA, CRM y soluciones a medida.",
  metadataBase: new URL("https://www.dulabs.co"),
  alternates: {
    canonical: "https://www.dulabs.co/",
  },
  openGraph: {
    title: "DuLabs | IA, Automatización y Software para Empresas",
    description:
      "Diseñamos e implementamos soluciones de inteligencia artificial, automatización y software para empresas, desde WhatsApp con IA hasta sistemas e integraciones a medida.",
    url: "https://www.dulabs.co/",
    siteName: "DuLabs",
    images: [{ url: "/logo.png", width: 512, height: 512 }],
    locale: "es_CO",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DuLabs | IA, Automatización y Software para Empresas",
    description:
      "Soluciones de inteligencia artificial, automatización y software para empresas. WhatsApp con IA, CRM, integraciones y desarrollos a medida.",
    images: ["/logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-ink text-fg">
        <JsonLd data={organizationSchema()} />
        <JsonLd data={websiteSchema()} />
        <SiteAnalytics />
        <Script id="tema-inicial" strategy="beforeInteractive">
          {`try {
            if (localStorage.getItem('du_labs_theme') === 'dark') {
              document.documentElement.setAttribute('data-theme', 'dark');
            }
          } catch (e) {}`}
        </Script>
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
