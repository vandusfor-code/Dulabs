"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type AmoreUiCtx = { avisarProximamente: () => void };

const Ctx = createContext<AmoreUiCtx | null>(null);

export function useAmoreUi() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAmoreUi debe usarse dentro de AmoreDashboardShell");
  return ctx;
}

// AMORE (Fase 5, panel administrativo móvil, autorizado) — módulos como
// Citas/Clientes/Servicios/Cumpleaños/etc. todavía no existen en esta fase.
// En vez de enlazar botones a rutas rotas o dejarlos sin respuesta, este
// aviso breve confirma la acción sin fingir una función que aún no existe.
export function AmoreUiProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const avisarProximamente = useCallback(() => {
    setVisible(true);
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setVisible(false), 1600);
  }, []);

  return (
    <Ctx.Provider value={{ avisarProximamente }}>
      {children}
      <div
        aria-live="polite"
        className={`pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex justify-center px-6 transition-opacity duration-200 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="rounded-full bg-fg/90 px-4 py-2 text-xs font-medium text-white shadow-lg">Próximamente</div>
      </div>
    </Ctx.Provider>
  );
}
