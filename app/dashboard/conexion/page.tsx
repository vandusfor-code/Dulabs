"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone as PhoneIcon, BadgeCheck } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { formatearTelefono } from "@/lib/format";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";

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

type EstadoConexion =
  | { fase: "cargando" }
  | { fase: "listo" }
  | { fase: "conectando" }
  | { fase: "exito"; negocio: string; telefono: string }
  | { fase: "error"; mensaje: string };

type SessionInfo = { waba_id?: string; phone_number_id?: string };

const PLAN_PENDIENTE_KEY = "du_labs_plan_elegido";

export default function ConexionPage() {
  const { session, negocios, errorNegocios, cargarNegocios } = useDashboard();
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID;
  const configFaltante = !appId || !configId;

  const [planPendiente] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem(PLAN_PENDIENTE_KEY)
  );
  const [estado, setEstado] = useState<EstadoConexion>({ fase: "cargando" });
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
        appId: appId!,
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
      queueMicrotask(() => setEstado({ fase: "listo" }));
    }

    return () => window.removeEventListener("message", onMessage);
  }, [appId, configId, configFaltante]);

  const conectar = useCallback(() => {
    if (!window.FB || !session) return;
    setEstado({ fase: "conectando" });
    const accessToken = session.access_token;

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

        const planElegido = localStorage.getItem(PLAN_PENDIENTE_KEY);

        fetch("/api/auth/meta-callback", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            code,
            ...sessionInfo.current,
            plan: planElegido,
          }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.success) {
              localStorage.removeItem(PLAN_PENDIENTE_KEY);
              setEstado({
                fase: "exito",
                negocio: data.negocio ?? "tu negocio",
                telefono: data.telefono ?? "",
              });
              cargarNegocios();
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
        scope: "whatsapp_business_management,whatsapp_business_messaging",
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      }
    );
  }, [configId, session, cargarNegocios]);

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Infraestructura"
        title="Números"
        description="Administra las líneas de WhatsApp conectadas a tu cuenta."
      />

      <div className="px-4 pt-6 md:px-8">
        {planPendiente && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-lime/40 bg-lime/10 p-4 text-sm">
            <span className="text-fg">
              Elegiste el <strong>{planPendiente}</strong>. Falta activar tu suscripción para completar el registro.
            </span>
            <a
              href="/checkout"
              className="rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg hover:bg-lime-hover"
            >
              Completar suscripción →
            </a>
          </div>
        )}

        {errorNegocios && (
          <p className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">
            {errorNegocios}
          </p>
        )}

        {!errorNegocios && negocios === null && <p className="text-sm text-mist">Cargando tus números…</p>}

        {negocios !== null && negocios.length === 0 && (
          <p className="rounded-xl border border-edge bg-card p-5 text-sm leading-relaxed text-mist">
            Todavía no tienes ningún número conectado. Usa el botón de abajo para vincular tu primer WhatsApp
            Business.
          </p>
        )}

        {negocios && negocios.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {negocios.map((n) => (
              <div key={n.phone_number_id} className="rounded-xl border border-edge bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-lime/10 text-lime-text">
                      <PhoneIcon className="size-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-fg">{n.nombre_negocio}</p>
                      <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">
                        {formatearTelefono(n.telefono_negocio)}
                      </p>
                    </div>
                  </div>
                  <Pill tone={n.conectado ? "success" : "neutral"}>
                    {n.conectado && <BadgeCheck className="size-3" />}
                    {n.conectado ? "Verificado" : "Pendiente"}
                  </Pill>
                </div>

                <div className="mt-4 border-t border-edge pt-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="rounded-full bg-lime/10 px-2.5 py-1 font-semibold uppercase tracking-wide text-lime-text">
                      {n.plan}
                    </span>
                    <span className="text-mist">
                      {n.mensajes_limite === null
                        ? `${n.mensajes_usados.toLocaleString("es-CO")} mensajes · Ilimitado`
                        : `${n.mensajes_usados.toLocaleString("es-CO")} / ${n.mensajes_limite.toLocaleString("es-CO")} mensajes`}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink">
                    <div
                      className="h-full rounded-full bg-lime"
                      style={{
                        width:
                          n.mensajes_limite === null
                            ? "100%"
                            : `${Math.min(100, (n.mensajes_usados / n.mensajes_limite) * 100)}%`,
                      }}
                    />
                  </div>
                </div>

                <p className="mt-4 break-all font-mono text-[10.5px] text-mist/70">
                  WABA {n.whatsapp_business_account_id}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Conectar un número nuevo */}
        <div className="mt-6 rounded-xl border border-edge bg-card p-6 sm:p-8">
          <p className="text-sm leading-relaxed text-mist">
            Inicia sesión con el Facebook de tu empresa y vincula tu número de WhatsApp Business. Seguirás usando
            tu app móvil con normalidad: la IA de Du Labs atenderá en paralelo y tú podrás intervenir cuando
            quieras.
          </p>

          <div className="mt-6">
            {estado.fase === "exito" ? (
              <div className="rounded-xl border border-lime/40 bg-lime/10 p-5 text-sm leading-relaxed text-fg">
                ✅ <strong>{estado.negocio}</strong> quedó conectado a Du Labs
                {estado.telefono ? ` (${estado.telefono})` : ""}. Los mensajes de tus clientes ya serán atendidos
                por tu asistente de IA.
                <button
                  onClick={() => setEstado({ fase: "listo" })}
                  className="mt-4 block text-sm font-semibold text-lime-text hover:text-fg"
                >
                  Conectar otro número →
                </button>
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
                    : "Conectar nuevo número con Facebook"}
              </button>
            )}

            {configFaltante && (
              <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">
                Faltan NEXT_PUBLIC_META_APP_ID o NEXT_PUBLIC_META_CONFIG_ID en el entorno.
              </p>
            )}
            {estado.fase === "error" && (
              <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">
                {estado.mensaje}
              </p>
            )}
          </div>

          <p className="mt-6 text-xs leading-relaxed text-mist/70">
            Al conectar autorizas a Du Labs a enviar y recibir mensajes de WhatsApp en nombre de tu negocio
            mediante la API oficial de Meta. Tu sesión de WhatsApp Business en el celular no se cierra (modo
            coexistencia).
          </p>
        </div>
      </div>
    </div>
  );
}
