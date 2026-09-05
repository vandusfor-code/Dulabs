"use client";

import type { ReactNode } from "react";
import { DesktopSidebar } from "./DesktopSidebar";
import { DesktopHeader } from "./DesktopHeader";
import { useAdminWeb } from "./AdminWebContext";
import { NewAppointmentModal } from "@/components/spa-panel/modals/NewAppointmentModal";
import { EditAppointmentModal } from "@/components/spa-panel/modals/EditAppointmentModal";

// Panel web AMORE (autorizado) — shell fijo (sidebar + header) para toda la
// experiencia desktop, optimizado 1280px+. min-w evita que el layout se
// rompa por debajo de tablet grande; en pantallas más chicas se recomienda
// la experiencia móvil ya existente (/agenda/[token]), ver
// MobileRedirectGuard.tsx. Monta los MISMOS modales reales de Daniela
// (Nueva cita / Editar-reasignar) que ya usa el panel móvil de AMORE --
// cero lógica de citas nueva, solo la piel desktop alrededor.
export function DesktopShell({ children }: { children: ReactNode }) {
  const { token, datos, mostrarNueva, cerrarNueva, crearCita, editando, cerrarEditar, guardarEdicion } = useAdminWeb();

  return (
    <div className="amore-scope flex min-h-screen min-w-[1024px] bg-ink">
      <DesktopSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <DesktopHeader />
        <main className="flex-1 overflow-y-auto px-8 py-7">{children}</main>
      </div>

      {mostrarNueva !== undefined && (
        <NewAppointmentModal token={token} fechaInicial={mostrarNueva ?? undefined} onClose={cerrarNueva} onCrear={crearCita} />
      )}
      {editando && <EditAppointmentModal cita={editando} equipo={datos.equipo} onClose={cerrarEditar} onGuardar={guardarEdicion} />}
    </div>
  );
}
