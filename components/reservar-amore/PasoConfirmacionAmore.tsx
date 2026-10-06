"use client";

import { CalendarPlus, ChevronRight, Clock } from "lucide-react";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { resumirServicios, type ServicioDelPortal } from "@/lib/reservar-amore-servicios";
import { BotonPrincipalAmore, MarcoPasoAmore } from "./MarcoPasoAmore";
import { formatearDuracion, formatearFechaLarga, formatearHora12h } from "./formato";
import { AMORE } from "./tema";

// AMORE (portal) — paso 5, «Confirma tu cita». Muestra el resumen REAL ya resuelto por los pasos anteriores (cada servicio, duración y precio totales) y llama a
// `onConfirmar` -- el MISMO handler de page.tsx que hace el POST único a app/api/reservar/[tenant]/route.ts. Esta pantalla NUNCA crea la cita por sí sola.
// El botón y el aviso de error van en la barra de abajo: si algo falla (ej. alguien tomó el horario) se ve de inmediato, sin buscarlo bajando.

type DatosCliente = { nombre: string; telefono: string };

function Fila({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0" style={{ borderColor: AMORE.borde }}>
      <span className="text-[12.5px]" style={{ color: AMORE.textoSecundario }}>
        {label}
      </span>
      <span className="text-right text-[13.5px] font-semibold" style={{ color: AMORE.texto }}>
        {valor}
      </span>
    </div>
  );
}

export function PasoConfirmacionAmore({
  negocio,
  servicios,
  especialistaNombre,
  fecha,
  hora,
  datos,
  enviando,
  error,
  ocupado,
  onConfirmar,
  onElegirOtroHorario,
  onVolver,
}: {
  negocio: string;
  servicios: Pick<ServicioDelPortal, "id" | "nombre" | "duracion_min" | "precio">[];
  especialistaNombre: string;
  fecha: string;
  hora: string;
  datos: DatosCliente;
  enviando: boolean;
  error: string | null;
  ocupado: boolean;
  onConfirmar: () => void;
  onElegirOtroHorario: () => void;
  onVolver: () => void;
}) {
  const resumen = resumirServicios(servicios);
  const varios = servicios.length > 1;

  const accion = (
    <div>
      {error && (
        <div role="alert" className="mb-2.5 rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-snug" style={{ backgroundColor: AMORE.rojoSuave, color: AMORE.rojo }}>
          {error}
        </div>
      )}
      {ocupado ? (
        // Confirmar de nuevo fallaría igual: la acción principal es elegir otro horario.
        <BotonPrincipalAmore llena onClick={onElegirOtroHorario}>
          Elegir otro horario
          <ChevronRight className="size-5" strokeWidth={2} />
        </BotonPrincipalAmore>
      ) : (
        <BotonPrincipalAmore llena onClick={onConfirmar} cargando={enviando}>
          {enviando ? "Confirmando..." : "Confirmar mi cita"}
          {!enviando && <ChevronRight className="size-5" strokeWidth={2} />}
        </BotonPrincipalAmore>
      )}
    </div>
  );

  return (
    <MarcoPasoAmore negocio={negocio} onVolver={onVolver} paso={5} titulo="Confirma tu cita" subtitulo="Revisa que todo esté correcto antes de confirmar." accion={accion}>
      <div className="rounded-[28px] p-4" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
        <ul className="flex flex-col gap-3 border-b pb-3" style={{ borderColor: AMORE.borde }} aria-label={varios ? "Servicios de tu cita" : "Servicio de tu cita"}>
          {servicios.map((s) => (
            <li key={s.id} className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: AMORE.burdeosSuave }}>
                <CalendarPlus className="size-[18px]" style={{ color: AMORE.burdeos }} strokeWidth={1.6} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold leading-snug" style={{ color: AMORE.texto }}>
                  {s.nombre}
                </p>
                <p className="flex items-center gap-1 text-[11.5px]" style={{ color: AMORE.textoSecundario }}>
                  <Clock className="size-3.5" strokeWidth={1.6} />
                  {formatearDuracion(s.duracion_min)}
                  {s.precio != null && <span style={{ color: AMORE.burdeos }}> · {formatearPrecioCop(s.precio)}</span>}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <div>
          <Fila label="Profesional" valor={especialistaNombre} />
          <Fila label="Fecha" valor={formatearFechaLarga(fecha)} />
          <Fila label="Hora" valor={formatearHora12h(hora)} />
          {varios && <Fila label="Duración total" valor={formatearDuracion(resumen.duracionMin)} />}
          {varios && resumen.precioTotal != null && <Fila label="Total" valor={formatearPrecioCop(resumen.precioTotal)} />}
          <Fila label="Nombre" valor={datos.nombre} />
          <Fila label="WhatsApp" valor={datos.telefono} />
        </div>
      </div>
    </MarcoPasoAmore>
  );
}
