"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase-browser";

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

type Negocio = {
  nombre_negocio: string;
  telefono_negocio: string;
  phone_number_id: string;
  whatsapp_business_account_id: string;
  conectado: boolean;
  updated_at: string;
  plan: string;
  mensajes_usados: number;
  mensajes_limite: number | null;
  prompt_sistema: string | null;
};

const supabaseConfigFaltante =
  !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const PLAN_PENDIENTE_KEY = "du_labs_plan_elegido";

function formatearTelefono(digitos: string): string {
  if (digitos.length === 11 && digitos[0] === "1") {
    return `+1 ${digitos.slice(1, 4)}-${digitos.slice(4, 7)}-${digitos.slice(7)}`;
  }
  if (digitos.length === 12 && digitos.startsWith("57")) {
    return `+57 ${digitos.slice(2, 5)} ${digitos.slice(5, 8)} ${digitos.slice(8)}`;
  }
  return `+${digitos}`;
}

function EntrenarIA({
  negocio,
  accessToken,
}: {
  negocio: Negocio;
  accessToken: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [prompt, setPrompt] = useState(negocio.prompt_sistema ?? "");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const guardar = useCallback(async () => {
    setGuardando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/dashboard/prompt", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          phone_number_id: negocio.phone_number_id,
          prompt_sistema: prompt,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error guardando");
      setMensaje("Guardado. La IA usará estas instrucciones desde el próximo mensaje.");
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }, [accessToken, negocio.phone_number_id, prompt]);

  return (
    <div className="mt-5 border-t border-edge/60 pt-5">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between text-sm font-semibold text-white"
      >
        Entrenar a la IA (precios, horarios, tono)
        <span className={`transition-transform duration-200 ${abierto ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {abierto && (
        <div className="mt-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            maxLength={4000}
            placeholder={`Eres el asistente de WhatsApp del negocio "${negocio.nombre_negocio}". Responde de forma breve, amable y útil. Nuestros precios son... Atendemos de... a...`}
            className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-3 text-sm leading-relaxed text-white outline-none transition-colors duration-200 focus:border-lime/50"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              onClick={guardar}
              disabled={guardando}
              className="btn-shine rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-ink transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
            <span className="text-xs text-mist">{prompt.length} / 4000</span>
          </div>
          {mensaje && <p className="mt-3 text-xs leading-relaxed text-mist">{mensaje}</p>}
        </div>
      )}
    </div>
  );
}

export default function ConexionPage() {
  const router = useRouter();
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID;
  const configFaltante = !appId || !configId;

  const [session, setSession] = useState<Session | null | "verificando">(
    "verificando"
  );
  const [negocios, setNegocios] = useState<Negocio[] | null>(null);
  const [errorNegocios, setErrorNegocios] = useState<string | null>(null);

  const [estado, setEstado] = useState<EstadoConexion>({ fase: "cargando" });
  // El popup de Embedded Signup postea la sesión (waba_id + phone_number_id)
  // vía window message; se captura aquí y se reenvía junto con el code.
  const sessionInfo = useRef<SessionInfo>({});

  const cargarNegocios = useCallback(async (accessToken: string) => {
    try {
      const res = await fetch("/api/dashboard/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error cargando tu panel");
      setNegocios(data.negocios ?? []);
    } catch (err) {
      setErrorNegocios(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // --- Autenticación: solo usuarios logueados en Supabase ven el panel ---
  useEffect(() => {
    if (supabaseConfigFaltante) return;
    const supabase = supabaseBrowser();

    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setSession(data.session);
      cargarNegocios(data.session.access_token);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!s) {
        router.replace("/login");
        return;
      }
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [router, cargarNegocios]);

  // --- SDK de Facebook (Embedded Signup) ---
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
      // El SDK ya estaba cargado (navegación de vuelta a esta página): difiere
      // el setState al siguiente microtask para no disparar un render en
      // cascada de forma síncrona dentro del efecto.
      queueMicrotask(() => setEstado({ fase: "listo" }));
    }

    return () => window.removeEventListener("message", onMessage);
  }, [appId, configId, configFaltante]);

  const conectar = useCallback(() => {
    if (!window.FB || !session || session === "verificando") return;
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

        const planPendiente = localStorage.getItem(PLAN_PENDIENTE_KEY);

        fetch("/api/auth/meta-callback", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            code,
            ...sessionInfo.current,
            plan: planPendiente,
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
              cargarNegocios(accessToken);
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

  const cerrarSesion = useCallback(async () => {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
  }, [router]);

  if (supabaseConfigFaltante) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink px-5 text-white">
        <p className="max-w-md rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en el entorno.
        </p>
      </main>
    );
  }
  if (session === "verificando") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink px-5 text-white">
        <p className="text-sm text-mist">Verificando tu sesión…</p>
      </main>
    );
  }
  if (!session) return null; // redirigiendo a /login

  return (
    <main className="min-h-screen bg-ink px-5 py-16 text-white sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-lime">
              Du IA Business
            </p>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
              Tu panel de conexión
            </h1>
          </div>
          <button
            onClick={cerrarSesion}
            className="shrink-0 rounded-lg border border-edge px-4 py-2 text-xs text-mist transition-colors duration-200 hover:border-mist/40 hover:text-white"
          >
            Cerrar sesión
          </button>
        </div>
        <p className="mt-2 text-sm text-mist">{session.user.email}</p>

        {/* --- Panel administrativo: números ya conectados, desde Supabase --- */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-mist">
            Líneas conectadas
          </h2>

          {errorNegocios && (
            <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
              {errorNegocios}
            </p>
          )}

          {!errorNegocios && negocios === null && (
            <p className="mt-4 text-sm text-mist">Cargando tus números…</p>
          )}

          {negocios !== null && negocios.length === 0 && (
            <p className="mt-4 rounded-xl border border-edge/60 bg-card p-5 text-sm leading-relaxed text-mist">
              Todavía no tienes ningún número conectado. Usa el botón de abajo
              para vincular tu primer WhatsApp Business.
            </p>
          )}

          <div className="mt-4 flex flex-col gap-4">
            {negocios?.map((n) => (
              <div
                key={n.phone_number_id}
                className="rounded-2xl border border-edge/60 bg-card p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold text-white">
                    {n.nombre_negocio}
                  </h3>
                  <span className="inline-flex items-center gap-2 rounded-full border border-edge/60 bg-ink-2/80 px-3 py-1 text-xs">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        n.conectado
                          ? "bg-lime shadow-[0_0_8px_2px_rgba(198,255,61,0.6)]"
                          : "bg-mist/50"
                      }`}
                    />
                    Estado: {n.conectado ? "Activo / Verificado" : "Pendiente"}
                  </span>
                </div>
                <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-mist">Número de teléfono</dt>
                    <dd className="mt-1 font-medium text-white">
                      {formatearTelefono(n.telefono_negocio)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-mist">WABA ID</dt>
                    <dd className="mt-1 break-all font-mono text-xs text-white/85">
                      {n.whatsapp_business_account_id}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 border-t border-edge/60 pt-5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="rounded-full bg-lime/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-lime">
                      {n.plan}
                    </span>
                    <span className="text-mist">
                      {n.mensajes_limite === null
                        ? `${n.mensajes_usados.toLocaleString("es-CO")} mensajes este mes · Ilimitado`
                        : `${n.mensajes_usados.toLocaleString("es-CO")} / ${n.mensajes_limite.toLocaleString("es-CO")} mensajes este mes`}
                    </span>
                  </div>
                  <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-2">
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

                <EntrenarIA negocio={n} accessToken={session.access_token} />
              </div>
            ))}
          </div>
        </section>

        {/* --- Conectar un número nuevo (Embedded Signup) --- */}
        <section className="mt-10 rounded-2xl border border-edge/60 bg-card p-8 sm:p-10">
          <p className="text-sm leading-relaxed text-mist">
            Inicia sesión con el Facebook de tu empresa y vincula tu número de
            WhatsApp Business. Seguirás usando tu app móvil con normalidad: la
            IA de Du Labs atenderá en paralelo y tú podrás intervenir cuando
            quieras.
          </p>

          <div className="mt-6">
            {estado.fase === "exito" ? (
              <div className="rounded-xl border border-lime/40 bg-lime/10 p-5 text-sm leading-relaxed">
                ✅ <strong>{estado.negocio}</strong> quedó conectado a Du Labs
                {estado.telefono ? ` (${estado.telefono})` : ""}. Los mensajes
                de tus clientes ya serán atendidos por tu asistente de IA.
                <button
                  onClick={() => setEstado({ fase: "listo" })}
                  className="mt-4 block text-sm font-semibold text-lime hover:text-white"
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
            WhatsApp en nombre de tu negocio mediante la API oficial de Meta.
            Tu sesión de WhatsApp Business en el celular no se cierra (modo
            coexistencia).
          </p>
        </section>
      </div>
    </main>
  );
}
