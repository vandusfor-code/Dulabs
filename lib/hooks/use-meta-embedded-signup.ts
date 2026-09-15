"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

// F16.2 (Onboarding comercial, autorizado) -- extraído tal cual de
// app/dashboard/conexion/page.tsx (única implementación real de Meta
// Embedded Signup, Fase 8.x) para poder reusarlo en la pantalla limpia de
// post-pago (app/checkout/conectar-whatsapp/page.tsx) SIN duplicar la
// integración con el SDK de Facebook -- misma config_id, mismo scope, mismo
// featureType, mismo manejo del postMessage WA_EMBEDDED_SIGNUP. Ninguna
// lógica nueva, solo movida a un hook para que dos pantallas la compartan.

const GRAPH_VERSION = "v23.0";

type FBLoginResponse = {
  authResponse?: { code?: string } | null;
  status?: string;
};

declare global {
  interface Window {
    FB?: {
      init(opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
      login(cb: (response: FBLoginResponse) => void, opts: Record<string, unknown>): void;
    };
    fbAsyncInit?: () => void;
  }
}

export type EstadoConexionMeta =
  | { fase: "cargando" }
  | { fase: "listo" }
  | { fase: "conectando" }
  | { fase: "exito"; negocio: string; telefono: string; phoneNumberId: string | null }
  | { fase: "error"; mensaje: string };

type SessionInfo = { waba_id?: string; phone_number_id?: string };

export function useMetaEmbeddedSignup(params: { session: Session | null; plan?: string | null; onExito?: () => void }) {
  const { session, plan, onExito } = params;
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID;
  const configFaltante = !appId || !configId;

  const [estado, setEstado] = useState<EstadoConexionMeta>({ fase: "cargando" });
  const sessionInfo = useRef<SessionInfo>({});

  useEffect(() => {
    if (configFaltante) return;

    const onMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith("facebook.com")) return;
      try {
        const data = JSON.parse(event.data as string);
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data?.data) {
          sessionInfo.current = { waba_id: data.data.waba_id, phone_number_id: data.data.phone_number_id };
        }
      } catch {
        // mensajes de otros orígenes/formatos se ignoran
      }
    };
    window.addEventListener("message", onMessage);

    window.fbAsyncInit = () => {
      window.FB!.init({ appId: appId!, autoLogAppEvents: true, xfbml: true, version: GRAPH_VERSION });
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
      queueMicrotask(() => setEstado({ fase: "listo" }));
    }

    return () => window.removeEventListener("message", onMessage);
  }, [appId, configId, configFaltante]);

  const conectar = useCallback(() => {
    // Evita doble popup/doble inicialización (sección 10 del brief F16.2):
    // si ya está "conectando" o venía de "exito", un segundo click no
    // vuelve a llamar FB.login.
    if (!window.FB || !session || estado.fase === "conectando") return;
    setEstado({ fase: "conectando" });
    const accessToken = session.access_token;

    window.FB.login(
      (response: FBLoginResponse) => {
        const code = response.authResponse?.code;
        if (!code) {
          setEstado({ fase: "error", mensaje: "El flujo fue cancelado o Meta no generó el código de autorización." });
          return;
        }

        fetch("/api/auth/meta-callback", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ code, ...sessionInfo.current, plan: plan ?? null }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.success) {
              setEstado({ fase: "exito", negocio: data.negocio ?? "tu negocio", telefono: data.telefono ?? "", phoneNumberId: data.phone_number_id ?? null });
              onExito?.();
            } else {
              setEstado({ fase: "error", mensaje: data.error ?? "Error desconocido en la vinculación." });
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
        scope: "whatsapp_business_management,whatsapp_business_messaging",
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      }
    );
  }, [configId, session, plan, onExito, estado.fase]);

  return { estado, setEstado, conectar, configFaltante };
}
