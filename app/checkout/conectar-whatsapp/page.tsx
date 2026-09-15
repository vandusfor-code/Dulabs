"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useI18n } from "@/lib/i18n";
import { useMetaEmbeddedSignup } from "@/lib/hooks/use-meta-embedded-signup";

const PLAN_PENDIENTE_KEY = "du_labs_plan_elegido";

// F16.2 (Onboarding comercial: pago -> conectar WhatsApp con Meta,
// autorizado) -- pantalla LIMPIA de post-pago (sección 8 del brief).
// Deliberadamente NO reusa /dashboard/conexion tal cual (esa pantalla
// muestra el listado completo de números, DuMo, borrado de datos, etc. --
// todo eso es exactamente lo que la sección 8 pide NO mostrar acá). Reusa
// en cambio el MISMO hook de Embedded Signup (lib/hooks/use-meta-embedded-
// signup.ts) que esa pantalla, así que la integración real con Meta es una
// sola, no dos.
export default function ConectarWhatsappPostPagoPage() {
  return (
    <Suspense fallback={null}>
      <ConectarWhatsappInterna />
    </Suspense>
  );
}

function ConectarWhatsappInterna() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();

  const [session, setSession] = useState<Session | null | "verificando">("verificando");

  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setSession(data.session);
    });
  }, [router]);

  const planPorUrl = searchParams.get("plan");
  const planGuardado = typeof window === "undefined" ? null : localStorage.getItem(PLAN_PENDIENTE_KEY);
  const plan = planPorUrl ?? planGuardado ?? null;

  const { estado, conectar, configFaltante } = useMetaEmbeddedSignup({
    session: session === "verificando" ? null : session,
    plan,
    onExito: () => {
      if (plan) localStorage.removeItem(PLAN_PENDIENTE_KEY);
    },
  });

  if (session === "verificando") {
    return (
      <main className="dash-scope flex min-h-screen items-center justify-center bg-ink px-5 text-fg">
        <p className="text-sm text-mist">{t("Verificando tu sesión…", "Verifying your session…")}</p>
      </main>
    );
  }
  if (!session) return null;

  return (
    <main className="dash-scope flex min-h-screen items-center justify-center bg-ink px-5 py-16 text-fg">
      <div className="w-full max-w-md rounded-2xl border border-edge/60 bg-card p-8 text-center sm:p-10">
        {estado.fase === "exito" ? (
          <>
            <h1 className="text-2xl font-semibold">{t("Estamos preparando tu IA 🚀", "We're preparing your AI 🚀")}</h1>
            <p className="mt-4 text-sm leading-relaxed text-mist">
              {t(
                "Tu WhatsApp ya está conectado correctamente.",
                "Your WhatsApp is now correctly connected."
              )}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-mist">
              {t(
                "Nuestro equipo está configurando y probando tu asistente.",
                "Our team is configuring and testing your assistant."
              )}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-mist">
              {t("Te avisaremos cuando esté listo.", "We'll let you know when it's ready.")}
            </p>
            <button
              onClick={() => router.push("/dashboard")}
              className="btn-shine mt-8 block w-full rounded-lg bg-lime px-6 py-3 text-center text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97]"
            >
              {t("Ir a mi panel →", "Go to my dashboard →")}
            </button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">{t("¡Tu cuenta está casi lista! 🚀", "Your account is almost ready! 🚀")}</h1>
            <p className="mt-4 text-sm leading-relaxed text-mist">
              {t(
                "Solo falta conectar tu número oficial de WhatsApp para comenzar la configuración de tu IA.",
                "You just need to connect your official WhatsApp number to start configuring your AI."
              )}
            </p>

            <button
              onClick={conectar}
              disabled={estado.fase !== "listo" || configFaltante}
              className="btn-shine mt-8 flex w-full items-center justify-center gap-2 rounded-lg bg-[#1877F2] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="size-4 fill-white" aria-hidden>
                <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.026 1.792-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.971H15.83c-1.491 0-1.956.93-1.956 1.886v2.264h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
              </svg>
              {estado.fase === "conectando"
                ? t("Conectando tu WhatsApp…", "Connecting your WhatsApp…")
                : estado.fase === "cargando"
                  ? t("Cargando…", "Loading…")
                  : t("Conectar WhatsApp con Meta", "Connect WhatsApp with Meta")}
            </button>

            <p className="mt-4 text-sm leading-relaxed text-mist">
              {t(
                "Una vez conectado, nuestro equipo comenzará la configuración de tu asistente.",
                "Once connected, our team will start configuring your assistant."
              )}
            </p>

            {configFaltante && (
              <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">
                {t("Faltan NEXT_PUBLIC_META_APP_ID o NEXT_PUBLIC_META_CONFIG_ID en el entorno.", "NEXT_PUBLIC_META_APP_ID or NEXT_PUBLIC_META_CONFIG_ID are missing from the environment.")}
              </p>
            )}
            {estado.fase === "error" && (
              <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">{estado.mensaje}</p>
            )}

            <p className="mt-6 text-xs leading-relaxed text-mist/70">
              {t(
                "Al conectar autorizas a Du Labs a enviar y recibir mensajes de WhatsApp en nombre de tu negocio mediante la API oficial de Meta.",
                "By connecting you authorize Du Labs to send and receive WhatsApp messages on behalf of your business via Meta's official API."
              )}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
