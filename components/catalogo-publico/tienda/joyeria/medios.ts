"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * Una media query del navegador como valor de React (sin parpadeo de hidratación: en el servidor vale `servidor`). Sirve para decidir comportamiento, no solo estilo:
 * por ejemplo, no rotar solo el anuncio con «movimiento reducido».
 */
export function useMedia(consulta: string, servidor = false): boolean {
  const suscribir = useMemo(
    () => (aviso: () => void) => {
      const m = window.matchMedia(consulta);
      m.addEventListener("change", aviso);
      return () => m.removeEventListener("change", aviso);
    },
    [consulta],
  );
  return useSyncExternalStore(suscribir, () => window.matchMedia(consulta).matches, () => servidor);
}

/** El cliente pidió menos movimiento (ajuste del sistema). */
export const useMovimientoReducido = () => useMedia("(prefers-reduced-motion: reduce)");
