import { Cormorant_Garamond } from "next/font/google";

// Catálogo público (vitrina de tienda) — serif editorial SOLO para títulos y
// marca; el texto de lectura sigue en Geist (global). Variable CSS propia,
// aplicada únicamente en el wrapper de /catalogo/{slug}: no toca
// app/layout.tsx ni la tipografía del resto del sitio.
export const serifCatalogo = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-serif-catalogo",
});
