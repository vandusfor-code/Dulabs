"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { siteUrlCon } from "@/lib/site-url";

// DuLabs Developer -- registro completo. Crea la cuenta en Supabase Auth con
// los datos de negocio en user_metadata (nombre, empresa, whatsapp normalizado
// E.164). El primer workspace se auto-provisiona al entrar al dashboard tras
// confirmar el correo (ver lib/dev-dashboard/developer-session + RPC
// dulabs_dev_provisionar_onboarding). El emailRedirectTo usa la URL de
// producción (nunca localhost). Identidad visual DuLabs (tokens site-*).

const COOLDOWN_S = 45;

/** Normaliza a E.164: deja solo dígitos + un "+" inicial. Devuelve null si no es válido. */
function normalizarWhatsapp(entrada: string): string | null {
  const limpio = entrada.replace(/[^\d+]/g, "");
  const conMas = limpio.startsWith("+") ? limpio : `+${limpio}`;
  return /^\+[1-9]\d{9,14}$/.test(conMas) ? conMas : null;
}

export default function RegistroDeveloperPage() {
  const [nombre, setNombre] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("+57 ");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [acepta, setAcepta] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<string | null>(null); // email al que se envió
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const fuerza = ((): { label: string; nivel: 0 | 1 | 2 | 3 } => {
    let n = 0;
    if (password.length >= 8) n++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) n++;
    if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) n++;
    const nivel = Math.min(n, 3) as 0 | 1 | 2 | 3;
    return { label: ["Muy débil", "Débil", "Aceptable", "Fuerte"][nivel], nivel };
  })();

  function validar(): string | null {
    if (nombre.trim().length < 3) return "Ingresa tu nombre completo.";
    if (empresa.trim().length < 2) return "Ingresa el nombre de tu empresa o proyecto.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Ingresa un correo electrónico válido.";
    if (!normalizarWhatsapp(whatsapp)) return "Ingresa tu WhatsApp en formato internacional, p. ej. +57 3001234567.";
    if (password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
    if (password !== confirm) return "Las contraseñas no coinciden.";
    if (!acepta) return "Debes aceptar los términos y la política de privacidad para continuar.";
    return null;
  }

  async function registrar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const err = validar();
    if (err) { setError(err); return; }
    setCargando(true);
    const whatsappE164 = normalizarWhatsapp(whatsapp)!;
    const { error: signErr } = await supabaseBrowser().auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { nombre: nombre.trim(), empresa: empresa.trim(), whatsapp: whatsappE164, producto: "developer" },
        emailRedirectTo: siteUrlCon("/login?next=/developer&verificado=1"),
      },
    });
    setCargando(false);
    if (signErr) {
      const m = signErr.message.toLowerCase();
      if (m.includes("already") || m.includes("registered") || m.includes("exists"))
        setError("Ese correo ya tiene una cuenta. Inicia sesión o usa otro correo.");
      else if (m.includes("password")) setError("La contraseña no cumple los requisitos mínimos.");
      else setError(signErr.message);
      return;
    }
    setEnviado(email.trim());
    setCooldown(COOLDOWN_S);
  }

  async function reenviar() {
    if (!enviado || cooldown > 0) return;
    setCooldown(COOLDOWN_S);
    await supabaseBrowser().auth.resend({
      type: "signup",
      email: enviado,
      options: { emailRedirectTo: siteUrlCon("/login?next=/developer&verificado=1") },
    });
  }

  if (enviado) {
    return (
      <main className="dev-scope relative flex min-h-screen items-center justify-center bg-site-bg px-6 py-16 text-site-fg">
        <div className="pointer-events-none absolute inset-0 site-grid-bg-fine opacity-30" />
        <div className="relative w-full max-w-[440px] rounded-2xl border border-site-border bg-site-card/40 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-site-border bg-white/[0.02]">
            <svg viewBox="0 0 24 24" className="h-6 w-6 text-site-primary" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M4 6h16v12H4z" strokeLinejoin="round" /><path d="M4 7l8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="mt-5 font-display text-[24px] font-medium tracking-tight site-text-gradient">Revisa tu correo</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-site-muted-fg">
            Te enviamos un enlace de confirmación a <span className="font-medium text-site-fg">{enviado}</span>. Ábrelo para
            activar tu cuenta de DuLabs Developer y entrar a tu workspace.
          </p>
          <button
            onClick={reenviar}
            disabled={cooldown > 0}
            className="mt-6 w-full rounded-lg border border-site-border bg-white/[0.02] px-4 py-2.5 text-sm text-site-fg transition-colors hover:border-site-primary/50 disabled:opacity-50"
          >
            {cooldown > 0 ? `Reenviar correo en ${cooldown}s` : "Reenviar correo"}
          </button>
          <p className="mt-4 text-[13px] text-site-muted-fg">
            ¿Ya lo confirmaste? <Link href="/login?next=/developer" className="text-site-primary hover:text-site-fg">Inicia sesión</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-site-bg px-6 py-16 text-site-fg">
      <div className="pointer-events-none absolute inset-0 site-grid-bg-fine opacity-30" />
      <div className="relative w-full max-w-[460px]">
        <Link href="/developer-platform" className="inline-flex items-center gap-2.5">
          <Image src="/logo.png" alt="DuLabs" width={28} height={28} className="rounded-md" priority />
          <span className="flex flex-col leading-none">
            <span className="font-display text-[15px] font-medium tracking-tight text-site-fg">DuLabs</span>
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.15em] text-site-primary">Developers</span>
          </span>
        </Link>

        <h1 className="mt-8 font-display text-[28px] font-medium leading-[1.08] tracking-tight site-text-gradient">
          Crea tu cuenta de DuLabs Developer
        </h1>
        <p className="mt-2 text-[13.5px] text-site-muted-fg">
          Construye sobre la infraestructura de DuLabs: WhatsApp API, flows, webhooks y más.
        </p>

        {error ? (
          <p className="mt-5 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>
        ) : null}

        <form onSubmit={registrar} className="mt-6 flex flex-col gap-3.5">
          <Campo label="Nombre completo">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" placeholder="Juan Pérez" className={inputCls} />
          </Campo>
          <Campo label="Empresa o proyecto">
            <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} autoComplete="organization" placeholder="Mi Empresa S.A.S" className={inputCls} />
          </Campo>
          <Campo label="Correo electrónico">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="tu@empresa.com" className={inputCls} />
          </Campo>
          <Campo label="WhatsApp" hint="Con código de país. Lo usamos para enviarte la confirmación.">
            <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} type="tel" autoComplete="tel" placeholder="+57 3001234567" className={inputCls} />
          </Campo>
          <Campo label="Contraseña">
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" placeholder="Mínimo 8 caracteres" className={inputCls} />
            {password ? (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex flex-1 gap-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className={`h-1 flex-1 rounded-full ${i < fuerza.nivel ? "bg-site-primary" : "bg-site-border"}`} />
                  ))}
                </div>
                <span className="text-[11px] text-site-muted-fg">{fuerza.label}</span>
              </div>
            ) : null}
          </Campo>
          <Campo label="Confirmar contraseña">
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} type="password" autoComplete="new-password" placeholder="Repite tu contraseña" className={inputCls} />
          </Campo>

          <label className="mt-1 flex items-start gap-2.5 text-[12.5px] text-site-muted-fg">
            <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-site-border bg-transparent accent-site-primary" />
            <span>
              Acepto los <Link href="/terminos" className="text-site-primary hover:text-site-fg">Términos</Link> y la{" "}
              <Link href="/privacidad" className="text-site-primary hover:text-site-fg">Política de privacidad</Link>.
            </span>
          </label>

          <button
            type="submit"
            disabled={cargando}
            className="mt-2 inline-flex h-11 items-center justify-center rounded-lg bg-site-fg px-5 text-sm font-medium text-site-bg transition-all hover:bg-site-fg/90 disabled:opacity-60"
          >
            {cargando ? "Creando tu cuenta…" : "Crear mi workspace"}
          </button>
        </form>

        <p className="mt-5 text-[13px] text-site-muted-fg">
          ¿Ya tienes cuenta? <Link href="/login?next=/developer" className="text-site-primary hover:text-site-fg">Inicia sesión</Link>
        </p>
      </div>
    </main>
  );
}

const inputCls =
  "w-full rounded-lg border border-site-border bg-white/[0.02] px-4 py-2.5 text-sm text-site-fg outline-none transition-colors duration-200 placeholder:text-site-muted-fg/60 focus:border-site-primary/50";

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-medium text-site-muted-fg">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-site-muted-fg/70">{hint}</p> : null}
    </div>
  );
}
