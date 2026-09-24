"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { LanguageSelector } from "@/components/LanguageSelector";
import { LANDING_PATH, START_HREF } from "@/components/developer-platform/constants";
import { AuthForm, type Modo } from "@/components/auth/AuthForm";
import { InfrastructureVisual } from "./InfrastructureVisual";

// DuLabs Developer · login. La landing vende; el login solo recibe: marca + idioma, volver, un título, una línea, el formulario y el
// registro. A la derecha (md+), una pieza visual abstracta de infraestructura (InfrastructureVisual). Mobile: una sola columna.
// Se muestra en /login cuando el destino es el área de Developer (?next=/developer…); el resto de /login (Business) no cambia.

const supabaseConfigFaltante = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function Brand() {
  return (
    <Link href={LANDING_PATH} className="dl-link flex items-center gap-2.5 text-auth-text" aria-label="DuLabs Developer">
      <Image src="/logo-mono.svg" alt="" width={24} height={24} className="rounded-full" priority />
      <span className="text-[16px] font-semibold tracking-[-0.02em]">DuLabs</span>
      <span className="rounded-[5px] border border-auth-border px-1.5 py-[3px] font-mono text-[9.5px] font-medium uppercase leading-none tracking-[0.18em] text-auth-text-2">
        Developer
      </span>
    </Link>
  );
}

export function DeveloperLogin({ next, recuperacion }: { next: string; recuperacion: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [modo, setModo] = useState<Modo>(recuperacion ? "nueva" : "login");

  // Con una sesión ya abierta se avanza directo al destino (no en el flujo de contraseña nueva: ahí la sesión es la del enlace).
  useEffect(() => {
    if (supabaseConfigFaltante || recuperacion) return;
    supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) router.replace(next);
      });
  }, [next, recuperacion, router]);

  const titulos: Record<Exclude<Modo, "registro">, { h: string; p: string }> = {
    login: { h: t("Bienvenido de vuelta.", "Welcome back."), p: t("Accede a tu workspace y continúa desarrollando.", "Access your workspace and keep building.") },
    recuperar: {
      h: t("Recupera tu acceso.", "Recover your access."),
      p: t("Te enviaremos un enlace para crear una contraseña nueva.", "We'll send you a link to create a new password."),
    },
    nueva: { h: t("Crea una contraseña nueva.", "Create a new password."), p: t("Úsala para entrar a tu workspace.", "Use it to access your workspace.") },
  };

  return (
    <main className="dl-auth grid min-h-svh bg-auth-bg text-auth-text md:grid-cols-[minmax(0,54%)_1fr] lg:grid-cols-[minmax(0,46%)_1fr]">
      <div className="flex min-h-svh flex-col px-6 py-6 md:px-10 md:py-8 lg:px-16 xl:px-24 [@media(max-height:920px)]:md:py-6">
        <header className="dl-entra flex items-center justify-between gap-4">
          <Brand />
          <LanguageSelector tone="neutral" />
        </header>

        <div className="flex flex-1 items-center py-12 md:py-16 [@media(max-height:920px)]:py-8">
          <div className="w-full max-w-[480px]">
            <Link href={LANDING_PATH} className="dl-entra dl-link inline-flex items-center gap-2 text-[14px] text-auth-text-2 hover:text-auth-text" style={{ ["--i" as string]: 1 }}>
              <ArrowLeft aria-hidden className="h-4 w-4" strokeWidth={1.6} />
              {t("Volver a DuLabs Developer", "Back to DuLabs Developer")}
            </Link>

            <div key={modo} className="dl-entra mt-10 md:mt-12 [@media(max-height:920px)]:mt-7" style={{ ["--i" as string]: 2 }}>
              <h1 className="text-[36px] font-medium leading-[1.05] tracking-[-0.04em] text-auth-text md:text-[40px] lg:text-[44px]">{titulos[modo === "registro" ? "login" : modo].h}</h1>
              <p className="mt-4 max-w-[36ch] text-[16px] leading-[1.6] text-auth-text-2">{titulos[modo === "registro" ? "login" : modo].p}</p>
            </div>

            <div className="dl-entra mt-10 max-w-[400px] [@media(max-height:920px)]:mt-7" style={{ ["--i" as string]: 3 }}>
              <AuthForm
                modo={modo}
                onModo={setModo}
                configFaltante={supabaseConfigFaltante}
                destino={() => next}
                retornoRecuperacion={`/login?next=${encodeURIComponent(next)}&recuperar=1`}
                placeholderEmail={["tu@empresa.com", "you@company.com"]}
                cargandoLogin={["Ingresando…", "Signing in…"]}
              />
            </div>

            {modo === "login" ? (
              <p className="dl-entra mt-8 max-w-[400px] text-center text-[14px] text-auth-text-2 [@media(max-height:920px)]:mt-6" style={{ ["--i" as string]: 4 }}>
                {t("¿No tienes cuenta?", "Don't have an account?")}{" "}
                <Link href={START_HREF} className="dl-link font-medium text-auth-text underline decoration-transparent underline-offset-4 hover:decoration-white/60">
                  {t("Regístrate", "Sign up")}
                </Link>
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <InfrastructureVisual className="hidden md:block" />
    </main>
  );
}
