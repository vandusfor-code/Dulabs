/**
 * PÁGINA propia de la tienda del tema "joyeria" (/catalogo/{tienda}/p/{código}): la política de privacidad, los términos y condiciones, los cambios y garantías… que la administradora escribió en el
 * panel. Una pantalla de lectura: título, la fecha de la última actualización y el texto en bloques (subtítulos, párrafos y listas).
 *
 * Todo es TEXTO PLANO: React lo escapa al dibujarlo, así que nada de lo escrito puede volverse una etiqueta, un enlace ni un script. Los saltos de línea de un párrafo se respetan. Server Component.
 */
import { fechaDePagina, type PaginaVista } from "@/lib/cms-comercial/pagina";

/** Filete dorado con rombo, el mismo del resto de la tienda. */
function Ornamento() {
  return (
    <div className="mx-auto mt-5 flex items-center justify-center gap-3" aria-hidden>
      <span className="h-px w-10 bg-[var(--joy-oro)]" />
      <span className="text-[10px] text-[var(--joy-oro)]">◆</span>
      <span className="h-px w-10 bg-[var(--joy-oro)]" />
    </div>
  );
}

const TEXTO = "whitespace-pre-line [overflow-wrap:anywhere]";

export function PaginaTienda({ pagina, marca }: { pagina: PaginaVista; marca: string }) {
  const fecha = fechaDePagina(pagina.actualizadaAt);
  return (
    <article className="joy-compensa bg-ink" aria-labelledby="joy-pagina-titulo">
      <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-12 sm:px-6 md:pb-24 md:pt-16 lg:px-8">
        <header className="text-center">
          <p className="text-[11px] font-normal uppercase tracking-[0.3em] text-[var(--tienda-oro)]">{marca}</p>
          <h1 id="joy-pagina-titulo" className="font-serif-tienda mt-3 text-[clamp(2rem,6vw,3.25rem)] font-medium leading-[1.08] text-fg [overflow-wrap:anywhere]">
            {pagina.titulo}
          </h1>
          <Ornamento />
          {fecha && <p className="mt-5 text-xs text-mist">Última actualización: {fecha}</p>}
        </header>

        <div className="mt-10 space-y-5 text-[15px] leading-[1.8] text-fg md:text-base">
          {pagina.bloques.map((b, i) => {
            if (b.tipo === "subtitulo") {
              return (
                <h2 key={i} className={`font-serif-tienda pt-4 text-[22px] font-medium leading-snug text-fg md:text-[26px] ${TEXTO}`}>
                  {b.texto}
                </h2>
              );
            }
            if (b.tipo === "lista") {
              return (
                <ul key={i} role="list" className="list-disc space-y-2 pl-6 marker:text-[var(--tienda-oro)]">
                  {b.items.map((item, j) => (
                    <li key={j} className={TEXTO}>
                      {item}
                    </li>
                  ))}
                </ul>
              );
            }
            return (
              <p key={i} className={TEXTO}>
                {b.texto}
              </p>
            );
          })}
        </div>
      </div>
    </article>
  );
}

/** Cuando la página existe pero hoy no se pudo leer (un fallo o una lectura muy lenta): se dice con claridad y se invita a intentar de nuevo. */
export function PaginaNoDisponible() {
  return (
    <div className="joy-no-encontrada mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-mist">No pudimos cargarla</p>
      <h1 className="font-serif-tienda mt-3 text-[32px] font-medium leading-tight text-fg">Esta página no está disponible en este momento</h1>
      <p className="mt-3 text-[15px] text-mist">Vuelve a intentarlo en unos segundos. Si el problema sigue, escríbenos y te ayudamos.</p>
    </div>
  );
}
