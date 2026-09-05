"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { User, Lock, Eye, EyeOff, ArrowRight, Loader2 } from "lucide-react";

// Login AMORE (autorizado) — pantalla de login real, fiel al mockup
// aprobado. NOTA IMPORTANTE: la ruta pedida originalmente era "/login",
// pero esa ruta YA EXISTE y es el login del propio SaaS de DuLabs (email +
// contraseña vía Supabase Auth, ver app/login/page.tsx) -- reutilizarla
// habría roto el login real de los clientes de DuLabs. Se usa "/agenda/login"
// en su lugar, consistente con que todo el panel de agenda vive bajo
// /agenda/*. Llama a /api/agenda-auth/login (namespace propio, separado del
// /api/auth/login del dashboard interno).
export default function AgendaLoginPage() {
  const router = useRouter();
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [verPassword, setVerPassword] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisoOlvido, setAvisoOlvido] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const res = await fetch("/api/agenda-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usuario, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo iniciar sesión");
        setCargando(false);
        return;
      }
      router.push(`/agenda/${data.token}`);
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
      setCargando(false);
    }
  }

  return (
    <div className="amore-scope relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-ink px-6 py-12">
      <div className="w-full max-w-[380px]">
        <div className="flex flex-col items-center">
          <img src="/amore/logo.png" alt="AMORE Salón de Belleza" width={2067} height={761} className="h-auto w-[min(260px,70vw)] object-contain" />
        </div>

        <div className="mt-8 text-center">
          <h1 className="text-2xl font-semibold text-fg">Bienvenida</h1>
          <p className="mt-1.5 text-sm text-mist">Ingresa a tu cuenta para continuar</p>
        </div>

        <form onSubmit={enviar} className="mt-8 flex flex-col gap-3.5">
          <label className="flex items-center gap-3 rounded-2xl border border-edge bg-card px-4 py-3.5">
            <User className="size-5 shrink-0 text-mist" />
            <input
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="Usuario"
              autoComplete="username"
              required
              className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-mist"
            />
          </label>

          <label className="flex items-center gap-3 rounded-2xl border border-edge bg-card px-4 py-3.5">
            <Lock className="size-5 shrink-0 text-mist" />
            <input
              type={verPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contraseña"
              autoComplete="current-password"
              required
              className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-mist"
            />
            <button
              type="button"
              onClick={() => setVerPassword((v) => !v)}
              aria-label={verPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="shrink-0 text-mist"
            >
              {verPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </label>

          {error && <p className="text-center text-sm text-danger-text">{error}</p>}

          <button
            type="submit"
            disabled={cargando}
            className="mt-1.5 flex items-center justify-center gap-2 rounded-2xl bg-lime py-3.5 text-sm font-semibold text-lime-fg transition-colors hover:bg-lime-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cargando ? <Loader2 className="size-4 animate-spin" /> : "Iniciar sesión"}
            {!cargando && <ArrowRight className="size-4" />}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button type="button" onClick={() => setAvisoOlvido(true)} className="text-sm font-medium text-lime-text underline-offset-2 hover:underline">
            ¿Olvidaste tu contraseña?
          </button>
          {avisoOlvido && (
            <p className="mt-2 text-xs text-mist">Contacta a tu administradora para restablecer tu contraseña.</p>
          )}
        </div>

        <p className="mt-10 text-center text-xs text-mist">
          Desarrollado por <span className="font-semibold">Dulabs</span>
        </p>
      </div>
    </div>
  );
}
