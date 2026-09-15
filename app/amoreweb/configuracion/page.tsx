"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Store, Clock3, UserRound, BellRing, Cake, Heart, MessageCircle, UserCog, ChevronRight, X } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { AdminOnlyDesktop } from "@/components/admin-web/AdminOnlyDesktop";
import {
  RUTA_EQUIPO,
  RUTA_CUMPLEANOS,
  RUTA_FIDELIZACION,
  RUTA_COMUNICACIONES,
  RUTA_WHATSAPP,
} from "@/components/admin-web/admin-web-routes";

// Panel web AMORE (autorizado) — Configuración desktop: cada fila navega a
// su módulo real (mismo criterio que la versión móvil). Admin-only.
export default function AdminAmoreConfiguracionPage() {
  return (
    <AdminOnlyDesktop>
      <ConfiguracionContenido />
    </AdminOnlyDesktop>
  );
}

function Fila({ icono, titulo, descripcion, onClick }: { icono: React.ReactNode; titulo: string; descripcion: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 rounded-2xl border border-edge bg-card p-4 text-left shadow-sm hover:border-lime/40"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-lime-soft text-lime-text">{icono}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{titulo}</p>
        <p className="truncate text-xs text-mist">{descripcion}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-mist" />
    </button>
  );
}

function ConfiguracionContenido() {
  const { token, datos } = useAdminWeb();
  const router = useRouter();
  const [panel, setPanel] = useState<"negocio" | "cuenta" | null>(null);
  void token;

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Configuración</h1>
        <p className="text-sm text-mist">Ajustes del panel de AMORE</p>
      </div>

      <div className="flex flex-col gap-2.5">
        <Fila icono={<Store className="size-5" />} titulo="Negocio" descripcion="Datos de AMORE" onClick={() => setPanel("negocio")} />
        <Fila
          icono={<Clock3 className="size-5" />}
          titulo="Horarios"
          descripcion="Horario de atención del salón"
          onClick={() => router.push(RUTA_EQUIPO)}
        />
        <Fila
          icono={<UserRound className="size-5" />}
          titulo="Trabajadoras"
          descripcion="Equipo, horarios y servicios asignados"
          onClick={() => router.push(RUTA_EQUIPO)}
        />
        <Fila
          icono={<BellRing className="size-5" />}
          titulo="Confirmaciones y recordatorios"
          descripcion="Mensajes automáticos de citas"
          onClick={() => router.push(RUTA_COMUNICACIONES)}
        />
        <Fila
          icono={<Cake className="size-5" />}
          titulo="Cumpleaños"
          descripcion="Mensajes automáticos de cumpleaños"
          onClick={() => router.push(RUTA_CUMPLEANOS)}
        />
        <Fila
          icono={<Heart className="size-5" />}
          titulo="Fidelización"
          descripcion="Reglas de reactivación de clientas"
          onClick={() => router.push(RUTA_FIDELIZACION)}
        />
        <Fila
          icono={<MessageCircle className="size-5" />}
          titulo="WhatsApp"
          descripcion="Conexión y uso del número"
          onClick={() => router.push(RUTA_WHATSAPP)}
        />
        <Fila icono={<UserCog className="size-5" />} titulo="Cuenta" descripcion="Acceso y datos de tu cuenta" onClick={() => setPanel("cuenta")} />
      </div>

      {panel && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={() => setPanel(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-edge bg-card p-5 shadow-lg">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-fg">{panel === "negocio" ? "Negocio" : "Cuenta"}</p>
              <button type="button" onClick={() => setPanel(null)} aria-label="Cerrar" className="text-mist">
                <X className="size-4" />
              </button>
            </div>
            {panel === "negocio" ? (
              <div className="mt-3 flex flex-col gap-2 text-sm">
                <p className="text-fg">{datos.negocio}</p>
                <p className="text-mist">{datos.resumen.serviciosActivos} servicios activos</p>
                <p className="text-mist">{datos.resumen.profesionalesActivos} profesionales activas</p>
                <p className="text-mist">{datos.resumen.clientesRegistrados} clientas registradas</p>
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2 text-sm">
                <p className="text-fg">{datos.negocio}</p>
                <p className="text-mist">Plan activo</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
