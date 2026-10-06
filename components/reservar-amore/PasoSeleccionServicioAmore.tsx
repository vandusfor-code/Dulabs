"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, Eye, Footprints, Hand, Smile, Sparkles, X } from "lucide-react";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { alternarServicio, categoriaDelServicio, ordenarCategorias, resumirServicios, serviciosDeIds, type ServicioDelPortal } from "@/lib/reservar-amore-servicios";
import { ContinuarAmore, MarcoPasoAmore } from "./MarcoPasoAmore";
import { formatearDuracion } from "./formato";
import { AMORE } from "./tema";

// AMORE (portal) — paso 1, «Elige tus servicios». Consumidor puro de los `servicios` que ya trae el GET de /api/reservar/[tenant] (catálogo real de AMORE).
// La clienta puede marcar VARIOS servicios para una misma cita (ej. uñas de manos + uñas de pies; hasta `maxServicios`, que manda el servidor), incluso de
// categorías distintas: la selección vive en la página (`seleccionIds`) y no se pierde al cambiar de categoría ni al volver desde otro paso. Marcar no dispara
// nada por sí solo: «Continuar» llama a `onContinuar` y el backend vuelve a validar todo (que UNA misma profesional haga todos, la disponibilidad, etc.).

function iconoParaCategoria(categoria: string) {
  const c = categoria.toLowerCase();
  if (c.includes("mano") || c.includes("uña")) return Hand;
  if (c.includes("pie")) return Footprints;
  if (c.includes("ceja") || c.includes("ojo") || c.includes("pestañ")) return Eye;
  if (c.includes("labio") || c.includes("maquillaje")) return Smile;
  return Sparkles;
}

export function PasoSeleccionServicioAmore({
  negocio,
  servicios,
  seleccionIds,
  maxServicios,
  onCambiarSeleccion,
  onContinuar,
  onVolver,
}: {
  negocio: string;
  servicios: ServicioDelPortal[];
  seleccionIds: string[];
  maxServicios: number;
  onCambiarSeleccion: (ids: string[]) => void;
  onContinuar: () => void;
  onVolver: () => void;
}) {
  const categorias = useMemo(() => ordenarCategorias(servicios), [servicios]);
  const elegidos = useMemo(() => serviciosDeIds(seleccionIds, servicios), [seleccionIds, servicios]);
  const resumen = useMemo(() => resumirServicios(elegidos), [elegidos]);

  // Al abrir (o al volver desde otro paso) se muestra la categoría del primer servicio ya elegido; si no hay ninguno, la primera.
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(() => (elegidos[0] ? categoriaDelServicio(elegidos[0]) : null));
  const categoriaActual = categoriaActiva && categorias.includes(categoriaActiva) ? categoriaActiva : (categorias[0] ?? null);

  const serviciosDeCategoria = useMemo(() => servicios.filter((s) => categoriaDelServicio(s) === categoriaActual), [servicios, categoriaActual]);
  const marcadosPorCategoria = useMemo(() => {
    const cuentas = new Map<string, number>();
    for (const s of elegidos) cuentas.set(categoriaDelServicio(s), (cuentas.get(categoriaDelServicio(s)) ?? 0) + 1);
    return cuentas;
  }, [elegidos]);

  // La categoría activa siempre queda a la vista dentro de la fila (que se desplaza de lado).
  const chipActivoRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    chipActivoRef.current?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [categoriaActual]);

  const limiteAlcanzado = elegidos.length >= maxServicios;

  const categoriasUI = categorias.length > 0 && (
    <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Categorías de servicios">
      {categorias.map((cat) => {
        const Icono = iconoParaCategoria(cat);
        const activa = cat === categoriaActual;
        const marcados = marcadosPorCategoria.get(cat) ?? 0;
        return (
          <button
            key={cat}
            ref={activa ? chipActivoRef : undefined}
            type="button"
            role="tab"
            aria-selected={activa}
            onClick={() => setCategoriaActiva(cat)}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full pl-3.5 pr-3.5 text-[13px] font-medium"
            style={activa ? { backgroundColor: AMORE.burdeos, color: "#fff", border: `1px solid ${AMORE.burdeos}` } : { backgroundColor: "#fff", color: AMORE.texto, border: `1px solid ${AMORE.borde}` }}
          >
            <Icono className="size-4" strokeWidth={1.6} />
            <span className="whitespace-nowrap">{cat}</span>
            {marcados > 0 && (
              <span
                className="flex size-[18px] items-center justify-center rounded-full text-[11px] font-semibold"
                style={activa ? { backgroundColor: "#fff", color: AMORE.burdeos } : { backgroundColor: AMORE.burdeos, color: "#fff" }}
                aria-label={`${marcados} elegidos`}
              >
                {marcados}
              </span>
            )}
          </button>
        );
      })}
      <span className="w-2 shrink-0" aria-hidden />
    </div>
  );

  const accion = (
    <div>
      {elegidos.length > 0 && (
        <div className="-mx-4 mb-2.5 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Servicios elegidos">
          {elegidos.map((s) => (
            <span key={s.id} className="flex h-8 shrink-0 items-center gap-1 rounded-full pl-3 pr-1 text-[12.5px] font-medium" style={{ backgroundColor: AMORE.burdeosSuave, color: AMORE.texto }}>
              <span className="max-w-[170px] truncate">{s.nombre}</span>
              <button
                type="button"
                aria-label={`Quitar ${s.nombre}`}
                onClick={() => onCambiarSeleccion(seleccionIds.filter((id) => id !== s.id))}
                className="flex size-6 items-center justify-center rounded-full active:bg-black/10"
              >
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </span>
          ))}
          <span className="w-2 shrink-0" aria-hidden />
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1" aria-live="polite">
          {elegidos.length === 0 ? (
            <p className="text-[12.5px] leading-snug" style={{ color: AMORE.textoSecundario }}>
              Elige uno o más servicios
            </p>
          ) : (
            <>
              <p className="text-[13.5px] font-semibold" style={{ color: AMORE.texto }}>
                {resumen.cantidad === 1 ? "1 servicio" : `${resumen.cantidad} servicios`}
              </p>
              <p className="text-[12px]" style={{ color: AMORE.textoSecundario }}>
                {formatearDuracion(resumen.duracionMin)}
                {resumen.precioTotal != null && (
                  <>
                    {" · "}
                    <span className="font-semibold" style={{ color: AMORE.burdeos }}>
                      {formatearPrecioCop(resumen.precioTotal)}
                    </span>
                  </>
                )}
              </p>
            </>
          )}
        </div>
        <ContinuarAmore disabled={elegidos.length === 0} onClick={onContinuar} />
      </div>
    </div>
  );

  return (
    <MarcoPasoAmore
      negocio={negocio}
      onVolver={onVolver}
      paso={1}
      titulo="Elige tus servicios"
      subtitulo={maxServicios > 1 ? `Puedes combinar hasta ${maxServicios} en una misma cita, por ejemplo manos y pies.` : "Elige el servicio que deseas."}
      superior={categoriasUI || undefined}
      accion={servicios.length > 0 ? accion : undefined}
    >
      {servicios.length === 0 ? (
        <p className="mt-6 text-center text-[14px]" style={{ color: AMORE.textoSecundario }}>
          AMORE todavía no tiene servicios disponibles para reservar en línea.
        </p>
      ) : (
        <>
          {limiteAlcanzado && maxServicios > 1 && (
            <p className="mb-2.5 rounded-xl px-3 py-2 text-center text-[12px]" style={{ backgroundColor: AMORE.doradoSuave, color: AMORE.texto }}>
              Llegaste al máximo de {maxServicios} servicios por cita. Quita uno para elegir otro.
            </p>
          )}
          <ul className="flex flex-col gap-2.5" aria-label={categoriaActual ? `Servicios de ${categoriaActual}` : "Servicios"}>
            {serviciosDeCategoria.map((s) => {
              const marcado = seleccionIds.includes(s.id);
              const bloqueado = !marcado && limiteAlcanzado;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={marcado}
                    aria-disabled={bloqueado}
                    onClick={() => {
                      if (!bloqueado) onCambiarSeleccion(alternarServicio(seleccionIds, s.id, maxServicios));
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors"
                    style={{ backgroundColor: marcado ? AMORE.burdeosSuave : "#fff", border: `1.5px solid ${marcado ? AMORE.burdeos : AMORE.borde}`, opacity: bloqueado ? 0.5 : 1 }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold leading-snug" style={{ color: AMORE.texto }}>
                        {s.nombre}
                      </span>
                      {s.descripcion ? (
                        <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug" style={{ color: AMORE.textoSecundario }}>
                          {s.descripcion}
                        </span>
                      ) : null}
                      <span className="mt-1.5 flex items-center gap-3">
                        {s.precio != null && (
                          <span className="text-[13.5px] font-semibold" style={{ color: AMORE.burdeos }}>
                            {formatearPrecioCop(s.precio)}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-[11.5px]" style={{ color: AMORE.textoSecundario }}>
                          <Clock className="size-3.5" strokeWidth={1.6} />
                          {formatearDuracion(s.duracion_min)}
                        </span>
                      </span>
                    </span>
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded-md"
                      style={marcado ? { backgroundColor: AMORE.burdeos, border: `1.5px solid ${AMORE.burdeos}` } : { backgroundColor: "#fff", border: `1.5px solid ${AMORE.borde}` }}
                    >
                      {marcado ? <Check className="size-4 text-white" strokeWidth={2.75} /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </MarcoPasoAmore>
  );
}
