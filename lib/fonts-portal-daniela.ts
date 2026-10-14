import localFont from "next/font/local";

// Fase 8A.7 (autorizado) — SOLO para el portal de cliente de Daniela
// (app/reservar/[tenant]/page.tsx). Variables CSS propias, aplicadas
// únicamente en el wrapper de esa página -- no se tocó app/layout.tsx ni la
// tipografía global (Geist) del resto del sitio.
// Archivos propios (lib/fonts/, ver su README): Cormorant Garamond es variable (peso 300–700), un solo archivo cubre
// los pesos 500 a 700; Parisienne tiene un único peso.
export const cormorantGaramond = localFont({
  src: "./fonts/cormorant-garamond-latin.woff2",
  weight: "500 700",
  variable: "--font-cormorant-daniela",
  adjustFontFallback: "Times New Roman",
});

export const parisienne = localFont({
  src: "./fonts/parisienne-400-latin.woff2",
  weight: "400",
  variable: "--font-parisienne-daniela",
});
