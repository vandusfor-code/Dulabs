import { Playfair_Display } from "next/font/google";

// AMORE (Fase 3 del portal, autorizado) — SOLO para el portal de cliente de
// AMORE (app/reservar/amore/page.tsx). Variable CSS propia, distinta de la
// de Daniela (--font-cormorant-daniela) -- identidad tipográfica propia, no
// se tocó app/layout.tsx ni la tipografía global del resto del sitio.
export const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-playfair-amore",
});
