"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, User, Loader2 } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreScreenTitle, AmoreCard, AmoreSecondaryButton } from "@/components/spa-panel/amore/ui";

// Login AMORE (autorizado) — "Mi perfil": nombre/usuario/rol reales de la
// sesión + cerrar sesión REAL (revoca la sesión en el servidor, ver
// /api/agenda-auth/logout, no solo borra un estado local). Disponible para
// cualquier rol -- administradora también tiene una cuenta con la que
// cerrar sesión.
export default function PerfilPage() {
  return (
    <AmoreOnlyScreen>
      <PerfilContenido />
    </AmoreOnlyScreen>
  );
}

function PerfilContenido() {
  const { datos } = useAgenda();
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);
  const sesion = datos.sesion;

  async function cerrarSesion() {
    setSaliendo(true);
    try {
      await fetch("/api/agenda-auth/logout", { method: "POST" });
    } finally {
      router.push("/amore/login");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle title="Mi perfil" />

      <AmoreCard className="flex items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-lime-soft text-lime-text">
          <User className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{sesion?.nombre ?? datos.especialista.nombre}</p>
          <p className="truncate text-xs text-mist">
            {sesion ? `@${sesion.username} · ${sesion.rol === "administrador" ? "Administradora" : "Colaboradora"}` : "Enlace directo (sin login)"}
          </p>
        </div>
      </AmoreCard>

      {sesion && (
        <AmoreSecondaryButton onClick={cerrarSesion} disabled={saliendo} className="!bg-danger !text-danger-text">
          {saliendo ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          Cerrar sesión
        </AmoreSecondaryButton>
      )}
    </div>
  );
}
