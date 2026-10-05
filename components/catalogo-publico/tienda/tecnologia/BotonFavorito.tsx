"use client";

/**
 * Corazón de la tarjeta. UI LISTA para conectarse: hoy NO guarda nada (ni en el navegador ni en la BD): el estado vive solo mientras la página está
 * abierta. Cuando exista la función de favoritos basta con pasar `activo` y `onCambio` desde arriba; el componente no cambia.
 */
import { useState } from "react";
import { Heart } from "lucide-react";

export function BotonFavorito({ nombre, activo, onCambio }: { nombre: string; activo?: boolean; onCambio?: (nuevo: boolean) => void }) {
  const [local, setLocal] = useState(false);
  const valor = activo ?? local;
  return (
    <button
      type="button"
      aria-pressed={valor}
      aria-label={valor ? `Quitar ${nombre} de favoritos` : `Guardar ${nombre} en favoritos`}
      onClick={() => {
        const nuevo = !valor;
        setLocal(nuevo);
        onCambio?.(nuevo);
      }}
      className="absolute right-2 top-2 z-10 grid size-9 place-items-center rounded-full bg-white/85 text-[#64748b] shadow-[0_1px_3px_rgba(7,20,38,0.12)] backdrop-blur-sm transition-[color,transform] duration-150 hover:text-[var(--tech-offer)] active:scale-90"
    >
      <Heart className={"size-[19px] transition-colors " + (valor ? "fill-[var(--tech-offer)] text-[var(--tech-offer)]" : "")} strokeWidth={1.8} aria-hidden />
    </button>
  );
}
