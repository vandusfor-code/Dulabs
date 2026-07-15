"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useDashboard } from "@/lib/dashboard-session";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function CuentaPage() {
  const { session, suscripcion } = useDashboard();
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cambiarPassword = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      setMensaje(null);

      if (password.length < 6) {
        setError("La contraseña debe tener al menos 6 caracteres.");
        return;
      }
      if (password !== confirmar) {
        setError("Las contraseñas no coinciden.");
        return;
      }

      setGuardando(true);
      const { error: err } = await supabaseBrowser().auth.updateUser({ password });
      setGuardando(false);
      if (err) {
        setError(err.message);
        return;
      }
      setPassword("");
      setConfirmar("");
      setMensaje("Contraseña actualizada.");
    },
    [password, confirmar]
  );

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-2xl font-semibold sm:text-3xl">Cuenta</h1>
      <p className="mt-2 text-sm text-mist">{session?.user.email}</p>

      <section className="mt-8 rounded-2xl border border-edge/60 bg-card p-6 sm:p-8">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-mist">
          Plan y facturación
        </h2>
        {suscripcion ? (
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-mist">Plan</dt>
              <dd className="mt-1 text-sm font-medium text-fg">{suscripcion.plan}</dd>
            </div>
            <div>
              <dt className="text-xs text-mist">Precio</dt>
              <dd className="mt-1 text-sm font-medium text-fg">
                ${suscripcion.precio_cop.toLocaleString("es-CO")} COP / mes
              </dd>
            </div>
            <div>
              <dt className="text-xs text-mist">Estado</dt>
              <dd
                className={`mt-1 text-sm font-medium ${
                  suscripcion.estado === "activa" ? "text-lime-text" : "text-red-600"
                }`}
              >
                {suscripcion.estado}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-mist">Próximo cobro</dt>
              <dd className="mt-1 text-sm font-medium text-fg">
                {new Date(
                  suscripcion.fecha_proximo_cobro + "T00:00:00"
                ).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" })}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-mist">
            No tienes una suscripción activa todavía.
          </p>
        )}
      </section>

      <section className="mt-8 rounded-2xl border border-edge/60 bg-card p-6 sm:p-8">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-mist">
          Cambiar contraseña
        </h2>
        <form onSubmit={cambiarPassword} className="mt-4 flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-mist">
              Nueva contraseña
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-mist">
              Confirmar contraseña
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">
              {error}
            </p>
          )}
          {mensaje && (
            <p className="rounded-lg border border-lime/40 bg-lime/10 p-3 text-sm text-lime-text">
              {mensaje}
            </p>
          )}

          <button
            type="submit"
            disabled={guardando}
            className="btn-shine mt-2 self-start rounded-lg bg-lime px-6 py-2.5 text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Actualizar contraseña"}
          </button>
        </form>
      </section>
    </div>
  );
}
