import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
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
  title: "Du Labs — Tecnología conversacional para personas y empresas",
  description:
    "Creamos productos y soluciones que transforman WhatsApp en asistentes inteligentes capaces de organizar vidas, formar equipos y automatizar empresas.",
  metadataBase: new URL("https://dulabs.co"),
  openGraph: {
    title: "Du Labs — Tecnología conversacional",
    description:
      "Inteligencia artificial que vive donde ya hablas todos los días.",
    url: "https://dulabs.co",
    siteName: "Du Labs",
    locale: "es_CO",
    type: "website",
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
        <Script id="tema-inicial" strategy="beforeInteractive">
          {`try {
            if (localStorage.getItem('du_labs_theme') === 'dark') {
              document.documentElement.setAttribute('data-theme', 'dark');
            }
          } catch (e) {}`}
        </Script>
        {children}
      </body>
    </html>
  );
}
