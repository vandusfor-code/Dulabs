/**
 * Beneficios del tema "tecnologia": una tarjeta compacta de cuatro columnas (gris muy claro, esquinas de 20 px). En pantallas angostas las columnas
 * conservan un ancho mínimo y la tarjeta se desplaza en horizontal, sin ocupar alto de más. Texto editorial por negocio (lib/catalogo/vitrina.ts).
 * Server Component.
 */
import { IconoDeBeneficio } from "@/components/catalogo-publico/tienda/tecnologia/IconosTecnologia";
import type { BeneficioVitrina } from "@/lib/catalogo/vitrina";

export function BeneficiosTecnologia({ beneficios }: { beneficios: readonly BeneficioVitrina[] }) {
  if (beneficios.length === 0) return null;
  return (
    <section aria-label="Beneficios de comprar aquí" className="rounded-[20px] bg-[var(--tech-surface)]">
      <ul className="tienda-scroll flex snap-x overflow-x-auto py-3.5">
        {beneficios.map((b, i) => (
          <li key={b.titulo} className={"flex min-w-[88px] flex-1 snap-start flex-col gap-1 px-3 " + (i > 0 ? "border-l border-edge" : "")}>
            <IconoDeBeneficio icono={b.icono} className="mb-0.5 size-6 text-[var(--tech-navy)]" />
            <p className="text-[12.5px] font-semibold leading-tight text-fg">{b.titulo}</p>
            <p className="text-[11px] leading-snug text-mist">{b.detalle}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
