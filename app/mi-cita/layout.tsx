import type { Viewport } from "next";
import { playfairDisplay } from "@/lib/fonts-portal-amore";
import { AMORE } from "@/components/reservar-amore/tema";

// «Mi cita» (el enlace personal de la clienta) se abre casi siempre desde el celular, con el mismo diseño del portal de reservas: la página usa todo el alto de la
// pantalla (los márgenes seguros de iPhone se respetan en la barra de acciones), el teclado no tapa los botones y el color de la barra del navegador se funde con el fondo.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: AMORE.fondo,
};

export default function MiCitaLayout({ children }: { children: React.ReactNode }) {
  // La variable CSS de la tipografía serif queda disponible para todas las pantallas (los componentes la usan vía `serifAmore`).
  return <div className={playfairDisplay.variable}>{children}</div>;
}
