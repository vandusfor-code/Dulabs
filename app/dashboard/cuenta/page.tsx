"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "@/lib/dashboard-session";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function CuentaPage() {
  const router = useRouter();
  const { session, suscripcion } = useDashboard();

  // --- Perfil (nombre y correo) ---
  const nombreActual = (session?.user.user_metadata?.nombre as string | undefined) ?? "";
  const [nombre, setNombre] = useState(nombreActual);
  const [guardandoNombre, setGuardandoNombre] = useState(false);
  const [mensajeNombre, setMensajeNombre] = useState<string | null>(null);
  const [errorNombre, setErrorNombre] = useState<string | null>(null);

  const guardarNombre = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setErrorNombre(null);
      setMensajeNombre(null);
      const valor = nombre.trim();
      if (!valor) {
        setErrorNombre("El nombre no puede estar vacío.");
        return;
      }
      setGuardandoNombre(true);
      const { error } = await supabaseBrowser().auth.updateUser({ data: { nombre: valor } });
      setGuardandoNombre(false);
      if (error) {
        setErrorNombre(error.message);
        return;
      }
      setMensajeNombre("Nombre actualizado.");
    },
    [nombre]
  );

  const [correo, setCorreo] = useState(session?.user.email ?? "");
  const [guardandoCorreo, setGuardandoCorreo] = useState(false);
  const [mensajeCorreo, setMensajeCorreo] = useState<string | null>(null);
  const [errorCorreo, setErrorCorreo] = useState<string | null>(null);

  const guardarCorreo = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setErrorCorreo(null);
      setMensajeCorreo(null);
      const valor = correo.trim();
      if (!valor || valor === session?.user.email) {
        return;
      }
      setGuardandoCorreo(true);
      const { error } = await supabaseBrowser().auth.updateUser({ email: valor });
      setGuardandoCorreo(false);
      if (error) {
        setErrorCorreo(error.message);
        return;
      }
      setMensajeCorreo(
        "Te enviamos un correo de confirmación a la dirección nueva (y posiblemente a la anterior). El cambio no se aplica hasta que lo confirmes."
      );
    },
    [correo, session]
  );

  // --- Contraseña ---
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

  // --- Zona de peligro ---
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const [textoConfirmacion, setTextoConfirmacion] = useState("");
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);

  const eliminarCuenta = useCallback(async () => {
    if (!session) return;
    setEliminando(true);
    setErrorEliminar(null);
    try {
      const res = await fetch("/api/dashboard/cuenta", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo eliminar la cuenta.");
      await supabaseBrowser().auth.signOut();
      router.push("/");
    } catch (err) {
      setErrorEliminar(err instanceof Error ? err.message : "No se pudo eliminar la cuenta.");
      setEliminando(false);
    }
  }, [session, router]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-2xl font-semibold sm:text-3xl">Cuenta</h1>
      <p className="mt-2 text-sm text-mist">{session?.user.email}</p>

      <section className="mt-8 rounded-2xl border border-edge/60 bg-card p-6 sm:p-8">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-mist">Perfil</h2>
        <div className="mt-4 flex flex-col gap-6">
          <form onSubmit={guardarNombre} className="flex flex-col gap-3">
            <label className="text-xs font-medium text-mist">Nombre</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Tu nombre completo"
                maxLength={80}
                className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
              />
              <button
                type="submit"
                disabled={guardandoNombre || nombre.trim() === nombreActual}
                className="shrink-0 rounded-lg border border-edge px-4 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {guardandoNombre ? "Guardando…" : "Guardar"}
              </button>
            </div>
            {errorNombre && <p className="text-xs text-red-600">{errorNombre}</p>}
            {mensajeNombre && <p className="text-xs text-lime-text">{mensajeNombre}</p>}
          </form>

          <form onSubmit={guardarCorreo} className="flex flex-col gap-3">
            <label className="text-xs font-medium text-mist">Correo</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
              />
              <button
                type="submit"
                disabled={guardandoCorreo || correo.trim() === session?.user.email}
                className="shrink-0 rounded-lg border border-edge px-4 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {guardandoCorreo ? "Enviando…" : "Cambiar correo"}
              </button>
            </div>
            {errorCorreo && <p className="text-xs text-red-600">{errorCorreo}</p>}
            {mensajeCorreo && <p className="text-xs leading-relaxed text-lime-text">{mensajeCorreo}</p>}
          </form>
        </div>
      </section>

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

      <section className="mt-8 rounded-2xl border border-red-500/30 bg-red-500/[0.03] p-6 sm:p-8">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-red-500">
          Zona de peligro
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-mist">
          Esto elimina todos tus datos de WhatsApp: desconecta todos tus números de Meta y borra
          permanentemente todos tus mensajes, campañas y plantillas. También cancela tu
          suscripción y elimina tu cuenta de acceso a Du Labs. No se puede deshacer.
        </p>

        {!confirmandoBorrado ? (
          <button
            onClick={() => setConfirmandoBorrado(true)}
            className="mt-5 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-500 transition-colors hover:bg-red-500/20"
          >
            Eliminar mi cuenta
          </button>
        ) : (
          <div className="mt-5 rounded-lg border border-red-500/40 bg-red-500/10 p-4">
            <label className="block text-xs font-medium text-red-500">
              Escribe ELIMINAR para confirmar
            </label>
            <input
              value={textoConfirmacion}
              onChange={(e) => setTextoConfirmacion(e.target.value)}
              className="mt-2 w-full rounded-lg border border-red-500/40 bg-ink-2 px-4 py-2.5 text-sm text-fg outline-none focus:border-red-500"
              placeholder="ELIMINAR"
              autoFocus
            />
            {errorEliminar && <p className="mt-2 text-xs text-red-600">{errorEliminar}</p>}
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={eliminarCuenta}
                disabled={textoConfirmacion !== "ELIMINAR" || eliminando}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {eliminando ? "Eliminando…" : "Sí, eliminar mi cuenta"}
              </button>
              <button
                onClick={() => {
                  setConfirmandoBorrado(false);
                  setTextoConfirmacion("");
                  setErrorEliminar(null);
                }}
                disabled={eliminando}
                className="rounded-lg px-4 py-2 text-sm font-medium text-mist hover:bg-ink-2 disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
