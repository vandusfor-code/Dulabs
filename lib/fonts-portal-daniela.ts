import { Cormorant_Garamond, Parisienne } from "next/font/google";

// Fase 8A.7 (autorizado) — SOLO para el portal de cliente de Daniela
// (app/reservar/[tenant]/page.tsx). Variables CSS propias, aplicadas
// únicamente en el wrapper de esa página -- no se tocó app/layout.tsx ni la
// tipografía global (Geist) del resto del sitio.
export const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-cormorant-daniela",
});

export const parisienne = Parisienne({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-parisienne-daniela",
});
