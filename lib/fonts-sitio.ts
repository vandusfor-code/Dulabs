import localFont from "next/font/local";

// Tipografía global del sitio (app/layout.tsx): Geist para el texto y Geist Mono para cifras y código, las dos variables
// (peso 100–900). Los archivos viven en lib/fonts/ (ver lib/fonts/README.md): la compilación ya no baja nada de Google Fonts.
// Las variables CSS son las de siempre (--font-geist-sans y --font-geist-mono), así que nada del CSS cambia.
export const geistSans = localFont({
  src: "./fonts/geist-latin.woff2",
  weight: "100 900",
  variable: "--font-geist-sans",
});

export const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
});
