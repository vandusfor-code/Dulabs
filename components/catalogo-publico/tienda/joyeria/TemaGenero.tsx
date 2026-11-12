"use client";

/**
 * Tema del lado de hombre (Delacour · Vértice): avisa a la página «estoy en el lado de hombre» con un atributo (`data-tema-genero="hombre"`), y el CSS (app/globals.css, «Lado de hombre») pinta TODA la
 * tienda —cabecera, listado, ficha y pie— con la paleta de Vértice, grafito y plata. No dibuja nada visible.
 *
 * Por qué así y no desde cada página: la cabecera y el pie son del marco de la tienda (se dibujan una sola vez y la página cambia por dentro), y el marco no conoce la dirección. Este componente la lee
 * (`?genero=hombre`, o la ficha de una pieza que es de hombre) con la lista de referencias que el servidor ya mandó, así que:
 *   - la primera pantalla sale con el color correcto (el servidor también dibuja este componente con la dirección pedida): sin un parpadeo de claro a oscuro;
 *   - al tocar «Hombre» o «Mujer» el color cambia al instante, sin esperar a que llegue la página nueva.
 * Solo presentación: ningún dato, precio, carrito ni pedido cambia.
 */
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { ATRIBUTO_TEMA_GENERO, conjuntoDeHombres, temaDeHombre } from "@/lib/catalogo/genero";

/** ¿Esta dirección es del lado de hombre? Lo usan el marcador del tema y el selector Mujer | Hombre (mismo criterio, una sola decisión). */
export function useLadoDeHombre(basePath: string, hombres: readonly string[]): boolean {
  const pathname = usePathname();
  const params = useSearchParams();
  const conjunto = useMemo(() => conjuntoDeHombres(hombres), [hombres]);
  return temaDeHombre({ basePath, pathname, genero: params.get("genero"), hombres: conjunto });
}

export function TemaGenero({ basePath, hombres }: { basePath: string; hombres: readonly string[] }) {
  const activo = useLadoDeHombre(basePath, hombres);
  if (!activo) return null;
  // `hidden`: el atributo es solo una señal para el CSS (`:has`), nunca contenido.
  return <span hidden {...{ [ATRIBUTO_TEMA_GENERO]: "hombre" }} />;
}
