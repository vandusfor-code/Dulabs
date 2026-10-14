import localFont from "next/font/local";

// AMORE (Fase 3 del portal, autorizado) — SOLO para el portal de cliente de
// AMORE (app/reservar/amore/page.tsx). Variable CSS propia, distinta de la
// de Daniela (--font-cormorant-daniela) -- identidad tipográfica propia, no
// se tocó app/layout.tsx ni la tipografía global del resto del sitio.
// Archivo propio (lib/fonts/, ver su README): Playfair Display es variable (peso 400–900), un solo archivo cubre
// los pesos 500 a 700.
export const playfairDisplay = localFont({
  src: "./fonts/playfair-display-latin.woff2",
  weight: "500 700",
  variable: "--font-playfair-amore",
  adjustFontFallback: "Times New Roman",
});
