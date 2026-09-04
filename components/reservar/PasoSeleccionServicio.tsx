"use client";

import { useMemo, useState } from "react";
import { Check, ChevronRight, ShieldCheck, Hand, Footprints, Eye, Smile, Sparkles, Clock, Heart } from "lucide-react";
import { cormorantGaramond, parisienne } from "@/lib/fonts-portal-daniela";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { PortalHeader } from "@/components/reservar/PortalHeader";

// Fase 8A.8 (autorizado) — SOLO esta pantalla ("Selecciona tu servicio").
// Consumidor puro de los `servicios` que ya trae el GET de
// /api/reservar/[tenant] (categoria/descripcion/precio/duracion_min/
// imagen_url reales de dulabs_servicios) -- CERO datos del mockup
// (categorías/servicios/precios de "Cabello" eran solo referencia visual).
// Seleccionar un servicio acá NO dispara nada por sí solo: solo guarda una
// selección visual local. El botón "Continuar" es el único que llama a
// `onElegir` -- el MISMO handler que ya existía en
// app/reservar/[tenant]/page.tsx (elegirServicio), sin tocar su lógica.

type Servicio = {
  id: string;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  duracion_min: number;
  precio: number | null;
  imagen_url: string | null;
};

const ROSA = "#C94B78";
const ROSA_SUAVE = "#F8E8ED";
const ROSA_FONDO = "#FDF5F7";
const TEXTO = "#111111";
const TEXTO_SECUNDARIO = "#555555";
const BORDE = "#E8DDE1";

const serif = { fontFamily: "var(--font-cormorant-daniela), 'Cormorant Garamond', serif" };

// Presentación pura -- no representa un hecho del negocio, solo elige un
// ícono razonable para una categoría real (o uno genérico si no reconoce el
// nombre). Nunca decide QUÉ categorías existen -- eso sale 100% de los datos.
function iconoParaCategoria(categoria: string) {
  const c = categoria.toLowerCase();
  if (c.includes("mano")) return Hand;
  if (c.includes("pie")) return Footprints;
  if (c.includes("ceja") || c.includes("ojo") || c.includes("pestañ")) return Eye;
  if (c.includes("labio")) return Smile;
  return Sparkles;
}

function formatearDuracion(min: number): string {
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  const minutos = min % 60;
  if (minutos === 0) return `${horas} h`;
  return `${horas} h ${minutos} min`;
}

function PasoIndicador({ activo, completado, numero, label }: { activo: boolean; completado: boolean; numero: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="flex size-9 items-center justify-center rounded-full text-[14px] font-semibold"
        style={
          activo || completado
            ? { backgroundColor: ROSA, color: "#fff" }
            : { backgroundColor: "#fff", color: TEXTO_SECUNDARIO, border: `1px solid ${BORDE}` }
        }
      >
        {completado ? <Check className="size-4" strokeWidth={2.5} /> : numero}
      </div>
      <span className="text-center text-[11px] font-medium leading-tight" style={{ color: activo || completado ? TEXTO : TEXTO_SECUNDARIO }}>
        {label}
      </span>
    </div>
  );
}

export function PasoSeleccionServicio({
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
  // Categorías reales, en el orden en que aparecen en los datos -- nunca una
  // lista fija. "Otros" solo existe si de verdad hay servicios sin categoría.
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
    <div className={`relative min-h-screen w-full ${cormorantGaramond.variable} ${parisienne.variable}`} style={{ backgroundColor: ROSA_FONDO }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-6 pb-9 pt-9">
        <PortalHeader negocio={negocio} onVolver={onVolver} />

        {/* Indicador de pasos -- refleja el estado REAL: estamos en el paso 1, aún sin confirmar */}
        <div className="mt-7 flex w-full items-start justify-between">
          <PasoIndicador activo completado={false} numero={1} label="Servicio" />
          <div className="mt-4 h-px flex-1" style={{ backgroundColor: BORDE }} />
          <PasoIndicador activo={false} completado={false} numero={2} label="Horario" />
          <div className="mt-4 h-px flex-1" style={{ backgroundColor: BORDE }} />
          <PasoIndicador activo={false} completado={false} numero={3} label="Tus datos" />
          <div className="mt-4 h-px flex-1" style={{ backgroundColor: BORDE }} />
          <PasoIndicador activo={false} completado={false} numero={4} label="Confirmación" />
        </div>

        {/* Título */}
        <h1 className="mt-8 text-center text-[32px] font-semibold" style={{ ...serif, color: TEXTO }}>
          Selecciona tu servicio
        </h1>
        <p className="mt-1 text-center text-[13.5px]" style={{ color: TEXTO_SECUNDARIO }}>
          Elige la categoría y el servicio que deseas.
        </p>

        {servicios.length === 0 ? (
          <p className="mt-10 text-center text-[14px]" style={{ color: TEXTO_SECUNDARIO }}>
            Este negocio todavía no tiene servicios disponibles para reservar en línea.
          </p>
        ) : (
          <>
            {/* Categorías reales */}
            <p className="mt-7 text-[12px] font-semibold uppercase tracking-wide" style={{ color: TEXTO }}>
              1. Selecciona una categoría
            </p>
            <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1">
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
                    className="flex shrink-0 flex-col items-center gap-2 rounded-2xl px-4 py-3.5"
                    style={{
                      backgroundColor: activa ? ROSA_SUAVE : "#fff",
                      border: `1px solid ${activa ? ROSA : BORDE}`,
                    }}
                  >
                    <Icono className="size-5" style={{ color: ROSA }} strokeWidth={1.6} />
                    <span className="whitespace-nowrap text-[12.5px] font-medium" style={{ color: activa ? TEXTO : TEXTO_SECUNDARIO }}>
                      {cat}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Servicios de la categoría activa */}
            <p className="mt-7 text-[12px] font-semibold uppercase tracking-wide" style={{ color: TEXTO }}>
              2. Selecciona tu servicio
            </p>
            <div className="mt-3 flex flex-col gap-3">
              {serviciosDeCategoria.map((s) => {
                const seleccionado = s.id === servicioSeleccionadoId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setServicioSeleccionadoId(s.id)}
                    className="flex items-start gap-3 rounded-2xl p-4 text-left"
                    style={{
                      backgroundColor: seleccionado ? ROSA_SUAVE : "#fff",
                      border: `1.5px solid ${seleccionado ? ROSA : BORDE}`,
                    }}
                  >
                    {s.imagen_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.imagen_url} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold" style={{ color: TEXTO }}>
                        {s.nombre}
                      </p>
                      {s.descripcion ? (
                        <p className="mt-0.5 text-[12.5px] leading-snug" style={{ color: TEXTO_SECUNDARIO }}>
                          {s.descripcion}
                        </p>
                      ) : null}
                      <div className="mt-2 flex items-center gap-3">
                        {s.precio != null && (
                          <span className="text-[14px] font-semibold" style={{ color: ROSA }}>
                            {formatearPrecioCop(s.precio)}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-[12px]" style={{ color: TEXTO_SECUNDARIO }}>
                          <Clock className="size-3.5" strokeWidth={1.6} />
                          {formatearDuracion(s.duracion_min)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-0.5 shrink-0">
                      {seleccionado ? (
                        <div className="flex size-6 items-center justify-center rounded-full" style={{ backgroundColor: ROSA }}>
                          <Check className="size-3.5 text-white" strokeWidth={2.5} />
                        </div>
                      ) : (
                        <ChevronRight className="size-5" style={{ color: BORDE }} />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-center gap-2">
              <span className="h-px w-14" style={{ backgroundColor: ROSA }} />
              <Heart className="size-3.5 shrink-0" style={{ color: ROSA }} strokeWidth={1.5} />
              <span className="h-px w-14" style={{ backgroundColor: ROSA }} />
            </div>

            <button
              type="button"
              disabled={!servicioSeleccionado}
              onClick={() => servicioSeleccionado && onElegir(servicioSeleccionado)}
              className="mt-6 flex w-full items-center justify-center gap-2 py-4 text-[16px] font-semibold text-white transition-transform disabled:opacity-40"
              style={{ backgroundColor: ROSA, borderRadius: 32 }}
            >
              Continuar
              <ChevronRight className="size-5" strokeWidth={2} />
            </button>

            <div className="mt-4 flex items-center justify-center gap-1.5">
              <ShieldCheck className="size-3.5" style={{ color: ROSA }} strokeWidth={1.5} />
              <span className="text-[11.5px]" style={{ color: TEXTO_SECUNDARIO }}>
                Tus datos están protegidos
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
