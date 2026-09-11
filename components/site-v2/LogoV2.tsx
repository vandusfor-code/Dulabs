import type { CSSProperties } from "react";

/**
 * Wordmark de la V2: "duLabs" en negro + punto naranja distintivo.
 * El punto naranja es el elemento de identidad de la marca (regla 12 del
 * brief). Puramente tipográfico — funciona en navbar, footer y tamaños
 * pequeños sin depender de un asset de imagen.
 */
export function LogoV2({
  className = "",
  style,
  dotClassName = "",
}: {
  className?: string;
  style?: CSSProperties;
  dotClassName?: string;
}) {
  return (
    <span
      className={`inline-flex items-baseline font-display font-semibold tracking-[-0.02em] text-sitev2-fg ${className}`}
      style={style}
    >
      duLabs
      <span
        aria-hidden
        className={`ml-[0.09em] inline-block h-[0.28em] w-[0.28em] translate-y-[0.02em] rounded-full bg-sitev2-primary ${dotClassName}`}
      />
    </span>
  );
}
