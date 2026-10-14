import localFont from "next/font/local";

// Tienda móvil de AMORE (autorizado, rediseño /amore/tienda) — SOLO para
// esta página. Variable CSS propia (--font-poppins-tienda), mismo patrón
// exacto que lib/fonts-portal-amore.ts (playfairDisplay) -- no se toca
// app/layout.tsx ni la tipografía global del resto del sitio.
// Archivos propios (lib/fonts/, ver su README): Poppins no es variable, así que hay un archivo por peso.
export const poppinsTienda = localFont({
  src: [
    { path: "./fonts/poppins-400-latin.woff2", weight: "400" },
    { path: "./fonts/poppins-500-latin.woff2", weight: "500" },
    { path: "./fonts/poppins-600-latin.woff2", weight: "600" },
  ],
  variable: "--font-poppins-tienda",
});
