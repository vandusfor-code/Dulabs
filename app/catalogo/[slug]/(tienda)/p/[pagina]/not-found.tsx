"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Una página propia que no existe, que se retiró o que todavía no se publicó (p. ej. un enlace viejo del pie): se responde dentro de la tienda, con salida clara al inicio.
// not-found no recibe params: la tienda se deduce de la URL (/catalogo/{slug}/p/…).
export default function PaginaNoEncontrada() {
  const slug = usePathname().split("/")[2] ?? "";
  return (
    <div className="joy-no-encontrada mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-mist">No disponible</p>
      <h1 className="font-serif-tienda mt-3 text-[32px] font-medium leading-tight text-fg">Esta página no está disponible</h1>
      <p className="mt-3 text-[15px] text-mist">Puede que se haya retirado o que el enlace esté incompleto. Te invitamos a volver al inicio de la tienda.</p>
      <Link
        href={`/catalogo/${encodeURIComponent(slug)}`}
        className="mt-8 inline-flex h-12 items-center rounded-full bg-[var(--tienda-oro)] px-6 text-[15px] font-medium text-white transition-[background-color,transform] duration-150 hover:bg-[var(--tienda-oro-hover)] active:scale-95"
      >
        Ir al inicio
      </Link>
    </div>
  );
}
