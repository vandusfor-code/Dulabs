"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, User, Loader2 } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";

// Panel web AMORE (autorizado) — "Mi perfil" desktop: disponible para
// cualquier rol, con logout REAL (revoca la sesión en el servidor, ver
// /api/agenda-auth/logout, no solo borra un estado local).
export default function AdminAmorePerfilPage() {
  const { datos } = useAdminWeb();
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
    <div className="flex max-w-md flex-col gap-5">
      <h1 className="text-xl font-semibold text-fg">Mi perfil</h1>

      <div className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-5 shadow-sm">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-lime-soft text-lime-text">
          <User className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{sesion?.nombre ?? datos.especialista.nombre}</p>
          <p className="truncate text-xs text-mist">
            {sesion ? `@${sesion.username} · ${sesion.rol === "administrador" ? "Administradora" : "Colaboradora"}` : "Enlace directo (sin login)"}
          </p>
        </div>
      </div>

      {sesion && (
        <button
          type="button"
          onClick={cerrarSesion}
          disabled={saliendo}
          className="flex items-center justify-center gap-2 rounded-xl bg-danger py-2.5 text-sm font-medium text-danger-text disabled:opacity-50"
        >
          {saliendo ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          Cerrar sesión
        </button>
      )}
    </div>
  );
}
