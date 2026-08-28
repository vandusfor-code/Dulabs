"use client";

import { useI18n } from "@/lib/i18n";
import { trackConversion } from "@/lib/site-analytics";
import { PLANES, type PlanId } from "@/lib/planes";

// Start/Growth/Scale llevan directo a registro + pago en la plataforma
// (/login?plan=X guarda el plan elegido y /checkout lo recoge solo -- ver
// PLAN_PENDIENTE_KEY en app/login/page.tsx). Enterprise no tiene precio
// fijo, así que sigue yendo a contacto por correo.
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
  const { t } = useI18n();
  const nombre = PLANES[planId].nombre;

  return (
    <a
      href={planId === "enterprise" ? "mailto:contacto@dulabs.co?subject=Plan%20Enterprise" : `/login?plan=${planId}`}
      onClick={() => trackConversion("plan_select", { plan: planId })}
      className={className}
    >
      {label ?? (planId === "enterprise" ? t("Hablar con ventas", "Talk to sales") : `${t("Quiero", "I want")} ${nombre}`)}
    </a>
  );
}
