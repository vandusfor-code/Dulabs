"use client";

import { useI18n } from "@/lib/i18n";
import { PLANES, type PlanId } from "@/lib/planes";
import { mensajePlanWhatsapp, whatsappVentasUrl } from "@/lib/site-contact";

export default function PlanButton({
  planId,
  label,
  className,
}: {
  planId: PlanId;
  /** Texto del botón (viene de PRICING_COPY, ya traducido). Si se omite, usa un genérico. */
  label?: string;
  className: string;
}) {
  const { t, lang } = useI18n();
  const nombre = PLANES[planId].nombre;

  return (
    <a
      href={
        planId === "enterprise"
          ? "mailto:contacto@dulabs.co?subject=Plan%20Enterprise"
          : whatsappVentasUrl(mensajePlanWhatsapp(nombre, lang))
      }
      target={planId === "enterprise" ? undefined : "_blank"}
      rel={planId === "enterprise" ? undefined : "noopener noreferrer"}
      className={className}
    >
      {label ?? (planId === "enterprise" ? t("Hablar con ventas", "Talk to sales") : `${t("Quiero", "I want")} ${nombre}`)}
    </a>
  );
}
