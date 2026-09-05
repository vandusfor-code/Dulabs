"use client";

import type { ReactNode } from "react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";

// AMORE (Fase 5, diseño visual completo, autorizado) — guarda de seguridad
// para las rutas NUEVAS que solo existen para AMORE (Cumpleaños/Fidelización/
// Contabilidad/Equipo/WhatsApp/Configuración): si alguien con el token de
// OTRO tenant llega a adivinar la URL, no ve el diseño de AMORE ni ningún
// dato -- ve un aviso neutro. Mismo criterio de aislamiento que ya se usa en
// el resto del panel (todo filtrado por tenant).
export function AmoreOnlyScreen({ children }: { children: ReactNode }) {
  const { datos } = useAgenda();
  if (datos.negocio !== "AMORE") {
    return <p className="py-10 text-center text-sm text-mist">Esta sección no está disponible para tu negocio.</p>;
  }
  return <>{children}</>;
}
