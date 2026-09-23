"use client";

import { useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Check, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { supabaseBrowser, fijarRecordarSesion, DIAS_RECORDAR_SESION } from "@/lib/supabase-browser";
import { siteUrlCon } from "@/lib/site-url";

// DuLabs Developer · login -- formulario. Tres modos sobre el MISMO flujo de autenticación existente:
//   login     -> POST /api/auth/login (bloqueo por intentos, server-side) + setSession de Supabase, y se avanza a `next`
//   recuperar -> supabase.auth.resetPasswordForEmail: el enlace vuelve a este mismo /login con ?recuperar=1
//   nueva     -> supabase.auth.updateUser({ password }) con la sesión de recuperación del enlace
// Estados: idle · loading · error · success · disabled. Nunca se guardan credenciales ni se muestran errores técnicos internos.

export type Modo = "login" | "recuperar" | "nueva";
type Estado = "idle" | "loading" | "error" | "success";
type Msg = readonly [es: string, en: string];
type ErroresCampo = { email?: Msg; password?: Msg };

/** Mensaje en los dos idiomas: se resuelve al pintar (cambiar ES/EN con un error visible lo traduce). */
const m = (es: string, en: string): Msg => [es, en];

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

/* ---------- Piezas ---------- */

function Campo({
  id,
  etiqueta,
  icono,
  error,
  deshabilitado,
  accesorio,
  ...input
}: { id: string; etiqueta: string; icono: ReactNode; error?: string; deshabilitado?: boolean; accesorio?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const idError = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[13px] font-medium text-auth-text-2">
        {etiqueta}
      </label>
      <div
        {...(error ? { "data-error": "" } : {})}
        {...(deshabilitado ? { "data-disabled": "" } : {})}
        className="dl-campo flex h-[54px] items-center gap-3 rounded-[12px] px-4"
      >
        <span aria-hidden className="flex-none text-auth-muted">
          {icono}
        </span>
        <input
          id={id}
          disabled={deshabilitado}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? idError : undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-auth-text outline-none disabled:cursor-not-allowed"
          {...input}
        />
        {accesorio}
      </div>
      {error ? (
        <p id={idError} className="dl-cambio mt-2 flex items-center gap-1.5 text-[13px] text-auth-danger">
          <AlertCircle aria-hidden className="h-3.5 w-3.5 flex-none" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CampoPassword(props: { id: string; etiqueta: string; valor: string; onValor: (v: string) => void; error?: string; deshabilitado?: boolean; autoComplete: string }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <Campo
      id={props.id}
      etiqueta={props.etiqueta}
      icono={<Lock className="h-[18px] w-[18px]" strokeWidth={1.6} />}
      type={visible ? "text" : "password"}
      autoComplete={props.autoComplete}
      value={props.valor}
      onChange={(e) => props.onValor(e.target.value)}
      error={props.error}
      deshabilitado={props.deshabilitado}
      accesorio={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? t("Ocultar contraseña", "Hide password") : t("Mostrar contraseña", "Show password")}
          disabled={props.deshabilitado}
          className="dl-ojo dl-link relative -mr-1 grid h-9 w-9 flex-none place-items-center rounded-[8px] text-auth-muted hover:text-auth-text"
        >
          <EyeOff aria-hidden className="col-start-1 row-start-1 h-[18px] w-[18px]" strokeWidth={1.6} />
          <Eye aria-hidden className="col-start-1 row-start-1 h-[18px] w-[18px]" strokeWidth={1.6} />
        </button>
      }
    />
  );
}

function BotonEnviar({ cargando, deshabilitado, texto, textoCargando }: { cargando: boolean; deshabilitado: boolean; texto: string; textoCargando: string }) {
  return (
    <button
      type="submit"
      disabled={deshabilitado || cargando}
      aria-busy={cargando || undefined}
      className="dl-boton inline-flex h-[54px] w-full items-center justify-center gap-2.5 rounded-[12px] bg-auth-text text-[15px] font-medium text-auth-bg disabled:cursor-not-allowed disabled:opacity-60"
    >
      {cargando ? (
        <>
          <span aria-hidden className="dl-spinner h-4 w-4 rounded-full border-[1.5px] border-auth-bg/25 border-t-auth-bg" />
          {textoCargando}
        </>
      ) : (
        <>
          {texto}
          <ArrowRight aria-hidden className="dl-flecha h-4 w-4" strokeWidth={1.8} />
        </>
      )}
    </button>
  );
}

function Aviso({ tono, children }: { tono: "error" | "ok"; children: ReactNode }) {
  return (
    <p
      role={tono === "error" ? "alert" : "status"}
      className={`dl-cambio flex items-start gap-2 rounded-[10px] border px-3.5 py-3 text-[13.5px] leading-relaxed ${
        tono === "error" ? "border-auth-danger/30 bg-auth-danger/[0.06] text-auth-text" : "border-auth-border bg-white/[0.02] text-auth-text"
      }`}
    >
      {tono === "error" ? <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 flex-none text-auth-danger" /> : <Check aria-hidden className="mt-0.5 h-4 w-4 flex-none text-auth-accent-2" />}
      <span>{children}</span>
    </p>
  );
}

/* ---------- Formulario ---------- */

export function LoginForm({ next, modo, onModo, configFaltante }: { next: string; modo: Modo; onModo: (m: Modo) => void; configFaltante: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const ids = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recordar, setRecordar] = useState(true);
  const [estado, setEstado] = useState<Estado>("idle");
  const [error, setError] = useState<Msg | null>(null);
  const [aviso, setAviso] = useState<Msg | null>(null);
  const [errores, setErrores] = useState<ErroresCampo>({});
  const cargando = estado === "loading" || estado === "success";
  const noDisponible = m("El inicio de sesión no está disponible en este momento. Inténtalo más tarde.", "Sign-in isn't available right now. Please try again later.");

  const cambiarModo = (m: Modo) => {
    setError(null);
    setAviso(null);
    setErrores({});
    setEstado("idle");
    onModo(m);
  };

  const validar = (campos: { email?: boolean; password?: boolean }): boolean => {
    const e: ErroresCampo = {};
    if (campos.email) {
      if (!email.trim()) e.email = m("Escribe tu correo electrónico.", "Enter your email.");
      else if (!EMAIL_VALIDO.test(email.trim())) e.email = m("Escribe un correo válido.", "Enter a valid email.");
    }
    if (campos.password) {
      if (!password) e.password = m("Escribe tu contraseña.", "Enter your password.");
      else if (modo === "nueva" && password.length < MIN_PASSWORD) e.password = m(`Usa al menos ${MIN_PASSWORD} caracteres.`, `Use at least ${MIN_PASSWORD} characters.`);
    }
    setErrores(e);
    return Object.keys(e).length === 0;
  };

  const falla = (mensaje: Msg) => {
    setError(mensaje);
    setEstado("error");
  };

  async function iniciarSesion() {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const data: { error?: string; bloqueado?: boolean; intentosRestantes?: number; session?: { access_token: string; refresh_token: string } } = await res
      .json()
      .catch(() => ({}));
    if (!res.ok || !data.session) {
      if (data.bloqueado || res.status === 429) {
        return falla(m("Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.", "Too many failed attempts. Wait 15 minutes and try again."));
      }
      if (typeof data.error === "string" && /not confirmed/i.test(data.error)) {
        return falla(m("Confirma tu correo antes de iniciar sesión: revisa tu bandeja de entrada.", "Confirm your email before signing in: check your inbox."));
      }
      if (typeof data.intentosRestantes === "number") {
        return falla(
          data.intentosRestantes > 0
            ? m(
                `Correo o contraseña incorrectos. Te quedan ${data.intentosRestantes} intento(s) antes del bloqueo temporal.`,
                `Incorrect email or password. ${data.intentosRestantes} attempt(s) left before a temporary lockout.`,
              )
            : m("Correo o contraseña incorrectos. Cuenta bloqueada temporalmente por 15 minutos.", "Incorrect email or password. Account temporarily locked for 15 minutes."),
        );
      }
      return falla(m("No pudimos iniciar sesión. Inténtalo de nuevo.", "We couldn't sign you in. Please try again."));
    }
    fijarRecordarSesion(recordar);
    const { error: errSesion } = await supabaseBrowser().auth.setSession(data.session);
    if (errSesion) return falla(m("No pudimos iniciar sesión. Inténtalo de nuevo.", "We couldn't sign you in. Please try again."));
    setEstado("success");
    router.push(next);
  }

  async function pedirEnlace() {
    const { error: err } = await supabaseBrowser().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: siteUrlCon(`/login?next=${encodeURIComponent(next)}&recuperar=1`),
    });
    if (err && err.status === 429) return falla(m("Ya pediste varios enlaces. Espera unos minutos e inténtalo de nuevo.", "You've requested several links. Wait a few minutes and try again."));
    // Misma respuesta exista o no la cuenta: no se revela qué correos están registrados.
    setAviso(
      m(
        "Si hay una cuenta con ese correo, te enviamos un enlace para crear una contraseña nueva.",
        "If an account exists for that email, we sent you a link to create a new password.",
      ),
    );
    setEstado("idle");
  }

  async function guardarNueva() {
    const supabase = supabaseBrowser();
    const { data } = await supabase.auth.getSession();
    if (!data.session) return falla(m("El enlace no es válido o ya expiró. Pide uno nuevo.", "The link is invalid or has expired. Request a new one."));
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) return falla(m("No pudimos guardar la contraseña. Prueba con otra o pide un enlace nuevo.", "We couldn't save the password. Try another one or request a new link."));
    setEstado("success");
    router.replace(next);
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    if (configFaltante) return falla(noDisponible);
    const ok = modo === "login" ? validar({ email: true, password: true }) : modo === "recuperar" ? validar({ email: true }) : validar({ password: true });
    if (!ok) return;
    setEstado("loading");
    try {
      if (modo === "login") await iniciarSesion();
      else if (modo === "recuperar") await pedirEnlace();
      else await guardarNueva();
    } catch {
      falla(m("No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.", "We couldn't connect. Check your connection and try again."));
    }
  }

  const limpiar = (campo: keyof ErroresCampo) => {
    if (errores[campo]) setErrores((x) => ({ ...x, [campo]: undefined }));
    if (estado === "error") {
      setEstado("idle");
      setError(null);
    }
  };

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-5">
      {configFaltante ? <Aviso tono="error">{t(...noDisponible)}</Aviso> : null}

      {modo !== "nueva" ? (
        <Campo
          id={`${ids}-email`}
          etiqueta={t("Correo electrónico", "Email")}
          icono={<Mail className="h-[18px] w-[18px]" strokeWidth={1.6} />}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder={t("tu@empresa.com", "you@company.com")}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            limpiar("email");
          }}
          error={errores.email ? t(...errores.email) : undefined}
          deshabilitado={cargando || configFaltante}
        />
      ) : null}

      {modo !== "recuperar" ? (
        <CampoPassword
          id={`${ids}-password`}
          etiqueta={modo === "nueva" ? t("Contraseña nueva", "New password") : t("Contraseña", "Password")}
          valor={password}
          onValor={(v) => {
            setPassword(v);
            limpiar("password");
          }}
          error={errores.password ? t(...errores.password) : undefined}
          deshabilitado={cargando || configFaltante}
          autoComplete={modo === "nueva" ? "new-password" : "current-password"}
        />
      ) : null}

      {modo === "login" ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <label className="flex cursor-pointer select-none items-center gap-2.5 whitespace-nowrap text-[13.5px] text-auth-text-2">
            <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} disabled={cargando} className="peer sr-only" />
            <span aria-hidden className="dl-casilla grid h-[18px] w-[18px] flex-none place-items-center rounded-[5px] border border-white/20">
              <Check className="h-3 w-3 text-auth-bg" strokeWidth={3} />
            </span>
            {t(`Recordarme por ${DIAS_RECORDAR_SESION} días`, `Remember me for ${DIAS_RECORDAR_SESION} days`)}
          </label>
          <button type="button" onClick={() => cambiarModo("recuperar")} className="dl-link whitespace-nowrap text-[13.5px] text-auth-text underline decoration-white/30 underline-offset-4 hover:decoration-white">
            {t("¿Olvidaste tu contraseña?", "Forgot your password?")}
          </button>
        </div>
      ) : null}

      {error ? <Aviso tono="error">{t(...error)}</Aviso> : null}
      {aviso ? <Aviso tono="ok">{t(...aviso)}</Aviso> : null}

      <div className="pt-1">
        <BotonEnviar
          cargando={cargando}
          deshabilitado={configFaltante}
          texto={modo === "login" ? t("Iniciar sesión", "Sign in") : modo === "recuperar" ? t("Enviar enlace", "Send link") : t("Guardar contraseña", "Save password")}
          textoCargando={modo === "login" ? t("Ingresando…", "Signing in…") : modo === "recuperar" ? t("Enviando…", "Sending…") : t("Guardando…", "Saving…")}
        />
      </div>

      {modo !== "login" ? (
        <button type="button" onClick={() => cambiarModo("login")} className="dl-link self-center text-[13.5px] text-auth-text-2 hover:text-auth-text">
          {t("← Volver a iniciar sesión", "← Back to sign in")}
        </button>
      ) : null}
    </form>
  );
}
