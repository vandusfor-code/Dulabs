"use client";

import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { PLANES, type PlanId } from "@/lib/planes";

const PLAN_PENDIENTE_KEY = "du_labs_plan_elegido";

export default function PlanButton({
  planId,
  className,
}: {
  planId: PlanId;
  className: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const nombre = PLANES[planId].nombre;

  return (
    <button
      type="button"
      onClick={() => {
        if (planId === "enterprise") {
          window.location.href = "mailto:contacto@dulabs.co?subject=Plan%20Enterprise";
          return;
        }
        // Se guarda el ID del plan (ej. "growth"), no el nombre mostrado —
        // es lo que el backend valida en /api/pagos/suscribir.
        localStorage.setItem(PLAN_PENDIENTE_KEY, planId);
        router.push("/dashboard/conexion");
      }}
      className={className}
    >
      {planId === "enterprise" ? t("Hablar con ventas", "Talk to sales") : `${t("Elegir", "Choose")} ${nombre}`}
    </button>
  );
}
