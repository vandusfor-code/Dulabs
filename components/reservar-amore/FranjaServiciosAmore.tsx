import { CalendarPlus, Clock } from "lucide-react";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { resumirServicios, type ServicioDelPortal } from "@/lib/reservar-amore-servicios";
import { formatearDuracion } from "./formato";
import { AMORE } from "./tema";

// AMORE (portal) — franja de UNA línea con lo que se está reservando (servicios «A + B», duración total, precio total y profesional) para los pasos de
// profesional y horario: recuerda la selección sin ocupar media pantalla. Solo presentación.

export function FranjaServiciosAmore({ servicios, especialistaNombre }: { servicios: Pick<ServicioDelPortal, "nombre" | "duracion_min" | "precio">[]; especialistaNombre?: string | null }) {
  const resumen = resumirServicios(servicios);
  return (
    <div className="flex items-center gap-3 rounded-2xl p-3" style={{ backgroundColor: AMORE.doradoSuave }}>
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: "#fff" }}>
        <CalendarPlus className="size-5" style={{ color: AMORE.burdeos }} strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13.5px] font-semibold leading-snug" style={{ color: AMORE.texto }}>
          {resumen.nombre}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]" style={{ color: AMORE.textoSecundario }}>
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" strokeWidth={1.6} />
            {formatearDuracion(resumen.duracionMin)}
          </span>
          {resumen.precioTotal != null && (
            <span className="font-semibold" style={{ color: AMORE.burdeos }}>
              {formatearPrecioCop(resumen.precioTotal)}
            </span>
          )}
          {especialistaNombre ? <span>{especialistaNombre}</span> : null}
        </div>
      </div>
    </div>
  );
}
