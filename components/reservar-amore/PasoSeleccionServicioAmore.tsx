"use client";

import { useMemo, useState } from "react";
import { Check, ChevronRight, ShieldCheck, Hand, Footprints, Eye, Smile, Sparkles, Clock } from "lucide-react";
import { playfairDisplay } from "@/lib/fonts-portal-amore";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { PortalHeaderAmore } from "./PortalHeaderAmore";
import { AMORE, serifAmore } from "./tema";

// AMORE (Fase 3 del portal, autorizado) — SOLO esta pantalla ("Selecciona
// tu servicio"). Consumidor puro de los `servicios` que ya trae el GET de
// /api/reservar/[tenant] (catálogo real de AMORE cargado en la Fase 1 --
// cero datos inventados). Seleccionar acá NO dispara nada por sí solo: el
// botón "Continuar" llama a `onElegir`, el MISMO handler que ya existe en
// app/reservar/amore/page.tsx.

type Servicio = {
  id: string;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  duracion_min: number;
  precio: number | null;
  imagen_url: string | null;
};

function iconoParaCategoria(categoria: string) {
  const c = categoria.toLowerCase();
  if (c.includes("mano") || c.includes("uña")) return Hand;
  if (c.includes("pie")) return Footprints;
  if (c.includes("ceja") || c.includes("ojo") || c.includes("pestañ")) return Eye;
  if (c.includes("labio") || c.includes("maquillaje")) return Smile;
  return Sparkles;
}

function formatearDuracion(min: number): string {
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  const minutos = min % 60;
  return minutos === 0 ? `${horas} h` : `${horas} h ${minutos} min`;
}

function PasoIndicador({ activo, completado, numero, label }: { activo: boolean; completado: boolean; numero: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="flex size-8 items-center justify-center rounded-full text-[13px] font-semibold"
        style={
          activo || completado
            ? { backgroundColor: AMORE.burdeos, color: "#fff" }
            : { backgroundColor: "#fff", color: AMORE.textoSecundario, border: `1px solid ${AMORE.borde}` }
        }
      >
        {completado ? <Check className="size-3.5" strokeWidth={2.5} /> : numero}
      </div>
      <span className="text-center text-[10px] font-medium leading-tight" style={{ color: activo || completado ? AMORE.texto : AMORE.textoSecundario }}>
        {label}
      </span>
    </div>
  );
}

export function PasoSeleccionServicioAmore({
  negocio,
  servicios,
  onElegir,
  onVolver,
}: {
  negocio: string;
  servicios: Servicio[];
  onElegir: (s: Servicio) => void;
  onVolver: () => void;
}) {
  const categorias = useMemo(() => {
    const vistas: string[] = [];
    for (const s of servicios) {
      const c = s.categoria?.trim() || "Otros";
      if (!vistas.includes(c)) vistas.push(c);
    }
    return vistas;
  }, [servicios]);

  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(categorias[0] ?? null);
  const [servicioSeleccionadoId, setServicioSeleccionadoId] = useState<string | null>(null);

  const serviciosDeCategoria = useMemo(
    () => servicios.filter((s) => (s.categoria?.trim() || "Otros") === categoriaActiva),
    [servicios, categoriaActiva]
  );

  const servicioSeleccionado = servicios.find((s) => s.id === servicioSeleccionadoId) ?? null;

  return (
    <div className={`relative min-h-screen w-full ${playfairDisplay.variable}`} style={{ backgroundColor: AMORE.fondo }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-6 pb-9 pt-8">
        <PortalHeaderAmore negocio={negocio} onVolver={onVolver} />

        <div className="mt-6 flex w-full items-start justify-between">
          <PasoIndicador activo completado={false} numero={1} label="Servicio" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.borde }} />
          <PasoIndicador activo={false} completado={false} numero={2} label="Profesional" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.borde }} />
          <PasoIndicador activo={false} completado={false} numero={3} label="Horario" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.borde }} />
          <PasoIndicador activo={false} completado={false} numero={4} label="Datos" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.borde }} />
          <PasoIndicador activo={false} completado={false} numero={5} label="Listo" />
        </div>

        <h1 className="mt-7 text-center text-[27px] font-semibold" style={{ ...serifAmore, color: AMORE.texto }}>
          Selecciona tu servicio
        </h1>
        <p className="mt-1 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>
          Elige la categoría y el servicio que deseas.
        </p>

        {servicios.length === 0 ? (
          <p className="mt-10 text-center text-[14px]" style={{ color: AMORE.textoSecundario }}>
            AMORE todavía no tiene servicios disponibles para reservar en línea.
          </p>
        ) : (
          <>
            <p className="mt-6 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: AMORE.texto }}>
              Categoría
            </p>
            <div className="mt-2.5 flex gap-2.5 overflow-x-auto pb-1">
              {categorias.map((cat) => {
                const Icono = iconoParaCategoria(cat);
                const activa = cat === categoriaActiva;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setCategoriaActiva(cat);
                      setServicioSeleccionadoId(null);
                    }}
                    className="flex shrink-0 flex-col items-center gap-1.5 rounded-2xl px-4 py-3"
                    style={{ backgroundColor: activa ? AMORE.burdeosSuave : "#fff", border: `1px solid ${activa ? AMORE.burdeos : AMORE.borde}` }}
                  >
                    <Icono className="size-5" style={{ color: AMORE.burdeos }} strokeWidth={1.6} />
                    <span className="whitespace-nowrap text-[12px] font-medium" style={{ color: activa ? AMORE.texto : AMORE.textoSecundario }}>
                      {cat}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="mt-6 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: AMORE.texto }}>
              Servicio
            </p>
            <div className="mt-2.5 flex flex-col gap-2.5">
              {serviciosDeCategoria.map((s) => {
                const seleccionado = s.id === servicioSeleccionadoId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setServicioSeleccionadoId(s.id)}
                    className="flex items-start gap-3 rounded-2xl p-4 text-left"
                    style={{ backgroundColor: seleccionado ? AMORE.burdeosSuave : "#fff", border: `1.5px solid ${seleccionado ? AMORE.burdeos : AMORE.borde}` }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[14.5px] font-semibold" style={{ color: AMORE.texto }}>
                        {s.nombre}
                      </p>
                      {s.descripcion ? (
                        <p className="mt-0.5 text-[12px] leading-snug" style={{ color: AMORE.textoSecundario }}>
                          {s.descripcion}
                        </p>
                      ) : null}
                      <div className="mt-2 flex items-center gap-3">
                        {s.precio != null && (
                          <span className="text-[13.5px] font-semibold" style={{ color: AMORE.burdeos }}>
                            {formatearPrecioCop(s.precio)}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-[11.5px]" style={{ color: AMORE.textoSecundario }}>
                          <Clock className="size-3.5" strokeWidth={1.6} />
                          {formatearDuracion(s.duracion_min)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-0.5 shrink-0">
                      {seleccionado ? (
                        <div className="flex size-6 items-center justify-center rounded-full" style={{ backgroundColor: AMORE.burdeos }}>
                          <Check className="size-3.5 text-white" strokeWidth={2.5} />
                        </div>
                      ) : (
                        <ChevronRight className="size-5" style={{ color: AMORE.borde }} />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={!servicioSeleccionado}
              onClick={() => servicioSeleccionado && onElegir(servicioSeleccionado)}
              className="mt-6 flex w-full items-center justify-center gap-2 py-4 text-[15.5px] font-semibold text-white transition-transform disabled:opacity-40"
              style={{ backgroundColor: AMORE.burdeos, borderRadius: 999 }}
            >
              Continuar
              <ChevronRight className="size-5" strokeWidth={2} />
            </button>

            <div className="mt-4 flex items-center justify-center gap-1.5">
              <ShieldCheck className="size-3.5" style={{ color: AMORE.dorado }} strokeWidth={1.5} />
              <span className="text-[11px]" style={{ color: AMORE.textoSecundario }}>
                Tus datos están protegidos
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
