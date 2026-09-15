"use client";

import { useRouter } from "next/navigation";
import { AmoreLoginForm } from "@/components/amore/AmoreLoginForm";

// Login AMORE — entrada DEDICADA de escritorio (autorizado, migración de
// namespace /admin/amore -> /amoreweb). Antes de esta migración, el panel
// de escritorio compartía la URL /amore/login con el panel móvil, distinguido
// solo por "?destino=web" -- ver app/amore/login/page.tsx para ese hallazgo
// histórico. Ahora /amoreweb/login es su propia ruta canónica: siempre
// redirige a /amoreweb tras iniciar sesión, sin depender de ningún query
// param. El formulario en sí vive en components/amore/AmoreLoginForm.tsx,
// compartido con app/amore/login/page.tsx (móvil, sin tocar) para no
// duplicar el formulario/llamada a /api/agenda-auth/login dos veces.
export default function AmoreWebLoginPage() {
  const router = useRouter();

  return <AmoreLoginForm onSuccess={() => router.push("/amoreweb")} />;
}
