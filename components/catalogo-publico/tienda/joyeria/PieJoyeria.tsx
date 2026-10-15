/**
 * Pie del tema "joyeria": nombre de la marca, su frase, columnas de enlaces, categorías, contacto, redes sociales y derechos. Lo dibuja a partir de un `PieVista` (lib/cms-comercial/pie.ts): el pie que
 * la administradora publicó en el CMS o, sin nada publicado (o ante cualquier problema al leerlo), el de siempre (inicio, catálogo, categorías, mayoristas y contacto por WhatsApp).
 * SOLO información que la tienda tiene o que la administradora escribió: nunca nada inventado. Server Component.
 */
import Link from "next/link";
import { IconoRed } from "@/components/catalogo-publico/tienda/joyeria/IconosRedes";
import type { CatalogCategory } from "@/lib/catalogo/domain";
import { enlaceWhatsapp } from "@/lib/catalogo/joyeria";
import { pieDeRespaldo, textoDerechos, type ColumnaPie, type ContactoPie, type EnlacePie, type PieVista, type RedPie } from "@/lib/cms-comercial/pie";

const TITULO = "text-xs font-medium uppercase tracking-[0.2em] text-[var(--tienda-oro)]";
const ENLACE = "joy-enlace-pie rounded-sm text-sm text-fg transition-colors hover:text-[var(--tienda-oro)]";
const ENLACE_LARGO = `${ENLACE} [overflow-wrap:anywhere]`;
const RED = "joy-red-pie inline-flex size-10 items-center justify-center rounded-full border border-edge text-fg transition-colors hover:border-[var(--tienda-oro)] hover:text-[var(--tienda-oro)]";

function EnlaceDelPie({ enlace }: { enlace: EnlacePie }) {
  // Lo que sale de la tienda (WhatsApp, direcciones externas) se abre en una pestaña nueva, sin enviar de dónde viene el cliente.
  if (enlace.externo) {
    return (
      <a href={enlace.href} target="_blank" rel="noopener noreferrer" className={ENLACE}>
        {enlace.texto}
      </a>
    );
  }
  return (
    <Link href={enlace.href} className={ENLACE}>
      {enlace.texto}
    </Link>
  );
}

function BloqueEnlaces({ columna }: { columna: ColumnaPie }) {
  return (
    <div className="space-y-3">
      <h2 className={TITULO}>{columna.titulo}</h2>
      <ul className="space-y-2" role="list">
        {columna.enlaces.map((e, i) => (
          <li key={`${e.href}-${i}`}>
            <EnlaceDelPie enlace={e} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BloqueContacto({ contacto }: { contacto: ContactoPie }) {
  return (
    <div className="col-span-2 space-y-3 sm:col-span-1">
      <h2 className={TITULO}>{contacto.titulo}</h2>
      <ul className="space-y-2" role="list">
        {contacto.whatsapp && (
          <li>
            <a href={contacto.whatsapp} target="_blank" rel="noopener noreferrer" className={ENLACE}>
              Escríbenos por WhatsApp
            </a>
          </li>
        )}
        {contacto.email && (
          <li>
            <a href={contacto.email.href} className={ENLACE_LARGO}>
              {contacto.email.texto}
            </a>
          </li>
        )}
        {contacto.telefono && (
          <li>
            <a href={contacto.telefono.href} className={ENLACE}>
              {contacto.telefono.texto}
            </a>
          </li>
        )}
        {contacto.direccion.length > 0 && (
          <li className="text-sm leading-relaxed text-mist">
            {contacto.direccion.map((linea, i) => (
              <span key={i} className="block">
                {linea}
              </span>
            ))}
          </li>
        )}
        {contacto.horario && <li className="text-sm leading-relaxed text-mist">{contacto.horario}</li>}
      </ul>
    </div>
  );
}

function BloqueRedes({ redes }: { redes: RedPie[] }) {
  const usuarios = redes.flatMap((r) => (r.usuario ? [r.usuario] : []));
  return (
    <div className="col-span-2 space-y-3 sm:col-span-1">
      <h2 className={TITULO}>Síguenos</h2>
      <ul className="flex flex-wrap gap-2" role="list">
        {redes.map((r) => (
          <li key={r.red}>
            <a href={r.href} target="_blank" rel="noopener noreferrer" aria-label={r.etiqueta} title={r.etiqueta} className={RED}>
              <IconoRed red={r.red} />
            </a>
          </li>
        ))}
      </ul>
      {usuarios.length > 0 && <p className="text-xs text-mist [overflow-wrap:anywhere]">{usuarios.join(" · ")}</p>}
    </div>
  );
}

export function PieJoyeria({
  marca,
  basePath,
  listPath,
  categorias,
  whatsapp,
  descripcion,
  mayorista,
  mayoristaHref,
  vista,
  anio,
}: {
  marca: { name: string; descriptor?: string };
  basePath: string;
  listPath: string;
  categorias: CatalogCategory[];
  whatsapp: string | null;
  descripcion?: string;
  /** Hay mayoristas que mostrar (el enlace «Mayoristas» aparece). */
  mayorista: boolean;
  /** A dónde lleva el enlace: la página propia o, sin ella, el bloque del inicio (`#mayoristas`, como siempre). */
  mayoristaHref?: string;
  /** El pie publicado en el CMS, ya resuelto contra lo que la tienda tiene hoy. Sin él, el pie de siempre (armado con lo de arriba). */
  vista?: PieVista;
  /** El año del «©» (las pruebas lo fijan; en la tienda es el año en curso). */
  anio?: number;
}) {
  const v: PieVista =
    vista ??
    pieDeRespaldo({ basePath, listPath, categorias, whatsappHref: enlaceWhatsapp(whatsapp), mayoristaHref: mayorista ? (mayoristaHref ?? `${basePath}#mayoristas`) : null, descripcion });

  // En el orden en que se leen: las columnas de enlaces, las categorías, el contacto y las redes.
  const bloques: React.ReactNode[] = v.columnas.map((c, i) => <BloqueEnlaces key={`columna-${i}`} columna={c} />);
  if (v.categorias) bloques.push(<BloqueEnlaces key="categorias" columna={v.categorias} />);
  if (v.contacto) bloques.push(<BloqueContacto key="contacto" contacto={v.contacto} />);
  if (v.redes.length > 0) bloques.push(<BloqueRedes key="redes" redes={v.redes} />);
  // Hasta tres bloques, en una fila de tres (como siempre); con más, dos filas o cuatro columnas.
  const rejilla = bloques.length <= 3 ? "sm:grid-cols-3" : bloques.length === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3";

  return (
    <footer className="joy-pie bg-ink-2 text-mist" aria-label="Pie de página">
      <div className="joy-filete" aria-hidden />
      <div className="mx-auto max-w-7xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-12 sm:px-6 md:pb-12 lg:px-8 lg:pt-14">
        <div className="flex flex-col items-center text-center">
          <span className="font-serif-tienda text-3xl font-semibold uppercase tracking-[0.16em] text-fg sm:text-4xl">{marca.name}</span>
          {marca.descriptor && <span className="mt-2 text-[10px] font-medium uppercase tracking-[0.4em] text-[var(--tienda-oro)] sm:text-xs">{marca.descriptor}</span>}
          {v.descripcion && <p className="mt-4 max-w-md text-sm leading-relaxed text-mist">{v.descripcion}</p>}
        </div>

        {bloques.length > 0 && <div className={`mt-10 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-edge pt-8 ${rejilla}`}>{bloques}</div>}

        <div className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-edge pt-6 text-xs text-mist sm:flex-row">
          <p>{textoDerechos(marca.name, v.derechos, anio ?? new Date().getFullYear())}</p>
          <p>
            Catálogo creado con{" "}
            <a href="https://www.dulabs.co" className="text-fg underline underline-offset-4 hover:text-[var(--tienda-oro)]">
              DuLabs
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
