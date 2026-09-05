"use client";

import { useState } from "react";
import { Menu, Bell, X } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AmoreCard, AmoreBadge } from "./ui";

// AMORE (Fase "sistema completo", autorizado) — barra superior GLOBAL
// (hamburguesa + logo oficial centrado + notificaciones), montada una sola
// vez por AmoreDashboardShell y compartida por TODAS las pantallas del
// panel. "Notificaciones" ahora es real: muestra las citas pendientes de
// confirmar (datos.citas, ya cargado por useAgenda(), sin fetch nuevo). El
// marcado del topbar en sí no cambió ni un pixel respecto a la versión
// anterior.
export function AmoreHeader({ onAbrirMenu }: { onAbrirMenu: () => void }) {
  const { datos } = useAgenda();
  const [abierto, setAbierto] = useState(false);
  const pendientes = datos.citas.filter((c) => c.estado === "pendiente" || c.estado === "propuesta");

  return (
    <header className="relative px-5 pt-5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Abrir menú"
          onClick={onAbrirMenu}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-fg active:bg-ink-2"
        >
          <Menu className="size-6" />
        </button>
        <img
          src="/amore/logo.png"
          alt="AMORE Salón de Belleza"
          width={2067}
          height={761}
          className="h-auto w-[min(230px,54vw)] object-contain"
        />
        <button
          type="button"
          aria-label="Notificaciones"
          onClick={() => setAbierto((v) => !v)}
          className="relative flex size-10 shrink-0 items-center justify-center rounded-full text-fg active:bg-ink-2"
        >
          <Bell className="size-6" />
          {pendientes.length > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-lime" />}
        </button>
      </div>

      {abierto && (
        <div className="absolute inset-x-5 top-16 z-40">
          <AmoreCard>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-fg">Solicitudes pendientes</p>
              <button type="button" onClick={() => setAbierto(false)} aria-label="Cerrar" className="text-mist">
                <X className="size-4" />
              </button>
            </div>
            {pendientes.length === 0 ? (
              <p className="mt-2 text-sm text-mist">No tienes solicitudes pendientes.</p>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {pendientes.slice(0, 5).map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm text-fg">
                      {c.nombre_cliente} · {c.servicio}
                    </p>
                    <AmoreBadge tono="warning">Pendiente</AmoreBadge>
                  </div>
                ))}
              </div>
            )}
          </AmoreCard>
        </div>
      )}
    </header>
  );
}
