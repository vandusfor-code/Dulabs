import type { ReactNode } from "react";
import { DeveloperShell } from "@/components/developer/DeveloperShell";

// DuLabs Developer V1 -- Fase 9 (autorizado). Layout raíz del Developer
// Dashboard. Producto separado de Business (/dashboard) y AMORE.

export default function DeveloperLayout({ children }: { children: ReactNode }) {
  return <DeveloperShell>{children}</DeveloperShell>;
}
