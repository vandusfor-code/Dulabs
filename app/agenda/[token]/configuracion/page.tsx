"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Store, Clock3, UserRound, BellRing, Cake, Heart, MessageCircle, UserCog, X } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreScreenTitle, AmoreChevronRow, AmoreCard } from "@/components/spa-panel/amore/ui";

// AMORE (Fase "sistema completo", autorizado) — cada fila navega de verdad
// a su módulo real (Horarios/Profesionales/Cumpleaños/Fidelización/
// WhatsApp ya son funcionales; Confirmaciones y recordatorios es nueva acá
// mismo). "Negocio"/"Cuenta" muestran datos reales del tenant en vez de
// navegar (no hay todavía un flujo seguro de edición de esos campos).
export default function ConfiguracionPage() {
  return (
    <AmoreOnlyScreen>
      <ConfiguracionContenido />
    </AmoreOnlyScreen>
  );
}

function ConfiguracionContenido() {
  const { token, datos } = useAgenda();
  const router = useRouter();
  const [panel, setPanel] = useState<"negocio" | "cuenta" | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle title="Configuración" subtitle="Ajustes del panel de AMORE" />
      <div className="flex flex-col gap-2.5">
        <AmoreChevronRow icono={<Store className="size-5" />} titulo="Negocio" descripcion="Datos de AMORE" onClick={() => setPanel("negocio")} />
        <AmoreChevronRow
          icono={<Clock3 className="size-5" />}
          titulo="Horarios"
          descripcion="Horario de atención del salón"
          onClick={() => router.push(`/agenda/${token}/horarios`)}
        />
        <AmoreChevronRow
          icono={<UserRound className="size-5" />}
          titulo="Profesionales"
          descripcion="Equipo, horarios y servicios asignados"
          onClick={() => router.push(`/agenda/${token}/equipo`)}
        />
        <AmoreChevronRow
          icono={<BellRing className="size-5" />}
          titulo="Confirmaciones y recordatorios"
          descripcion="Mensajes automáticos de citas"
          onClick={() => router.push(`/agenda/${token}/configuracion/comunicaciones`)}
        />
        <AmoreChevronRow
          icono={<Cake className="size-5" />}
          titulo="Cumpleaños"
          descripcion="Mensajes automáticos de cumpleaños"
          onClick={() => router.push(`/agenda/${token}/cumpleanos`)}
        />
        <AmoreChevronRow
          icono={<Heart className="size-5" />}
          titulo="Fidelización"
          descripcion="Reglas de reactivación de clientas"
          onClick={() => router.push(`/agenda/${token}/fidelizacion`)}
        />
        <AmoreChevronRow
          icono={<MessageCircle className="size-5" />}
          titulo="WhatsApp"
          descripcion="Conexión y uso del número"
          onClick={() => router.push(`/agenda/${token}/whatsapp`)}
        />
        <AmoreChevronRow icono={<UserCog className="size-5" />} titulo="Cuenta" descripcion="Acceso y datos de tu cuenta" onClick={() => setPanel("cuenta")} />
      </div>

      {panel && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 p-4" onClick={() => setPanel(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
            <AmoreCard>
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
            </AmoreCard>
          </div>
        </div>
      )}
    </div>
  );
}
