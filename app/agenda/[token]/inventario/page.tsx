"use client";

import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreInventarioScreen } from "@/components/spa-panel/amore/AmoreInventarioScreen";

// AMORE (autorizado) — Inventario móvil. Mismo patrón EXACTO que
// contabilidad/equipo/cumpleanos: ruta nueva, exclusiva de AMORE (AmoreOnlyScreen),
// contenido real delegado a un componente propio del design system móvil.
export default function InventarioPage() {
  return (
    <AmoreOnlyScreen>
      <AmoreInventarioScreen />
    </AmoreOnlyScreen>
  );
}
