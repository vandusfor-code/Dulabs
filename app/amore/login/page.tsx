"use client";

import { useRouter } from "next/navigation";
import { AmoreLoginForm } from "@/components/amore/AmoreLoginForm";

// Login AMORE (autorizado) — pantalla de login real, fiel al mockup
// aprobado. NOTA IMPORTANTE: la ruta pedida originalmente era "/login",
// pero esa ruta YA EXISTE y es el login del propio SaaS de DuLabs (email +
// contraseña vía Supabase Auth, ver app/login/page.tsx) -- reutilizarla
// habría roto el login real de los clientes de DuLabs. Se usa "/amore/login"
// en su lugar (a pedido explícito). Llama a /api/agenda-auth/login
// (namespace propio, separado del /api/auth/login del dashboard interno).
//
// SIGUE SIENDO el login del panel MÓVIL (/agenda/[token], sin tocar) --
// NUNCA se movió a /amoreweb, precisamente para no romper ese flujo
// existente y probado. El formulario en sí vive en components/amore/AmoreLoginForm.tsx,
// compartido con app/amoreweb/login/page.tsx (el nuevo login DEDICADO de
// escritorio) para no duplicar el formulario/llamada a la API dos veces.
//
// Destino tras iniciar sesión (hallazgo real corregido, y namespace migrado
// de /admin/amore -> /amoreweb, autorizado): antes SIEMPRE mandaba al panel
// móvil, sin importar por qué link llegó la persona -- quien entraba por el
// link de escritorio (o cuya sesión de escritorio expiraba a mitad de uso,
// ver AdminWebContext.tsx) terminaba igual en /agenda/[token]. "?destino=web"
// (leído directo de window.location.search, sin useSearchParams -- esta
// página no necesita Suspense para nada más) lo manda a /amoreweb en vez
// del móvil -- mantenido acá solo por compatibilidad con links viejos;
// AdminWebContext.tsx ya no genera este query param, apunta directo a
// /amoreweb/login.
export default function AmoreLoginPage() {
  const router = useRouter();

  return (
    <AmoreLoginForm
      onSuccess={(token) => {
        const destinoWeb = new URLSearchParams(window.location.search).get("destino") === "web";
        router.push(destinoWeb ? "/amoreweb" : `/agenda/${token}`);
      }}
    />
  );
}
