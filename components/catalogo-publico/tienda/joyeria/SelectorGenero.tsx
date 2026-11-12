/**
 * Selector «Mujer | Hombre» del tema "joyeria" (Delacour · Vértice): dos enlaces, uno por lado de la tienda, el del lado actual marcado. Son ENLACES normales (funcionan sin JavaScript y cada lado se
 * puede compartir): «Mujer» lleva a la tienda de siempre y «Hombre» al listado de hombre (`?genero=hombre`). Presentación pura (el lado actual lo decide quien lo dibuja, con la misma regla que
 * pinta el tema), así se prueba sin navegador.
 *
 * Variantes: «nav» (cabecera de escritorio; hereda el color del texto de la cabecera, claro sobre la portada y oscuro sobre el vidrio), «menu» (el menú lateral: a todo el ancho y más alto, para el
 * dedo) y «listado» (bajo el título de las páginas de listado: es lo que ve un celular sin abrir el menú).
 */
import Link from "next/link";
import { hrefDeGenero, type Genero } from "@/lib/catalogo/genero";

function cn(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
}

export function SelectorGenero({
  basePath,
  hombre,
  etiquetas,
  variante = "nav",
  alElegir,
  className,
}: {
  basePath: string;
  /** El lado actual: true = hombre. */
  hombre: boolean;
  etiquetas: { mujer: string; hombre: string };
  variante?: "nav" | "menu" | "listado";
  /** Para cerrar el menú lateral al elegir. */
  alElegir?: () => void;
  className?: string;
}) {
  const lados: ReadonlyArray<{ genero: Genero; etiqueta: string; activo: boolean }> = [
    { genero: "mujer", etiqueta: etiquetas.mujer, activo: !hombre },
    { genero: "hombre", etiqueta: etiquetas.hombre, activo: hombre },
  ];
  return (
    <div className={cn("joy-genero", variante !== "nav" && `joy-genero-${variante}`, className)} role="group" aria-label="Ver la tienda para">
      {lados.map((l) => (
        <Link key={l.genero} href={hrefDeGenero(basePath, l.genero)} onClick={alElegir} className="joy-genero-lado" aria-current={l.activo ? "true" : undefined} data-lado={l.genero}>
          {l.etiqueta}
        </Link>
      ))}
    </div>
  );
}
