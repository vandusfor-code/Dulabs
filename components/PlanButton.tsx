"use client";

import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";

const PLAN_PENDIENTE_KEY = "du_labs_plan_elegido";

export default function PlanButton({
  plan,
  className,
}: {
  plan: string;
  className: string;
}) {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <button
      type="button"
      onClick={() => {
        localStorage.setItem(PLAN_PENDIENTE_KEY, plan);
        router.push("/dashboard/conexion");
      }}
      className={className}
    >
      {t("Elegir", "Choose")} {plan}
    </button>
  );
}
