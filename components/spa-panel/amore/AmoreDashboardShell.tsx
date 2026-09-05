"use client";

import { useState, type ReactNode } from "react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { NewAppointmentModal } from "@/components/spa-panel/modals/NewAppointmentModal";
import { AmoreHeader } from "./AmoreHeader";
import { AmoreBottomNav } from "./AmoreBottomNav";
import { AmoreMenuDrawer } from "./AmoreMenuDrawer";

// AMORE (Fase 5, panel administrativo móvil, autorizado) — reemplaza por
// completo el chrome de escritorio/híbrido (Sidebar, Header, MobileHero,
// MobileNav, modales de citas de Daniela) SOLO para el tenant de AMORE. Ver
// el branch en AgendaContext.tsx: la autenticación, el token y la carga de
// datos siguen siendo exactamente los mismos, esto solo cambia qué se
// renderiza alrededor de `children`. Fase mobile-only: el contenido se
// clampa a un ancho de app móvil incluso en pantallas grandes -- el
// dashboard de escritorio de AMORE no es parte de esta fase.
export function AmoreDashboardShell({ children }: { children: ReactNode }) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const { token, mostrarNueva, cerrarNueva, crearCita } = useAgenda();

  return (
    <div className="amore-scope min-h-screen bg-ink">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col">
        <AmoreHeader onAbrirMenu={() => setMenuAbierto(true)} />
        <main className="flex-1 overflow-x-hidden px-5 pb-28">{children}</main>
      </div>
      <AmoreBottomNav onAbrirMenu={() => setMenuAbierto(true)} />
      {menuAbierto && <AmoreMenuDrawer onClose={() => setMenuAbierto(false)} />}
      {mostrarNueva !== undefined && (
        <NewAppointmentModal token={token} fechaInicial={mostrarNueva ?? undefined} onClose={cerrarNueva} onCrear={crearCita} />
      )}
    </div>
  );
}
