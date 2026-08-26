"use client";

import { DashboardMockup } from "./DashboardMockup";
import { PhoneDemo } from "./PhoneDemo";

/**
 * Composición del hero: laptop con el dashboard + teléfono con WhatsApp
 * animado (mismo componente de la clienta, PhoneDemo, sin tocarlo -- solo se
 * escala más chico aquí). En desktop van inclinados y flotan cada uno a su
 * propio ritmo; en mobile la composición 3D no cabe bien, así que se muestra
 * solo el teléfono, a tamaño normal.
 */
export function ProductMockup() {
  return (
    <div className="relative mx-auto flex justify-center">
      {/* Mobile / tablet: solo el teléfono */}
      <div className="lg:hidden">
        <PhoneDemo />
      </div>

      {/* Desktop: laptop + teléfono */}
      <div className="relative hidden h-[480px] w-[540px] lg:block" style={{ perspective: "1800px" }}>
        {/* Glow ambiental muy sutil, no un verde intenso */}
        <div className="pointer-events-none absolute inset-x-6 bottom-4 h-40 rounded-full bg-site-primary/10 blur-[70px]" />

        {/* Laptop */}
        <div className="absolute left-0 top-2 animate-site-float-laptop">
          <div style={{ transform: "rotateY(-9deg) rotateX(5deg)", transformStyle: "preserve-3d" }}>
            <DashboardMockup />
          </div>
        </div>

        {/* Teléfono, delante y más pequeño */}
        <div className="absolute bottom-0 right-0 animate-site-float-phone">
          <div style={{ transform: "scale(0.56) rotateY(9deg) rotateX(-3deg)", transformOrigin: "bottom right" }}>
            <PhoneDemo />
          </div>
        </div>
      </div>
    </div>
  );
}
