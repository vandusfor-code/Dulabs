"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { trackConversion, type ConversionEvent } from "@/lib/site-analytics";

type Props = Omit<ComponentProps<"a">, "href" | "onClick"> & {
  href: string;
  /** Evento de conversión (lib/site-analytics.ts). Sin evento, el enlace es un <Link> normal. */
  event?: ConversionEvent;
  /** Dónde está el CTA (hero, nav, cierre...) para distinguirlo en analítica. */
  source: string;
  onNavigate?: () => void;
};

// Único punto cliente para CTAs de la home: reutiliza trackConversion (mismo dataLayer/gtag/fbq que el resto del sitio) en vez de
// duplicar tracking. Los enlaces externos (WhatsApp) abren en pestaña nueva con rel seguro.
export function TrackedLink({ href, event, source, onNavigate, children, ...rest }: Props) {
  const alHacerClick = () => {
    if (event) trackConversion(event, { source });
    onNavigate?.();
  };
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={alHacerClick} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} onClick={alHacerClick} {...rest}>
      {children}
    </Link>
  );
}
