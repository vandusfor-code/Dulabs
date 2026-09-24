"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { resolverPlanId } from "@/lib/planes";
import { LanguageSelector } from "@/components/LanguageSelector";
import { AuthForm, type Modo } from "@/components/auth/AuthForm";
import { AmbientVisual, AmbientMobile } from "./AmbientVisual";

// DuLabs Business · login (/login). Silencioso y funcional: marca + badge BUSINESS, un titular, una línea, el formulario y «Crear
// cuenta». A la derecha (md+) un panel ambiental casi vacío (AmbientVisual). La lógica es la de siempre:
//   - ?plan=X se guarda ANTES que nada (sobrevive a «regístrate -> confirma tu correo -> inicia sesión») y /checkout lo recoge.
//   - ?next=/ruta interna se respeta tras autenticar; sin next: admin -> /admin, plan pendiente -> /checkout, resto -> /dashboard/conexion.
//   - Con una sesión ya abierta, /api/dashboard/me (fuente única de es_admin_dulabs) decide el destino.
// Autenticación: AuthForm (POST /api/auth/login + setSession; registro con signUp; recuperación de contraseña).

const supabaseConfigFaltante = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Misma clave que lee /checkout (ver app/checkout/page.tsx).
const PLAN_PENDIENTE_KEY = "du_labs_plan_elegido";

function Brand() {
  return (
    <Link href="/" className="dl-link inline-flex items-center gap-3 text-auth-text" aria-label="DuLabs Business">
      <Image src="/logo-mono.svg" alt="" width={28} height={28} className="rounded-full" priority />
      <span className="text-[19px] font-semibold tracking-[-0.02em]">DuLabs</span>
      <span className="rounded-full border border-[#7187FF]/40 px-2.5 py-[5px] font-mono text-[9.5px] font-medium uppercase leading-none tracking-[0.22em] text-[#9AA8FF]">
        Business
      </span>
    </Link>
  );
}

export function BusinessLogin({ next, plan, recuperacion }: { next: string | null; plan: string | null; recuperacion: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [modo, setModo] = useState<Modo>(recuperacion ? "nueva" : "login");

  useEffect(() => {
    if (plan) window.localStorage.setItem(PLAN_PENDIENTE_KEY, resolverPlanId(plan));
  }, [plan]);

  const destino = ({ esAdmin }: { esAdmin: boolean }) =>
    next ?? (esAdmin ? "/admin" : window.localStorage.getItem(PLAN_PENDIENTE_KEY) ? "/checkout" : "/dashboard/conexion");

  // Sesión ya abierta (recargó /login o volvió con una pestaña vieja): se avanza al destino correcto. No en el flujo de contraseña nueva.
  useEffect(() => {
    if (supabaseConfigFaltante || recuperacion) return;
    supabaseBrowser()
      .auth.getSession()
      .then(async ({ data }) => {
        if (!data.session) return;
        try {
          const res = await fetch("/api/dashboard/me", { headers: { Authorization: `Bearer ${data.session.access_token}` } });
          const me = res.ok ? await res.json() : null;
          router.replace(destino({ esAdmin: Boolean(me?.es_admin_dulabs) }));
        } catch {
          router.replace(destino({ esAdmin: false }));
        }
      });
    // destino solo depende de next (prop) y de localStorage en el momento de navegar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, recuperacion, router]);

  const titulos: Record<Modo, { h: string; p: React.ReactNode }> = {
    login: {
      h: t("Bienvenido de vuelta.", "Welcome back."),
      p: (
        <>
          {t("Accede a tu panel de DuLabs Business", "Access your DuLabs Business dashboard")}
          <br className="hidden sm:block" /> {t("y continúa llevando tu negocio al siguiente nivel.", "and keep taking your business to the next level.")}
        </>
      ),
    },
    registro: { h: t("Crea tu cuenta.", "Create your account."), p: t("Conecta tu WhatsApp Business en minutos.", "Connect your WhatsApp Business in minutes.") },
    recuperar: { h: t("Recupera tu acceso.", "Recover your access."), p: t("Te enviaremos un enlace para crear una contraseña nueva.", "We'll send you a link to create a new password.") },
    nueva: { h: t("Crea una contraseña nueva.", "Create a new password."), p: t("Úsala para entrar a tu panel.", "Use it to access your dashboard.") },
  };
  const retornoRecuperacion = next ? `/login?next=${encodeURIComponent(next)}&recuperar=1` : "/login?recuperar=1";

  return (
    <main className="dl-auth bl-auth relative grid min-h-svh bg-[#050505] text-auth-text md:grid-cols-[minmax(0,1fr)_38%] lg:grid-cols-[minmax(0,48%)_1fr]">
      <AmbientMobile />

      <div className="absolute right-6 top-6 z-20 md:right-8 md:top-8 lg:right-10 lg:top-10">
        <LanguageSelector tone="neutral" />
      </div>

      <div className="relative z-10 flex min-h-svh items-center justify-center px-6 pb-16 pt-24 md:px-10 md:py-20 [@media(max-height:860px)]:md:py-12">
        <div className="w-full max-w-[420px]">
          <div className="bl-sube" style={{ ["--i" as string]: 0, ["--dy" as string]: "8px" }}>
            <Brand />
          </div>

          <div key={modo} className="mt-14 [@media(max-height:860px)]:mt-10">
            <h1 className="bl-sube text-[32px] font-medium leading-[1.06] tracking-[-0.035em] text-white md:text-[40px] lg:text-[42px]" style={{ ["--i" as string]: 1, ["--dy" as string]: "10px" }}>
              {titulos[modo].h}
            </h1>
            <p className="bl-aparece mt-3 text-[15.5px] leading-[1.55] text-white/[0.62]" style={{ ["--i" as string]: 2 }}>
              {titulos[modo].p}
            </p>
          </div>

          <div className="bl-sube mt-10 [@media(max-height:860px)]:mt-8" style={{ ["--i" as string]: 3, ["--dy" as string]: "12px" }}>
            <AuthForm
              modo={modo}
              onModo={setModo}
              configFaltante={supabaseConfigFaltante}
              destino={destino}
              retornoRecuperacion={retornoRecuperacion}
              placeholderEmail={["tu@correo.com", "you@email.com"]}
              cargandoLogin={["Verificando…", "Verifying…"]}
            />

            {modo === "login" || modo === "registro" ? (
              <>
                <div aria-hidden className="mt-8 flex items-center gap-4 [@media(max-height:860px)]:mt-6">
                  <span className="h-px flex-1 bg-white/[0.08]" />
                  <span className="h-1 w-1 rounded-full bg-white/25" />
                  <span className="h-px flex-1 bg-white/[0.08]" />
                </div>
                <p className="mt-6 text-center text-[14.5px] text-white/[0.62] [@media(max-height:860px)]:mt-5">
                  {modo === "login" ? t("¿No tienes cuenta?", "Don't have an account?") : t("¿Ya tienes cuenta?", "Already have an account?")}{" "}
                  <button
                    type="button"
                    onClick={() => setModo(modo === "login" ? "registro" : "login")}
                    className="dl-link font-medium text-white underline decoration-white/35 underline-offset-4 hover:decoration-white"
                  >
                    {modo === "login" ? t("Crear cuenta", "Create account") : t("Iniciar sesión", "Sign in")}
                  </button>
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <AmbientVisual className="hidden md:block" />
    </main>
  );
}
