import localFont from "next/font/local";

// Catálogo público (vitrina de tienda) — serif editorial SOLO para títulos y
// marca; el texto de lectura sigue en Geist (global). Variable CSS propia,
// aplicada únicamente en el wrapper de /catalogo/{slug}: no toca
// app/layout.tsx ni la tipografía del resto del sitio.
// Archivo propio (lib/fonts/, ver su README): Cormorant Garamond es una fuente variable (peso 300–700),
// así que un solo archivo cubre los pesos 500 y 600 que usa la tienda.
export const serifCatalogo = localFont({
  src: "./fonts/cormorant-garamond-latin.woff2",
  weight: "500 600",
  variable: "--font-serif-catalogo",
  adjustFontFallback: "Times New Roman",
});
