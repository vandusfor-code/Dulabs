"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone as PhoneIcon, BadgeCheck, Pencil, Check, X, Bot, MessagesSquare, Trash2 } from "lucide-react";
import { useDashboard, type Negocio } from "@/lib/dashboard-session";
import { formatearTelefono, nombreDelAgente, CALIDAD_INFO } from "@/lib/format";
import { PageHeader, Pill, StatTile } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";

const LIMITE_NUMERICO: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1000,
  TIER_10K: 10000,
  TIER_100K: 100000,
};

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

function NumeroCard({
  negocio,
  accessToken,
  onActualizado,
}: {
  negocio: Negocio;
  accessToken: string;
  onActualizado: () => void;
}) {
  const { t } = useI18n();
  const LIMITE_INFO: Record<string, string> = {
    TIER_50: t("50 conversaciones/día", "50 conversations/day"),
    TIER_250: t("250 conversaciones/día", "250 conversations/day"),
    TIER_1K: t("1.000 conversaciones/día", "1,000 conversations/day"),
    TIER_10K: t("10.000 conversaciones/día", "10,000 conversations/day"),
    TIER_100K: t("100.000 conversaciones/día", "100,000 conversations/day"),
    TIER_UNLIMITED: t("Ilimitado", "Unlimited"),
  };
  const VERIFICACION_INFO: Record<string, string> = {
    VERIFIED: t("Verificado", "Verified"),
    NOT_VERIFIED: t("No verificado", "Not verified"),
    PENDING: t("En proceso", "In progress"),
    EXPIRED: t("Expirado", "Expired"),
  };
  const NOMBRE_VISIBLE_INFO: Record<string, string> = {
    APPROVED: t("Aprobado", "Approved"),
    AVAILABLE_WITHOUT_REVIEW: t("Aprobado", "Approved"),
    PENDING_REVIEW: t("En revisión", "Under review"),
    DECLINED: t("Rechazado", "Declined"),
    NONE: t("Sin definir", "Not set"),
  };
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(negocio.nombre_negocio);
  const [guardando, setGuardando] = useState(false);

  const guardarNombre = useCallback(async () => {
    const valor = nombre.trim();
    if (!valor || valor === negocio.nombre_negocio) {
      setEditando(false);
      setNombre(negocio.nombre_negocio);
      return;
    }
    setGuardando(true);
    try {
      const res = await fetch("/api/dashboard/negocio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ phone_number_id: negocio.phone_number_id, nombre_negocio: valor }),
      });
      if (!res.ok) throw new Error();
      setEditando(false);
      onActualizado();
    } catch {
      setNombre(negocio.nombre_negocio);
    } finally {
      setGuardando(false);
    }
  }, [nombre, negocio.nombre_negocio, negocio.phone_number_id, accessToken, onActualizado]);

  const [editandoAgente, setEditandoAgente] = useState(false);
  const [nombreAgenteInput, setNombreAgenteInput] = useState(nombreDelAgente(negocio));
  const [guardandoAgente, setGuardandoAgente] = useState(false);

  const guardarNombreAgente = useCallback(async () => {
    const valor = nombreAgenteInput.trim();
    if (!valor || valor === nombreDelAgente(negocio)) {
      setEditandoAgente(false);
      setNombreAgenteInput(nombreDelAgente(negocio));
      return;
    }
    setGuardandoAgente(true);
    try {
      const res = await fetch("/api/dashboard/negocio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ phone_number_id: negocio.phone_number_id, nombre_agente: valor }),
      });
      if (!res.ok) throw new Error();
      setEditandoAgente(false);
      onActualizado();
    } catch {
      setNombreAgenteInput(nombreDelAgente(negocio));
    } finally {
      setGuardandoAgente(false);
    }
  }, [nombreAgenteInput, negocio, accessToken, onActualizado]);

  const cupoDiario = negocio.limite_mensajeria ? LIMITE_NUMERICO[negocio.limite_mensajeria] : undefined;

  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);

  const eliminarDatos = useCallback(async () => {
    setEliminando(true);
    setErrorEliminar(null);
    try {
      const res = await fetch("/api/dashboard/negocio", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ phone_number_id: negocio.phone_number_id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t("No se pudo eliminar el número.", "Couldn't delete the number."));
      onActualizado();
    } catch (err) {
      setErrorEliminar(err instanceof Error ? err.message : t("No se pudo eliminar el número.", "Couldn't delete the number."));
      setEliminando(false);
    }
  }, [accessToken, negocio.phone_number_id, onActualizado]);

  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-lime/10 text-lime-text">
            <PhoneIcon className="size-4" />
          </div>
          <div className="min-w-0">
            {editando ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={nombre}
                  maxLength={60}
                  onChange={(e) => setNombre(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") guardarNombre();
                    if (e.key === "Escape") {
                      setEditando(false);
                      setNombre(negocio.nombre_negocio);
                    }
                  }}
                  className="w-40 rounded-md border border-edge bg-ink px-2 py-1 text-sm text-fg outline-none focus:border-lime/50"
                />
                <button
                  onClick={guardarNombre}
                  disabled={guardando}
                  className="flex size-6 items-center justify-center rounded-md text-lime-text hover:bg-lime/10 disabled:opacity-50"
                  aria-label={t("Guardar nombre", "Save name")}
                >
                  <Check className="size-3.5" />
                </button>
                <button
                  onClick={() => {
                    setEditando(false);
                    setNombre(negocio.nombre_negocio);
                  }}
                  className="flex size-6 items-center justify-center rounded-md text-mist hover:bg-ink"
                  aria-label={t("Cancelar", "Cancel")}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditando(true)}
                className="group flex items-center gap-1.5 text-left"
              >
                <span className="truncate text-sm font-semibold text-fg">{negocio.nombre_negocio}</span>
                <Pencil className="size-3 shrink-0 text-mist opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            )}
            <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">
              {formatearTelefono(negocio.telefono_negocio)}
            </p>
            {editandoAgente ? (
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  autoFocus
                  value={nombreAgenteInput}
                  maxLength={60}
                  onChange={(e) => setNombreAgenteInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") guardarNombreAgente();
                    if (e.key === "Escape") {
                      setEditandoAgente(false);
                      setNombreAgenteInput(nombreDelAgente(negocio));
                    }
                  }}
                  className="w-32 rounded-md border border-edge bg-ink px-2 py-1 text-xs text-fg outline-none focus:border-lime/50"
                />
                <button
                  onClick={guardarNombreAgente}
                  disabled={guardandoAgente}
                  className="flex size-5 items-center justify-center rounded-md text-lime-text hover:bg-lime/10 disabled:opacity-50"
                  aria-label={t("Guardar nombre del agente", "Save agent name")}
                >
                  <Check className="size-3" />
                </button>
                <button
                  onClick={() => {
                    setEditandoAgente(false);
                    setNombreAgenteInput(nombreDelAgente(negocio));
                  }}
                  className="flex size-5 items-center justify-center rounded-md text-mist hover:bg-ink"
                  aria-label={t("Cancelar", "Cancel")}
                >
                  <X className="size-3" />
                </button>
              </div>
            ) : (
              <button onClick={() => setEditandoAgente(true)} className="group mt-1.5 flex items-center gap-1.5">
                <Bot className="size-3 text-mist" />
                <span className="text-xs text-mist">
                  <span className="font-medium text-lime-text">{nombreDelAgente(negocio)}</span>
                </span>
                <Pencil className="size-3 text-mist opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            )}
          </div>
        </div>
        <Pill tone={negocio.conectado ? "success" : "neutral"}>
          {negocio.conectado && <BadgeCheck className="size-3" />}
          {negocio.conectado ? t("Verificado", "Verified") : t("Pendiente", "Pending")}
        </Pill>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-edge pt-4 text-xs">
        <span className="flex items-center gap-1.5 text-mist">
          <MessagesSquare className="size-3.5" /> {negocio.enviados_30d.toLocaleString("es-CO")} {t("enviados (30d)", "sent (30d)")}
        </span>
        {cupoDiario !== undefined && (
          <div className="flex items-center gap-2">
            <span className="text-mist">{t("Cupo diario", "Daily quota")}</span>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink">
              <div
                className="h-full rounded-full bg-lime"
                style={{ width: `${Math.min(100, (negocio.enviados_hoy / cupoDiario) * 100)}%` }}
              />
            </div>
            <span className="font-medium text-fg">{Math.round(Math.min(100, (negocio.enviados_hoy / cupoDiario) * 100))}%</span>
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-edge pt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="rounded-full bg-lime/10 px-2.5 py-1 font-semibold uppercase tracking-wide text-lime-text">
            {negocio.plan}
          </span>
          <span className="text-mist">
            {negocio.mensajes_limite === null
              ? `${negocio.mensajes_usados.toLocaleString("es-CO")} ${t("mensajes · Ilimitado", "messages · Unlimited")}`
              : `${negocio.mensajes_usados.toLocaleString("es-CO")} / ${negocio.mensajes_limite.toLocaleString("es-CO")} ${t("mensajes", "messages")}`}
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink">
          <div
            className="h-full rounded-full bg-lime"
            style={{
              width:
                negocio.mensajes_limite === null
                  ? "100%"
                  : `${Math.min(100, (negocio.mensajes_usados / negocio.mensajes_limite) * 100)}%`,
            }}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5 border-t border-edge pt-4">
        <MetaDato
          label={t("Calidad", "Quality")}
          pill={
            negocio.calidad && CALIDAD_INFO[negocio.calidad]
              ? { label: t(CALIDAD_INFO[negocio.calidad].label, CALIDAD_INFO[negocio.calidad].labelEn), tone: CALIDAD_INFO[negocio.calidad].tone }
              : undefined
          }
        />
        <MetaDato label={t("Límite de mensajería", "Messaging limit")} texto={negocio.limite_mensajeria ? LIMITE_INFO[negocio.limite_mensajeria] ?? negocio.limite_mensajeria : undefined} />
        <MetaDato label={t("Verificación", "Verification")} texto={negocio.estado_verificacion ? VERIFICACION_INFO[negocio.estado_verificacion] ?? negocio.estado_verificacion : undefined} />
        <MetaDato label={t("Nombre visible", "Display name")} texto={negocio.estado_nombre_visible ? NOMBRE_VISIBLE_INFO[negocio.estado_nombre_visible] ?? negocio.estado_nombre_visible : undefined} />
      </div>

      <p className="mt-4 break-all font-mono text-[10.5px] text-mist/70">WABA {negocio.whatsapp_business_account_id}</p>

      <div className="mt-4 border-t border-edge pt-4">
        {confirmandoBorrado ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3">
            <p className="text-xs leading-relaxed text-red-400">
              {t(
                "Esto desconecta el número de Meta y borra permanentemente sus mensajes, campañas y configuración. No se puede deshacer.",
                "This disconnects the number from Meta and permanently deletes its messages, campaigns and settings. This can't be undone."
              )}
            </p>
            {errorEliminar && <p className="mt-2 text-xs text-red-400">{errorEliminar}</p>}
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={eliminarDatos}
                disabled={eliminando}
                className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              >
                {eliminando ? t("Eliminando…", "Deleting…") : t("Sí, eliminar todo", "Yes, delete everything")}
              </button>
              <button
                onClick={() => {
                  setConfirmandoBorrado(false);
                  setErrorEliminar(null);
                }}
                disabled={eliminando}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-mist hover:bg-ink disabled:opacity-50"
              >
                {t("Cancelar", "Cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmandoBorrado(true)}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-xs font-semibold text-red-500 transition-colors hover:bg-red-500/10 hover:border-red-500/50"
          >
            <Trash2 className="size-3.5" /> {t("Eliminar mis datos", "Delete my data")}
          </button>
        )}
      </div>
    </div>
  );
}

function MetaDato({
  label,
  texto,
  pill,
}: {
  label: string;
  texto?: string;
  pill?: { label: string; tone: "success" | "warning" | "danger" | "neutral" };
}) {
  return (
    <div>
      <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{label}</p>
      {pill ? (
        <div className="mt-1">
          <Pill tone={pill.tone}>{pill.label}</Pill>
        </div>
      ) : (
        <p className="mt-1 text-sm text-fg">{texto ?? "—"}</p>
      )}
    </div>
  );
}

export default function ConexionPage() {
  const { session, negocios, errorNegocios, cargarNegocios } = useDashboard();
  const { t } = useI18n();
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
            mensaje: t("El flujo fue cancelado o Meta no generó el código de autorización.", "The flow was cancelled or Meta didn't generate the authorization code."),
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
                negocio: data.negocio ?? t("tu negocio", "your business"),
                telefono: data.telefono ?? "",
              });
              cargarNegocios();
            } else {
              setEstado({
                fase: "error",
                mensaje: data.error ?? t("Error desconocido en la vinculación.", "Unknown error while linking."),
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
  }, [configId, session, cargarNegocios, t]);

  const numerosConectados = negocios?.filter((n) => n.conectado).length ?? 0;
  const negociosConTier = (negocios ?? []).filter((n) => n.limite_mensajeria && LIMITE_NUMERICO[n.limite_mensajeria]);
  const capacidadTotal = negociosConTier.reduce((acc, n) => acc + LIMITE_NUMERICO[n.limite_mensajeria!], 0);
  const hayIlimitado = (negocios ?? []).some((n) => n.limite_mensajeria === "TIER_UNLIMITED");
  const negociosConCalidad = (negocios ?? []).filter((n) => n.calidad && n.calidad in CALIDAD_INFO);
  const RANGO_CALIDAD: Record<string, number> = { GREEN: 3, YELLOW: 2, RED: 1, UNKNOWN: 0 };
  const calidadPromedioValor =
    negociosConCalidad.length > 0
      ? negociosConCalidad.reduce((acc, n) => acc + (RANGO_CALIDAD[n.calidad!] ?? 0), 0) / negociosConCalidad.length
      : null;
  const calidadPromedioLabel =
    calidadPromedioValor === null
      ? "—"
      : calidadPromedioValor >= 2.5
        ? t("Alta", "High")
        : calidadPromedioValor >= 1.5
          ? t("Media", "Medium")
          : t("Baja", "Low");
  const mensajesHoy = (negocios ?? []).reduce((acc, n) => acc + n.enviados_hoy, 0);

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow={t("Infraestructura", "Infrastructure")}
        title={t("Números", "Numbers")}
        description={t("Administra las líneas de WhatsApp conectadas a tu cuenta.", "Manage the WhatsApp lines connected to your account.")}
      />

      <div className="px-4 pt-6 md:px-8">
        {negocios !== null && negocios.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile label={t("Números conectados", "Connected numbers")} value={String(numerosConectados)} icon={PhoneIcon} />
            <StatTile
              label={t("Capacidad total / 24h", "Total capacity / 24h")}
              value={hayIlimitado ? t("Ilimitado", "Unlimited") : capacidadTotal > 0 ? capacidadTotal.toLocaleString("es-CO") : "—"}
              icon={BadgeCheck}
            />
            <StatTile label={t("Calidad promedio", "Average quality")} value={calidadPromedioLabel} icon={Bot} />
            <StatTile label={t("Mensajes hoy", "Messages today")} value={mensajesHoy.toLocaleString("es-CO")} icon={MessagesSquare} />
          </div>
        )}

        {planPendiente && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-lime/40 bg-lime/10 p-4 text-sm">
            <span className="text-fg">
              {t("Elegiste el", "You chose")} <strong>{planPendiente}</strong>. {t("Falta activar tu suscripción para completar el registro.", "You still need to activate your subscription to finish signing up.")}
            </span>
            <a
              href="/checkout"
              className="rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg hover:bg-lime-hover"
            >
              {t("Completar suscripción →", "Complete subscription →")}
            </a>
          </div>
        )}

        {errorNegocios && (
          <p className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">
            {errorNegocios}
          </p>
        )}

        {!errorNegocios && negocios === null && <p className="text-sm text-mist">{t("Cargando tus números…", "Loading your numbers…")}</p>}

        {negocios !== null && negocios.length === 0 && (
          <p className="rounded-xl border border-edge bg-card p-5 text-sm leading-relaxed text-mist">
            {t(
              "Todavía no tienes ningún número conectado. Usa el botón de abajo para vincular tu primer WhatsApp Business.",
              "You don't have any connected number yet. Use the button below to link your first WhatsApp Business."
            )}
          </p>
        )}

        {negocios && negocios.length > 0 && session && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {negocios.map((n) => (
              <NumeroCard
                key={n.phone_number_id}
                negocio={n}
                accessToken={session.access_token}
                onActualizado={cargarNegocios}
              />
            ))}
          </div>
        )}

        {/* Conectar un número nuevo */}
        <div className="mt-6 rounded-xl border border-edge bg-card p-6 sm:p-8">
          <p className="text-sm leading-relaxed text-mist">
            {t(
              "Inicia sesión con el Facebook de tu empresa y vincula tu número de WhatsApp Business. Seguirás usando tu app móvil con normalidad: la IA de Du Labs atenderá en paralelo y tú podrás intervenir cuando quieras.",
              "Log in with your business Facebook and link your WhatsApp Business number. You'll keep using your mobile app as usual: Du Labs' AI answers in parallel and you can step in whenever you want."
            )}
          </p>

          <div className="mt-6">
            {estado.fase === "exito" ? (
              <div className="rounded-xl border border-lime/40 bg-lime/10 p-5 text-sm leading-relaxed text-fg">
                ✅ <strong>{estado.negocio}</strong> {t("quedó conectado a Du Labs", "is now connected to Du Labs")}
                {estado.telefono ? ` (${estado.telefono})` : ""}. {t("Los mensajes de tus clientes ya serán atendidos por tu asistente de IA.", "Your customers' messages will now be handled by your AI assistant.")}
                <button
                  onClick={() => setEstado({ fase: "listo" })}
                  className="mt-4 block text-sm font-semibold text-lime-text hover:text-fg"
                >
                  {t("Conectar otro número →", "Connect another number →")}
                </button>
              </div>
            ) : (
              <button
                onClick={conectar}
                disabled={estado.fase !== "listo"}
                className="flex items-center justify-center gap-2 rounded-lg bg-[#1877F2] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" className="size-4 fill-white" aria-hidden>
                  <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.026 1.792-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.971H15.83c-1.491 0-1.956.93-1.956 1.886v2.264h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
                </svg>
                {estado.fase === "conectando"
                  ? t("Conectando…", "Connecting…")
                  : estado.fase === "cargando"
                    ? t("Cargando…", "Loading…")
                    : t("Conectar nuevo número con Facebook", "Connect a new number with Facebook")}
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
            {t(
              "Al conectar autorizas a Du Labs a enviar y recibir mensajes de WhatsApp en nombre de tu negocio mediante la API oficial de Meta. Tu sesión de WhatsApp Business en el celular no se cierra (modo coexistencia).",
              "By connecting you authorize Du Labs to send and receive WhatsApp messages on behalf of your business via Meta's official API. Your WhatsApp Business session on your phone stays open (coexistence mode)."
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
