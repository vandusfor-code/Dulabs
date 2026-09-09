import { Poppins } from "next/font/google";

// Tienda móvil de AMORE (autorizado, rediseño /amore/tienda) — SOLO para
// esta página. Variable CSS propia (--font-poppins-tienda), mismo patrón
// exacto que lib/fonts-portal-amore.ts (playfairDisplay) -- no se toca
// app/layout.tsx ni la tipografía global del resto del sitio.
export const poppinsTienda = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-poppins-tienda",
});
