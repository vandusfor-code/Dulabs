"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Pieza inexistente o desactivada DENTRO de la tienda mayorista: la salida
// vuelve al listado MAYORISTA (nunca al detal). El canal sale de la URL:
// /catalogo/{slug}/mayor/{token}/…
export default function PiezaMayorNoEncontrada() {
  const [, , slug = "", , token = ""] = usePathname().split("/");
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-mist">No disponible</p>
      <h1 className="font-serif-tienda mt-3 text-[32px] font-medium leading-tight text-fg">Esta pieza ya no está en el catálogo</h1>
      <p className="mt-3 text-[15px] text-mist">Puede que se haya agotado o retirado. Te invitamos a ver las piezas disponibles.</p>
      <Link
        href={`/catalogo/${encodeURIComponent(slug)}/mayor/${encodeURIComponent(token)}`}
        className="mt-8 inline-flex h-12 items-center rounded-full bg-[var(--tienda-oro)] px-6 text-[15px] font-medium text-white transition-[background-color,transform] duration-150 hover:bg-[var(--tienda-oro-hover)] active:scale-95"
      >
        Ver el catálogo mayorista
      </Link>
    </div>
  );
}
