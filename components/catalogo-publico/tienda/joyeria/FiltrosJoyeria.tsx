"use client";

/**
 * Filtros del listado del tema "joyeria" (Bloque 30): categoría, color, material y rango de precio, como el panel de la referencia. SOLO presentación y navegación: muestra las opciones
 * y los conteos que ya calculó el servidor (lib/catalogo/filtros.ts) y escribe la elección en la dirección (`?categoria=…&color=…&material=…&precio_min=…&precio_max=…`), de modo que cada
 * vista se puede compartir y el servidor sigue siendo quien decide qué productos se ven (ningún precio, inventario ni dato se toca).
 *
 * Escritorio: columna fija a la izquierda. Celular: botón «Filtrar» y una hoja inferior (diálogo nativo). Cada cambio se aplica al instante, sin botón: las casillas responden en el mismo
 * fotograma (estado optimista) y la lista se atenúa mientras llega la nueva. Sin JavaScript es un formulario GET normal con su botón «Aplicar filtros».
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useOptimistic, useRef, useState, useTransition, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Dialogo } from "@/components/catalogo-publico/tienda/Dialogo";
import { SIN_FILTROS, formatoPrecio, hayFiltros as hayFiltrosDe, puntoDeColor, urlFiltros, PRECIO_PASO, type FacetasCatalogo, type FiltrosCatalogo } from "@/lib/catalogo/filtros";

/** Espera tras el último movimiento del deslizador antes de aplicar el rango (mientras se arrastra no se recarga la lista a cada fotograma). */
const ESPERA_PRECIO_MS = 350;

type GrupoLista = "categorias" | "colores" | "materiales";
type Rango = readonly [number, number];

/** Clic normal con el botón principal: con Ctrl, Cmd, Shift o Alt el navegador abre la dirección donde corresponda. */
const clicSimple = (e: MouseEvent<HTMLElement>) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

function cuantosFiltros(f: FiltrosCatalogo): number {
  return f.categorias.length + f.colores.length + f.materiales.length + (f.precioMin !== undefined || f.precioMax !== undefined ? 1 : 0);
}

function Opcion({ id, nombre, valor, etiqueta, n, marcada, punto, alCambiar }: { id: string; nombre: string; valor: string; etiqueta: string; n: number; marcada: boolean; punto?: string | null; alCambiar: () => void }) {
  return (
    <li>
      <label htmlFor={id} className="joy-filtro-fila">
        <input id={id} type="checkbox" name={nombre} value={valor} checked={marcada} onChange={alCambiar} className="joy-filtro-caja" />
        {punto && <span className="joy-filtro-punto" style={{ backgroundColor: punto }} aria-hidden />}
        <span className="joy-filtro-texto">{etiqueta}</span>
        {/* El espacio solo cuenta para el nombre que leen los lectores de pantalla («Dorado (85)»): en una fila flex no se dibuja. */}{" "}
        <span className="joy-filtro-n">({n})</span>
      </label>
    </li>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="joy-filtro-grupo">
      <legend className="joy-filtro-titulo">{titulo}</legend>
      {children}
    </fieldset>
  );
}

/** Dos deslizadores encimados (mínimo y máximo) sobre una línea fina con el tramo elegido en dorado; solo las perillas reciben el puntero. */
function RangoPrecio({ id, limites, valor, alMover }: { id: string; limites: { min: number; max: number }; valor: Rango; alMover: (rango: Rango) => void }) {
  const [desde, hasta] = valor;
  const fraccion = (v: number) => (v - limites.min) / (limites.max - limites.min);
  const comun = { min: limites.min, max: limites.max, step: PRECIO_PASO, className: "joy-rango-input" } as const;
  return (
    <div>
      <div className="joy-rango" style={{ "--desde": fraccion(desde), "--hasta": fraccion(hasta) } as CSSProperties}>
        <span className="joy-rango-pista" aria-hidden />
        <span className="joy-rango-activa" aria-hidden />
        <input
          {...comun}
          type="range"
          id={`${id}-min`}
          aria-label="Precio mínimo"
          aria-valuetext={formatoPrecio(desde)}
          value={desde}
          // Con ambas perillas hacia el extremo alto, la del mínimo queda encima: si no, la del máximo taparía a la otra y no habría cómo bajar el rango.
          data-encima={desde > (limites.min + limites.max) / 2 ? "" : undefined}
          onChange={(e) => alMover([Math.min(Number(e.target.value), hasta), hasta])}
        />
        <input {...comun} type="range" id={`${id}-max`} aria-label="Precio máximo" aria-valuetext={formatoPrecio(hasta)} value={hasta} onChange={(e) => alMover([desde, Math.max(Number(e.target.value), desde)])} />
      </div>
      <p className="joy-rango-texto">
        {formatoPrecio(desde)} — {formatoPrecio(hasta)}
      </p>
    </div>
  );
}

function QuitarFiltros({ href, alQuitar }: { href: string; alQuitar: () => void }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm text-mist transition-colors hover:text-fg"
      onClick={(e) => {
        if (!clicSimple(e)) return;
        e.preventDefault();
        alQuitar();
      }}
    >
      <X className="size-3.5" aria-hidden />
      Quitar filtros
    </Link>
  );
}

export function FiltrosJoyeria({
  basePath,
  filtros,
  facetas,
  cuenta,
  children,
}: {
  basePath: string;
  /** Los filtros de la dirección (los que el servidor aplicó a la lista que llega en `children`). */
  filtros: FiltrosCatalogo;
  facetas: FacetasCatalogo;
  /** «24 productos»: lo calcula el servidor con el total del filtro. */
  cuenta: string;
  /** La lista de productos y la paginación (Server Components). */
  children: ReactNode;
}) {
  const id = useId();
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [elegidos, ponerElegidos] = useOptimistic(filtros);
  const [hojaAbierta, setHojaAbierta] = useState(false);
  // Mientras se mueve el deslizador (o se espera la lista nueva) manda este rango; después, el de la dirección.
  const [arrastre, setArrastre] = useState<Rango | null>(null);
  const enviado = useRef<Rango | null>(null);
  const vigente = useRef(elegidos);
  const limites = facetas.precio !== null && facetas.precio.max > facetas.precio.min ? facetas.precio : null;
  const limiteMin = limites?.min;
  const limiteMax = limites?.max;
  const quitarHref = urlFiltros(basePath, SIN_FILTROS);
  const hay = hayFiltrosDe(elegidos);
  const activos = cuantosFiltros(elegidos);

  useEffect(() => {
    vigente.current = elegidos;
  }, [elegidos]);

  // Cambio de filtros: se aplica sobre lo último elegido (dos clics seguidos no se pisan), se refleja al instante y navega a la dirección nueva sin saltar de lugar.
  // Devuelve false si el cambio deja la misma dirección (no hay nada que cargar).
  const aplicar = useCallback(
    (cambio: (actual: FiltrosCatalogo) => FiltrosCatalogo): boolean => {
      const siguiente = cambio(vigente.current);
      const destino = urlFiltros(basePath, siguiente);
      if (destino === urlFiltros(basePath, vigente.current)) return false;
      vigente.current = siguiente;
      empezar(() => {
        ponerElegidos(siguiente);
        router.push(destino, { scroll: false });
      });
      return true;
    },
    [basePath, empezar, ponerElegidos, router],
  );

  const alternar = (grupo: GrupoLista, valor: string) =>
    aplicar((f) => ({ ...f, [grupo]: f[grupo].includes(valor) ? f[grupo].filter((v) => v !== valor) : [...f[grupo], valor] }));
  const quitar = () => {
    setArrastre(null);
    aplicar(() => SIN_FILTROS);
  };

  // El rango se aplica un momento después del último movimiento; solo se escribe en la dirección el extremo que no está en el límite.
  useEffect(() => {
    if (arrastre === null || limiteMin === undefined || limiteMax === undefined) return;
    const espera = setTimeout(() => {
      enviado.current = arrastre;
      const cambio = aplicar((f) => ({ ...f, precioMin: arrastre[0] > limiteMin ? arrastre[0] : undefined, precioMax: arrastre[1] < limiteMax ? arrastre[1] : undefined }));
      // Si el rango quedó donde estaba no hay lista nueva que esperar: desde aquí lo dice la dirección.
      if (!cambio) setArrastre(null);
    }, ESPERA_PRECIO_MS);
    return () => clearTimeout(espera);
  }, [arrastre, aplicar, limiteMin, limiteMax]);
  // Llegó la lista nueva con el rango que se envió: desde aquí lo dice la dirección.
  useEffect(() => {
    if (pendiente || arrastre === null || enviado.current === null) return;
    if (arrastre[0] === enviado.current[0] && arrastre[1] === enviado.current[1]) setArrastre(null);
  }, [pendiente, arrastre]);

  // Si la pantalla pasa a escritorio con la hoja abierta (girar la tablet), se cierra: allí el panel ya está a la vista.
  useEffect(() => {
    if (!hojaAbierta || typeof window.matchMedia !== "function") return;
    const escritorio = window.matchMedia("(min-width: 1024px)");
    const alCambiar = () => {
      if (escritorio.matches) setHojaAbierta(false);
    };
    escritorio.addEventListener("change", alCambiar);
    return () => escritorio.removeEventListener("change", alCambiar);
  }, [hojaAbierta]);

  const valorPrecio: Rango | null =
    limiteMin === undefined || limiteMax === undefined
      ? null
      : (arrastre ?? [Math.min(Math.max(elegidos.precioMin ?? limiteMin, limiteMin), limiteMax), Math.min(Math.max(elegidos.precioMax ?? limiteMax, limiteMin), limiteMax)]);

  const panel = (sufijo: string) => {
    const base = `${id}-${sufijo}`;
    return (
      <form method="get" action={basePath} className="joy-filtros" onSubmit={(e) => e.preventDefault()}>
        {/* Sin JavaScript el formulario va a «?todo=1&…» (el listado) y el servidor aplica lo marcado. */}
        <input type="hidden" name="todo" value="1" />
        {elegidos.precioMin !== undefined && <input type="hidden" name="precio_min" value={elegidos.precioMin} />}
        {elegidos.precioMax !== undefined && <input type="hidden" name="precio_max" value={elegidos.precioMax} />}
        {hay && (
          <div className="mb-5 flex justify-end">
            <QuitarFiltros href={quitarHref} alQuitar={quitar} />
          </div>
        )}
        {facetas.categorias.length > 0 && (
          <Grupo titulo="Categoría del producto">
            <ul className="joy-filtro-lista" role="list">
              {facetas.categorias.map((c) => (
                <Opcion key={c.id} id={`${base}-cat-${c.id}`} nombre="categoria" valor={c.id} etiqueta={c.nombre} n={c.n} marcada={elegidos.categorias.includes(c.id)} alCambiar={() => alternar("categorias", c.id)} />
              ))}
            </ul>
          </Grupo>
        )}
        {facetas.colores.length > 0 && (
          <Grupo titulo="Color">
            <ul className="joy-filtro-lista" role="list">
              {facetas.colores.map((c) => (
                <Opcion key={c.clave} id={`${base}-col-${c.clave.replace(/\s+/g, "-")}`} nombre="color" valor={c.clave} etiqueta={c.etiqueta} n={c.n} marcada={elegidos.colores.includes(c.clave)} punto={puntoDeColor(c.clave)} alCambiar={() => alternar("colores", c.clave)} />
              ))}
            </ul>
          </Grupo>
        )}
        {facetas.materiales.length > 0 && (
          <Grupo titulo="Material">
            <ul className="joy-filtro-lista" role="list">
              {facetas.materiales.map((m) => (
                <Opcion key={m.clave} id={`${base}-mat-${m.clave.replace(/\s+/g, "-")}`} nombre="material" valor={m.clave} etiqueta={m.etiqueta} n={m.n} marcada={elegidos.materiales.includes(m.clave)} alCambiar={() => alternar("materiales", m.clave)} />
              ))}
            </ul>
          </Grupo>
        )}
        {limites && valorPrecio && (
          <Grupo titulo="Rango de precio">
            <RangoPrecio id={`${base}-precio`} limites={limites} valor={valorPrecio} alMover={setArrastre} />
          </Grupo>
        )}
        <noscript>
          <button type="submit" className="joy-boton-linea mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg border px-5 text-sm tracking-[0.06em]">
            Aplicar filtros
          </button>
        </noscript>
      </form>
    );
  };

  return (
    <div className="mx-auto flex max-w-7xl gap-10 px-4 sm:px-6 lg:px-8">
      <aside className="hidden w-60 shrink-0 lg:block" aria-label="Filtros del catálogo">
        {panel("e")}
      </aside>

      <div className="min-w-0 flex-1">
        {/* Como en la referencia: el conteo a la izquierda y, en celular, el botón «Filtrar» a la derecha. */}
        <div className="mb-4 flex min-h-9 items-center justify-between gap-4 text-xs text-mist">
          <div className="flex items-center gap-4">
            <p role="status">{cuenta}</p>
            {hay && (
              <span className="lg:hidden">
                <QuitarFiltros href={quitarHref} alQuitar={quitar} />
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setHojaAbierta(true)}
            aria-haspopup="dialog"
            className="joy-boton-linea inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm lg:hidden"
          >
            <SlidersHorizontal className="size-4" strokeWidth={1.6} aria-hidden />
            Filtrar{" "}
            {activos > 0 && (
              <span className="joy-filtro-contador">
                {activos}
                <span className="sr-only"> {activos === 1 ? "filtro activo" : "filtros activos"}</span>
              </span>
            )}
          </button>
        </div>

        <div className="joy-resultados" data-pendiente={pendiente ? "" : undefined} aria-busy={pendiente}>
          {children}
        </div>
      </div>

      <Dialogo open={hojaAbierta} onClose={() => setHojaAbierta(false)} label="Filtros del catálogo" persistente className="joy-hoja">
        <div className="joy-hoja-marco">
          <div className="joy-hoja-cab">
            <h2 className="text-lg font-medium text-fg">Filtros</h2>
            <button type="button" onClick={() => setHojaAbierta(false)} className="joy-icono size-9" aria-label="Cerrar filtros">
              <X className="size-5" strokeWidth={1.5} aria-hidden />
            </button>
          </div>
          <div className="joy-hoja-cuerpo">{panel("h")}</div>
          {/* Los filtros ya se aplicaron al elegirlos: el botón solo cierra la hoja y la leyenda dice cuántos productos hay con lo elegido (como en la referencia). */}
          <div className="joy-hoja-pie">
            <button type="button" onClick={() => setHojaAbierta(false)} className="joy-boton-linea w-full rounded-lg border py-3 text-sm tracking-[0.1em]">
              Filtrar
            </button>
            <p role="status" className="mt-2 text-center text-xs text-mist">
              {cuenta} con los filtros actuales
            </p>
          </div>
        </div>
      </Dialogo>
    </div>
  );
}
