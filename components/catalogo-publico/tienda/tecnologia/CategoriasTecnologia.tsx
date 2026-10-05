/**
 * Franja de categorías del tema "tecnologia": tarjetas compactas con scroll horizontal (nunca una cuadrícula enorme).
 * Las categorías son las REALES del catálogo (las que el negocio crea en su panel); la franja se llena sola cuando crea más.
 * El icono se elige por el nombre (lib/catalogo/vitrina.ts → iconoDeCategoria). Sin categorías no hay franja (nada inventado).
 * `activa` marca la categoría seleccionada (borde, icono y fondo azules): en el inicio no hay ninguna seleccionada. Server Component.
 */
import { EnlaceIntencion } from "@/components/catalogo-publico/tienda/EnlaceIntencion";
import { IconoDeCategoria, IconoVerMas } from "@/components/catalogo-publico/tienda/tecnologia/IconosTecnologia";
import type { CatalogCategory } from "@/lib/catalogo/domain";
import { iconoDeCategoria } from "@/lib/catalogo/vitrina";

const cuadro = "grid size-[62px] place-items-center rounded-[18px] border transition-[border-color,background-color,transform] duration-150 group-active:scale-95";

export function CategoriasTecnologia({
  categorias,
  basePath,
  listPath,
  activa,
}: {
  categorias: readonly CatalogCategory[];
  basePath: string;
  listPath: string;
  activa?: string;
}) {
  if (categorias.length === 0) return null;
  return (
    <section id="categorias" aria-label="Categorías" className="scroll-mt-24">
      <ul className="tienda-scroll -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
        {categorias.map((c) => {
          const seleccionada = c.id === activa;
          return (
            <li key={c.id} className="shrink-0 snap-start">
              <EnlaceIntencion
                href={`${basePath}?categoria=${encodeURIComponent(c.id)}`}
                aria-current={seleccionada ? "true" : undefined}
                className="group flex w-[76px] flex-col items-center gap-2 py-0.5"
              >
                <span className={cuadro + (seleccionada ? " border-[var(--tech-blue)] bg-[var(--tienda-oro-suave)] text-[var(--tech-blue)]" : " border-edge bg-[var(--tech-surface)] text-[#334155] group-hover:border-[var(--tech-blue)]/60")}>
                  <IconoDeCategoria icono={iconoDeCategoria(c.name)} className="size-[26px]" />
                </span>
                <span className={"line-clamp-1 max-w-full px-0.5 text-center text-[12.5px] " + (seleccionada ? "font-semibold text-[var(--tech-blue)]" : "font-medium text-fg")}>{c.name}</span>
              </EnlaceIntencion>
            </li>
          );
        })}
        <li className="shrink-0 snap-start">
          <EnlaceIntencion href={listPath} className="group flex w-[76px] flex-col items-center gap-2 py-0.5">
            <span className={cuadro + " border-edge bg-[var(--tech-surface)] text-[#334155] group-hover:border-[var(--tech-blue)]/60"}>
              <IconoVerMas className="size-[26px]" strokeWidth={1.6} aria-hidden />
            </span>
            <span className="text-center text-[12.5px] font-medium text-fg">Ver más</span>
          </EnlaceIntencion>
        </li>
      </ul>
    </section>
  );
}
