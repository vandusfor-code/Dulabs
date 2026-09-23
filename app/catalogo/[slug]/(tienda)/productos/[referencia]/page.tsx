import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCop } from "@/lib/business-agent-quote";
import type { Availability } from "@/lib/catalogo/domain";
import { AccionesProducto } from "@/components/catalogo-publico/tienda/AccionesProducto";
import { BotonVolver } from "@/components/catalogo-publico/tienda/BotonVolver";
import { GaleriaProducto } from "@/components/catalogo-publico/tienda/GaleriaProducto";
import { cargarProducto, cargarTienda } from "@/lib/catalogo/public-loader";
import { retailPath } from "@/lib/catalogo/publicacion";

// Ficha pública de un producto (detal): /catalogo/{slug}/productos/{referencia}.
// La MISMA proyección pública del backend (referencia -> producto real), sin
// copias de datos; solo productos activos. La referencia es la identidad.
type Props = { params: Promise<{ slug: string; referencia: string }> };

const ESTADOS: Record<Availability, { texto: string; clase: string; punto: string }> = {
  available: { texto: "Disponible", clase: "bg-[var(--tienda-oro-suave)] text-fg", punto: "bg-[var(--tienda-oro)]" },
  low: { texto: "Últimas unidades", clase: "bg-[var(--tienda-oro-suave)] text-[var(--tienda-oro)]", punto: "bg-[var(--tienda-oro)]" },
  sold_out: { texto: "Agotado", clase: "bg-ink-2 text-mist", punto: "bg-mist" },
};

function EstadoDisponibilidad({ availability }: { availability: Availability }) {
  const e = ESTADOS[availability];
  return (
    <span className={"inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium " + e.clase}>
      <span className={"size-1.5 rounded-full " + e.punto} aria-hidden />
      {e.texto}
    </span>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, referencia } = await params;
  const [tienda, producto] = await Promise.all([cargarTienda(slug), cargarProducto(slug, referencia)]);
  if (!tienda || !producto) return { title: "Producto" };
  const titulo = `${producto.name} · ${tienda.publicName}`;
  const descripcion = [producto.reference, producto.material, producto.color].filter(Boolean).join(" · ");
  return {
    title: titulo,
    description: producto.description ?? descripcion,
    openGraph: { title: titulo, description: descripcion, images: producto.imageUrl ? [{ url: producto.imageUrl }] : undefined },
  };
}

export default async function ProductoPage({ params }: Props) {
  const { slug, referencia } = await params;
  const [tienda, producto] = await Promise.all([cargarTienda(slug), cargarProducto(slug, referencia)]);
  if (!tienda || !producto) notFound();

  const basePath = retailPath(tienda.slug);
  const listPath = `${basePath}?todo=1`;
  const categoria = producto.categoryId ? tienda.categories.find((c) => c.id === producto.categoryId) : undefined;
  const atributos = [
    { nombre: "Material", valor: producto.material },
    { nombre: "Color", valor: producto.color },
  ].filter((a): a is { nombre: string; valor: string } => Boolean(a.valor));

  return (
    <article className="pt-2 sm:pt-6">
      <BotonVolver listPath={listPath} />
      <div className="mt-2 grid gap-6 md:mt-4 md:grid-cols-2 md:gap-10 lg:gap-14">
        <GaleriaProducto images={producto.gallery} name={producto.name} />

        <div className="flex flex-col gap-5 md:py-2">
          <div>
            {categoria ? (
              <Link
                href={`${basePath}?categoria=${encodeURIComponent(categoria.id)}`}
                className="text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--tienda-oro)] underline-offset-4 hover:underline"
              >
                {categoria.name}
              </Link>
            ) : (
              producto.categoryName && <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-mist">{producto.categoryName}</p>
            )}
            <h1 className="font-serif-tienda mt-1.5 text-[34px] font-medium leading-[1.05] text-fg sm:text-5xl">{producto.name}</h1>
            <p className="mt-2 font-mono text-xs tracking-tight text-mist">Ref. {producto.reference}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <p className="text-2xl font-semibold tabular-nums text-fg">{producto.price === null ? <span className="text-lg font-medium text-mist">Precio a consultar</span> : formatCop(producto.price)}</p>
            <EstadoDisponibilidad availability={producto.availability} />
          </div>

          {producto.description && <p className="whitespace-pre-line text-[15px] leading-relaxed text-fg/85">{producto.description}</p>}

          {atributos.length > 0 && (
            <dl className="divide-y divide-edge rounded-[20px] border border-edge bg-card px-4">
              {atributos.map((a) => (
                <div key={a.nombre} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <dt className="text-mist">{a.nombre}</dt>
                  <dd className="text-right text-fg">{a.valor}</dd>
                </div>
              ))}
            </dl>
          )}

          <AccionesProducto product={producto} />
        </div>
      </div>
    </article>
  );
}
