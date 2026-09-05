"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAdminWeb } from "./AdminWebContext";

// Panel web AMORE (autorizado, spec Fase 34) — /admin/amore es SOLO
// escritorio; en una pantalla angosta (<1024px, el mismo punto de corte
// que min-w del shell) redirige a la experiencia móvil YA existente y
// probada (/agenda/[token]) en vez de intentar mantener dos layouts
// responsive para el mismo panel -- la opción más segura de no romper
// nada, tal como pedía la spec.
//
// HALLAZGO REAL: window.innerWidth NO sirve acá -- el propio min-w-[1024px]
// del shell desktop infla el "layout viewport" del navegador (y con él
// innerWidth) al ancho mínimo del contenido, así que en un celular real
// innerWidth reportaría 1024 en vez de su ancho real, y esta guarda nunca
// dispararía. document.documentElement.clientWidth refleja el viewport
// VISUAL real (el que el usuario ve), sin importar cuánto se desborde el
// contenido -- es la única de las tres formas de medir ancho que no se ve
// afectada por el propio layout que se está evaluando.
export function MobileRedirectGuard() {
  const { token } = useAdminWeb();
  const router = useRouter();

  useEffect(() => {
    if (document.documentElement.clientWidth < 1024) router.replace(`/agenda/${token}`);
  }, [token, router]);

  return null;
}
