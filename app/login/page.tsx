"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Modo = "login" | "registro";

const supabaseConfigFaltante =
  !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default function LoginPage() {
  const router = useRouter();
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
        "Cuenta creada. Si tu proyecto requiere confirmación por correo, revisa tu bandeja antes de iniciar sesión."
      );
      setModo("login");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-5 py-16 text-white">
      <div className="w-full max-w-md rounded-2xl border border-edge/60 bg-card p-8 sm:p-10">
        <Link
          href="/"
          className="text-sm text-lime transition-colors duration-200 hover:text-white"
        >
          ← Volver a Du Labs
        </Link>
        <h1 className="mt-6 text-2xl font-semibold sm:text-3xl">
          {modo === "login" ? "Inicia sesión" : "Crea tu cuenta"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-mist">
          Accede a tu panel de Du IA Business para conectar y administrar tus
          números de WhatsApp.
        </p>

        {supabaseConfigFaltante && (
          <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en el entorno.
          </p>
        )}

        <form onSubmit={enviar} className="mt-8 flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-mist">
              Correo
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-white outline-none transition-colors duration-200 focus:border-lime/50"
              placeholder="tu@negocio.com"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-mist">
              Contraseña
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-white outline-none transition-colors duration-200 focus:border-lime/50"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </p>
          )}
          {mensaje && (
            <p className="rounded-lg border border-lime/40 bg-lime/10 p-3 text-sm text-lime">
              {mensaje}
            </p>
          )}

          <button
            type="submit"
            disabled={cargando || supabaseConfigFaltante}
            className="btn-shine mt-2 rounded-lg bg-lime px-6 py-3 text-sm font-semibold text-ink transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cargando
              ? "Un momento…"
              : modo === "login"
                ? "Iniciar sesión"
                : "Crear cuenta"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-mist">
          {modo === "login" ? "¿No tienes cuenta? " : "¿Ya tienes cuenta? "}
          <button
            type="button"
            onClick={() => {
              setModo(modo === "login" ? "registro" : "login");
              setError(null);
              setMensaje(null);
            }}
            className="font-semibold text-lime hover:text-white"
          >
            {modo === "login" ? "Regístrate" : "Inicia sesión"}
          </button>
        </p>
      </div>
    </main>
  );
}
