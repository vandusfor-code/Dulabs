"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DeveloperLogin } from "@/components/developer-login/DeveloperLogin";
import { BusinessLogin } from "@/components/business-login/BusinessLogin";

// /login es compartido por los dos productos: cuando el destino es el dashboard de DuLabs Developer (la landing y el propio dashboard
// llegan con ?next=/developer) se muestra el login de Developer; en cualquier otro caso (home, planes, checkout, /dashboard) el de
// DuLabs Business. Ambos usan el mismo formulario y el mismo flujo de autenticación (components/auth/AuthForm).

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginSegunDestino />
    </Suspense>
  );
}

/** Destino interno seguro de ?next (solo rutas absolutas del sitio: nunca //host, /\host ni URLs externas). */
function nextSeguro(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}

/** El área privada de DuLabs Developer (/developer y sus subrutas; NO /developers ni /developer-platform). */
function esDestinoDeveloper(next: string | null): next is string {
  return next === "/developer" || Boolean(next?.startsWith("/developer/")) || Boolean(next?.startsWith("/developer?"));
}

function LoginSegunDestino() {
  const searchParams = useSearchParams();
  const next = nextSeguro(searchParams.get("next"));
  const recuperacion = searchParams.get("recuperar") === "1";
  if (esDestinoDeveloper(next)) return <DeveloperLogin next={next} recuperacion={recuperacion} />;
  return <BusinessLogin next={next} plan={searchParams.get("plan")} recuperacion={recuperacion} />;
}
