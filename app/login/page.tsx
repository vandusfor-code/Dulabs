"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { AuthVisual } from "@/components/site/AuthVisual";
import { useI18n } from "@/lib/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";

type Modo = "login" | "registro";

const supabaseConfigFaltante =
  !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [modo, setModo] = useState<Modo>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (supabaseConfigFaltante) return;
    supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) router.replace("/dashboard/conexion");
      });
  }, [router]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    if (supabaseConfigFaltante) {
      setError("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en el entorno.");
      return;
    }
    setCargando(true);

    const supabase = supabaseBrowser();
    if (modo === "login") {
      const { error: err } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setCargando(false);
      if (err) {
        setError(err.message);
        return;
      }
      router.push("/dashboard/conexion");
    } else {
      const { error: err } = await supabase.auth.signUp({ email, password });
      setCargando(false);
      if (err) {
        setError(err.message);
        return;
      }
      setMensaje(
        t(
          "Cuenta creada. Si tu proyecto requiere confirmación por correo, revisa tu bandeja antes de iniciar sesión.",
          "Account created. If your project requires email confirmation, check your inbox before signing in."
        )
      );
      setModo("login");
    }
  };

  return (
    <main className="grid min-h-screen bg-site-bg text-site-fg lg:grid-cols-2">
      <div className="relative flex items-center justify-center px-6 py-16">
        <div className="pointer-events-none absolute inset-0 site-grid-bg-fine opacity-40 lg:hidden" />
        <div className="absolute right-6 top-6 z-10">
          <LanguageSelector />
        </div>
        <div className="relative w-full max-w-[400px]">
          <Link href="/" className="text-[13px] text-site-primary transition-colors duration-200 hover:text-site-fg">
            {t("← Volver a Du Labs", "← Back to Du Labs")}
          </Link>

          <div className="mt-8 mb-6 inline-flex items-center rounded-full border border-site-border bg-white/[0.02] p-1 text-[12px]">
            {(["login", "registro"] as Modo[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setModo(m);
                  setError(null);
                  setMensaje(null);
                }}
                className={`relative rounded-full px-4 py-1.5 transition-all ${
                  modo === m ? "bg-site-fg text-site-bg" : "text-site-muted-fg hover:text-site-fg"
                }`}
              >
                {m === "login" ? t("Iniciar sesión", "Log in") : t("Crear cuenta", "Sign up")}
              </button>
            ))}
          </div>

          <h1 className="font-display text-[28px] font-medium leading-[1.08] tracking-tight site-text-gradient">
            {modo === "login" ? t("Bienvenido de vuelta.", "Welcome back.") : t("Activa tu WhatsApp con IA.", "Activate your WhatsApp with AI.")}
          </h1>
          <p className="mt-2 text-[13.5px] text-site-muted-fg">
            {modo === "login"
              ? t("Accede a tu panel de Du Labs para conectar y administrar tus números de WhatsApp.", "Access your Du Labs dashboard to connect and manage your WhatsApp numbers.")
              : t("Crea tu cuenta para conectar tu WhatsApp Business en minutos.", "Create your account to connect your WhatsApp Business in minutes.")}
          </p>

          {supabaseConfigFaltante && (
            <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
              Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en el entorno.
            </p>
          )}

          <form onSubmit={enviar} className="mt-7 flex flex-col gap-3.5">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-site-muted-fg">{t("Correo", "Email")}</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-site-border bg-white/[0.02] px-4 py-2.5 text-sm text-site-fg outline-none transition-colors duration-200 focus:border-site-primary/50"
                placeholder="tu@negocio.com"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-site-muted-fg">{t("Contraseña", "Password")}</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-site-border bg-white/[0.02] px-4 py-2.5 text-sm text-site-fg outline-none transition-colors duration-200 focus:border-site-primary/50"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>
            )}
            {mensaje && (
              <p className="rounded-lg border border-site-primary/40 bg-site-primary/10 p-3 text-sm text-site-primary">
                {mensaje}
              </p>
            )}

            <button
              type="submit"
              disabled={cargando || supabaseConfigFaltante}
              className="mt-2 inline-flex h-11 items-center justify-center rounded-full bg-site-primary text-[13.5px] font-medium text-site-primary-fg transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cargando ? t("Un momento…", "One moment…") : modo === "login" ? t("Iniciar sesión", "Log in") : t("Crear cuenta", "Sign up")}
            </button>
          </form>

          <p className="mt-6 text-center text-[13px] text-site-muted-fg">
            {modo === "login" ? t("¿No tienes cuenta? ", "Don't have an account? ") : t("¿Ya tienes cuenta? ", "Already have an account? ")}
            <button
              type="button"
              onClick={() => {
                setModo(modo === "login" ? "registro" : "login");
                setError(null);
                setMensaje(null);
              }}
              className="font-semibold text-site-primary hover:text-site-fg"
            >
              {modo === "login" ? t("Regístrate", "Sign up") : t("Inicia sesión", "Log in")}
            </button>
          </p>
        </div>
      </div>

      <AuthVisual />
    </main>
  );
}
