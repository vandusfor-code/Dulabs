"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";

// Primera URL cargada de la tienda en esta pestaña (se reinicia con cada carga completa).
let llegada: string | null = null;
const urlActual = () => window.location.pathname + window.location.search;

/** Registra la URL de llegada. Va en el layout de la tienda (se monta una vez por carga). */
export function MarcadorLlegada() {
  useEffect(() => {
    if (llegada === null) llegada = urlActual();
  }, []);
  return null;
}

/**
 * "Volver": si el cliente llegó a la ficha navegando dentro de la tienda,
 * regresa a donde estaba (inicio, búsqueda o categoría, con su scroll). Si
 * abrió el link directo (p. ej. desde WhatsApp), va al catálogo completo.
 * Es un enlace real: funciona también sin JavaScript.
 */
export function BotonVolver({ listPath }: { listPath: string }) {
  const router = useRouter();
  return (
    <Link
      href={listPath}
      onClick={(e) => {
        if (llegada !== null && llegada !== urlActual()) {
          e.preventDefault();
          router.back();
        }
      }}
      className="-ml-2 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-mist transition-colors hover:text-fg"
    >
      <ArrowLeft className="size-4" strokeWidth={1.8} aria-hidden />
      Volver al catálogo
    </Link>
  );
}
