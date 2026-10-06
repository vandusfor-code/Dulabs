import type { Viewport } from "next";
import { playfairDisplay } from "@/lib/fonts-portal-amore";
import { AMORE } from "@/components/reservar-amore/tema";

// Portal de reservas de AMORE, pensado para el celular: `viewportFit: "cover"` deja que la página use TODO el alto de la pantalla (los márgenes seguros de
// iPhone se respetan con env(safe-area-inset-*) en la barra de «Continuar»), y el color de la barra del navegador se funde con el fondo crema.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Con el teclado abierto (paso de datos) la página se acomoda al espacio que queda y la barra de «Continuar» se queda justo encima del teclado (Android; iOS lo ignora).
  interactiveWidget: "resizes-content",
  themeColor: AMORE.fondo,
};

export default function ReservarAmoreLayout({ children }: { children: React.ReactNode }) {
  // La variable CSS de la tipografía serif queda disponible para TODAS las pantallas del portal (los componentes la usan vía `serifAmore`).
  return <div className={playfairDisplay.variable}>{children}</div>;
}
