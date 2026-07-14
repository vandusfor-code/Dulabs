"use client";

import { useRouter } from "next/navigation";

const PLAN_PENDIENTE_KEY = "du_labs_plan_elegido";

export default function PlanButton({
  plan,
  className,
}: {
  plan: string;
  className: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        localStorage.setItem(PLAN_PENDIENTE_KEY, plan);
        router.push("/dashboard/conexion");
      }}
      className={className}
    >
      Elegir {plan}
    </button>
  );
}
