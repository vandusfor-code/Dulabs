"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DevClient, ConnectResp } from "@/lib/dev-dashboard/dev-client";
import { DevApiError } from "@/lib/dev-dashboard/dev-client";

// DuLabs Developer V1 -- Fase 10 (Onboarding + Conexión de WhatsApp,
// autorizado). Hook de Meta Embedded Signup PROPIO de Developer -- archivo
// nuevo, NO reutiliza lib/hooks/use-meta-embedded-signup.ts (Business) para
// no acoplar los dos productos. Misma técnica probada (FB JS SDK,
// response_type=code, postMessage WA_EMBEDDED_SIGNUP), pero:
//   - usa la ÚNICA Meta App verificada (NEXT_PUBLIC_META_APP_ID),
//   - con el config_id de Developer (NEXT_PUBLIC_META_DEV_CONFIG_ID) y, si no
//     está definido, cae al config_id existente (NEXT_PUBLIC_META_CONFIG_ID)
//     -- mismos scopes; no se inventa configuración de Meta,
//   - manda el `code` al backend de Developer vía el DevClient (que ya
//     inyecta Bearer + X-Dulabs-Workspace) -- el token de Meta NUNCA toca el
//     navegador; se obtiene y cifra server-side.

const GRAPH_VERSION = "v23.0";

type FBLoginResponse = { authResponse?: { code?: string } | null; status?: string };

declare global {
  interface Window {
    FB?: {
      init(opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
      login(cb: (response: FBLoginResponse) => void, opts: Record<string, unknown>): void;
    };
    fbAsyncInit?: () => void;
  }
}

export type EstadoConexionDev =
  | { fase: "cargando" }
  | { fase: "listo" }
  | { fase: "conectando" }
  | { fase: "exito"; resp: ConnectResp }
  | { fase: "limite" }
  | { fase: "error"; mensaje: string };

type SessionInfo = { waba_id?: string; phone_number_id?: string };

function mensajeDeError(err: unknown): string {
  if (err instanceof DevApiError) {
    if (err.code === "number_already_connected") return "Este número ya está conectado a otro workspace.";
    if (err.kind === "forbidden") return "No tienes permiso para conectar números en este workspace.";
    return err.detalle ?? "No se pudo completar la conexión con Meta.";
  }
  return err instanceof Error ? err.message : String(err);
}

export function useDevMetaEmbeddedSignup(params: { client: DevClient; onExito?: () => void }) {
  const { client, onExito } = params;
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_DEV_CONFIG_ID || process.env.NEXT_PUBLIC_META_CONFIG_ID;
  const configFaltante = !appId || !configId;

  const [estado, setEstado] = useState<EstadoConexionDev>({ fase: "cargando" });
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
    if (!window.FB || estado.fase === "conectando") return;
    setEstado({ fase: "conectando" });

    window.FB.login(
      (response: FBLoginResponse) => {
        const code = response.authResponse?.code;
        if (!code) {
          setEstado({ fase: "error", mensaje: "El flujo fue cancelado o Meta no generó el código de autorización." });
          return;
        }
        client.whatsapp
          .connect({ code, wabaId: sessionInfo.current.waba_id, phoneNumberId: sessionInfo.current.phone_number_id })
          .then((resp) => {
            setEstado({ fase: "exito", resp });
            onExito?.();
          })
          .catch((err) => {
            if (err instanceof DevApiError && err.code === "number_limit_exceeded") {
              setEstado({ fase: "limite" });
              return;
            }
            setEstado({ fase: "error", mensaje: mensajeDeError(err) });
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
  }, [configId, client, onExito, estado.fase]);

  return { estado, setEstado, conectar, configFaltante };
}
