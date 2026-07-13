"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const GRAPH_VERSION = "v23.0";

type FBLoginResponse = {
  authResponse?: { code?: string } | null;
  status?: string;
};

declare global {
  interface Window {
    FB?: {
      init(opts: {
        appId: string;
        autoLogAppEvents: boolean;
        xfbml: boolean;
        version: string;
      }): void;
      login(
        cb: (response: FBLoginResponse) => void,
        opts: Record<string, unknown>
      ): void;
    };
    fbAsyncInit?: () => void;
  }
}

type Estado =
  | { fase: "cargando" }
  | { fase: "listo" }
  | { fase: "conectando" }
  | { fase: "exito"; negocio: string; telefono: string }
  | { fase: "error"; mensaje: string };

type SessionInfo = { waba_id?: string; phone_number_id?: string };

export default function ConexionPage() {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID;
  const configFaltante = !appId || !configId;

  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  // El popup de Embedded Signup postea la sesión (waba_id + phone_number_id)
  // vía window message; se captura aquí y se reenvía junto con el code.
  const sessionInfo = useRef<SessionInfo>({});

  useEffect(() => {
    if (configFaltante) return;

    const onMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith("facebook.com")) return;
      try {
        const data = JSON.parse(event.data as string);
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data?.data) {
          sessionInfo.current = {
            waba_id: data.data.waba_id,
            phone_number_id: data.data.phone_number_id,
          };
        }
      } catch {
        // mensajes de otros orígenes/formatos se ignoran
      }
    };
    window.addEventListener("message", onMessage);

    window.fbAsyncInit = () => {
      window.FB!.init({
        appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: GRAPH_VERSION,
      });
      setEstado({ fase: "listo" });
    };

    if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.src = "https://connect.facebook.net/es_LA/sdk.js";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      document.body.appendChild(script);
    } else if (window.FB) {
      // El SDK ya estaba cargado (navegación de vuelta a esta página): difiere
      // el setState al siguiente microtask para no disparar un render en
      // cascada de forma síncrona dentro del efecto.
      queueMicrotask(() => setEstado({ fase: "listo" }));
    }

    return () => window.removeEventListener("message", onMessage);
  }, [appId, configId, configFaltante]);

  const conectar = useCallback(() => {
    if (!window.FB) return;
    setEstado({ fase: "conectando" });

    window.FB.login(
      (response: FBLoginResponse) => {
        const code = response.authResponse?.code;
        if (!code) {
          setEstado({
            fase: "error",
            mensaje: "El flujo fue cancelado o Meta no generó el código de autorización.",
          });
          return;
        }

        fetch("/api/auth/meta-callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, ...sessionInfo.current }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.success) {
              setEstado({
                fase: "exito",
                negocio: data.negocio ?? "tu negocio",
                telefono: data.telefono ?? "",
              });
            } else {
              setEstado({
                fase: "error",
                mensaje: data.error ?? "Error desconocido en la vinculación.",
              });
            }
          })
          .catch((err) => {
            setEstado({ fase: "error", mensaje: String(err) });
          });
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      }
    );
  }, [configId]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-5 py-16 text-white">
      <div className="w-full max-w-lg rounded-2xl border border-edge/60 bg-card p-8 sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-lime">
          Du IA Business
        </p>
        <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">
          Conecta el WhatsApp de tu negocio
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-mist">
          Inicia sesión con el Facebook de tu empresa y vincula tu número de
          WhatsApp Business. Seguirás usando tu app móvil con normalidad: la IA
          de Du Labs atenderá en paralelo y tú podrás intervenir cuando quieras.
        </p>

        <div className="mt-8">
          {estado.fase === "exito" ? (
            <div className="rounded-xl border border-lime/40 bg-lime/10 p-5 text-sm leading-relaxed">
              ✅ <strong>{estado.negocio}</strong> quedó conectado a Du Labs
              {estado.telefono ? ` (${estado.telefono})` : ""}. Los mensajes de
              tus clientes ya serán atendidos por tu asistente de IA.
            </div>
          ) : (
            <button
              onClick={conectar}
              disabled={estado.fase !== "listo"}
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#1877F2] px-6 py-4 text-base font-semibold text-white transition hover:bg-[#166FE5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white" aria-hidden>
                <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.026 1.792-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.971H15.83c-1.491 0-1.956.93-1.956 1.886v2.264h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
              </svg>
              {estado.fase === "conectando"
                ? "Conectando…"
                : estado.fase === "cargando"
                  ? "Cargando…"
                  : "Conectar mi WhatsApp Business"}
            </button>
          )}

          {configFaltante && (
            <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
              Faltan NEXT_PUBLIC_META_APP_ID o NEXT_PUBLIC_META_CONFIG_ID en el entorno.
            </p>
          )}
          {estado.fase === "error" && (
            <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
              {estado.mensaje}
            </p>
          )}
        </div>

        <p className="mt-6 text-xs leading-relaxed text-mist/70">
          Al conectar autorizas a Du Labs a enviar y recibir mensajes de
          WhatsApp en nombre de tu negocio mediante la API oficial de Meta. Tu
          sesión de WhatsApp Business en el celular no se cierra (modo
          coexistencia).
        </p>
      </div>
    </main>
  );
}
