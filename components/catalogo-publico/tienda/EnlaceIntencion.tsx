"use client";

/**
 * Enlace que precarga la ficha SOLO ante intención del cliente (pasar el mouse, tocar, enfocar
 * con teclado), no al entrar en pantalla. Patrón recomendado por Next 16 para grillas de tarjetas
 * ("Hover-triggered prefetch", guides/prefetching).
 *
 * Por qué (Bloque 21, medido): con el Link por defecto, abrir el listado y hacer scroll en un
 * celular disparaba 53 precargas de fichas = 470 consultas a la BD por una sola visita, y
 * cualquier límite de tasa razonable habría castigado a clientes normales.
 */
import Link from "next/link";
import { useState, type ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof Link>, "prefetch">;

export function EnlaceIntencion({ onMouseEnter, onTouchStart, onFocus, ...props }: Props) {
  const [intencion, setIntencion] = useState(false);
  return (
    <Link
      {...props}
      prefetch={intencion ? null : false}
      onMouseEnter={(e) => {
        setIntencion(true);
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        setIntencion(true);
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        setIntencion(true);
        onFocus?.(e);
      }}
    />
  );
}
