"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "@/lib/dashboard-session";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useI18n } from "@/lib/i18n";

export default function CuentaPage() {
  const router = useRouter();
  const { session, suscripcion } = useDashboard();
  const { t } = useI18n();

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
        setErrorNombre(t("El nombre no puede estar vacío.", "Name can't be empty."));
        return;
      }
      setGuardandoNombre(true);
      const { error } = await supabaseBrowser().auth.updateUser({ data: { nombre: valor } });
      setGuardandoNombre(false);
      if (error) {
        setErrorNombre(error.message);
        return;
      }
      setMensajeNombre(t("Nombre actualizado.", "Name updated."));
    },
    [nombre, t]
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
        t(
          "Te enviamos un correo de confirmación a la dirección nueva (y posiblemente a la anterior). El cambio no se aplica hasta que lo confirmes.",
          "We sent a confirmation email to the new address (and possibly the old one). The change won't apply until you confirm it."
        )
      );
    },
    [correo, session, t]
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
        setError(t("La contraseña debe tener al menos 6 caracteres.", "Password must be at least 6 characters."));
        return;
      }
      if (password !== confirmar) {
        setError(t("Las contraseñas no coinciden.", "Passwords don't match."));
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
      setMensaje(t("Contraseña actualizada.", "Password updated."));
    },
    [password, confirmar, t]
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
      if (!res.ok) throw new Error(data.error ?? t("No se pudo eliminar la cuenta.", "Couldn't delete the account."));
      await supabaseBrowser().auth.signOut();
      router.push("/");
    } catch (err) {
      setErrorEliminar(err instanceof Error ? err.message : t("No se pudo eliminar la cuenta.", "Couldn't delete the account."));
      setEliminando(false);
    }
  }, [session, router, t]);

  const palabraConfirmar = t("ELIMINAR", "DELETE");

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-2xl font-semibold sm:text-3xl">{t("Cuenta", "Account")}</h1>
      <p className="mt-2 text-sm text-mist">{session?.user.email}</p>

      <section className="mt-8 rounded-2xl border border-edge/60 bg-card p-6 sm:p-8">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-mist">{t("Perfil", "Profile")}</h2>
        <div className="mt-4 flex flex-col gap-6">
          <form onSubmit={guardarNombre} className="flex flex-col gap-3">
            <label className="text-xs font-medium text-mist">{t("Nombre", "Name")}</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder={t("Tu nombre completo", "Your full name")}
                maxLength={80}
                className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
              />
              <button
                type="submit"
                disabled={guardandoNombre || nombre.trim() === nombreActual}
                className="shrink-0 rounded-lg border border-edge px-4 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {guardandoNombre ? t("Guardando…", "Saving…") : t("Guardar", "Save")}
              </button>
            </div>
            {errorNombre && <p className="text-xs text-red-600">{errorNombre}</p>}
            {mensajeNombre && <p className="text-xs text-lime-text">{mensajeNombre}</p>}
          </form>

          <form onSubmit={guardarCorreo} className="flex flex-col gap-3">
            <label className="text-xs font-medium text-mist">{t("Correo", "Email")}</label>
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
                {guardandoCorreo ? t("Enviando…", "Sending…") : t("Cambiar correo", "Change email")}
              </button>
            </div>
            {errorCorreo && <p className="text-xs text-red-600">{errorCorreo}</p>}
            {mensajeCorreo && <p className="text-xs leading-relaxed text-lime-text">{mensajeCorreo}</p>}
          </form>
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-edge/60 bg-card p-6 sm:p-8">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-mist">
          {t("Plan y facturación", "Plan & billing")}
        </h2>
        {suscripcion ? (
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-mist">{t("Plan", "Plan")}</dt>
              <dd className="mt-1 text-sm font-medium text-fg">{suscripcion.plan}</dd>
            </div>
            <div>
              <dt className="text-xs text-mist">{t("Precio", "Price")}</dt>
              <dd className="mt-1 text-sm font-medium text-fg">
                ${suscripcion.precio_cop.toLocaleString("es-CO")} {t("COP / mes", "COP / mo")}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-mist">{t("Estado", "Status")}</dt>
              <dd
                className={`mt-1 text-sm font-medium ${
                  suscripcion.estado === "activa" ? "text-lime-text" : "text-red-600"
                }`}
              >
                {suscripcion.estado}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-mist">{t("Próximo cobro", "Next charge")}</dt>
              <dd className="mt-1 text-sm font-medium text-fg">
                {new Date(
                  suscripcion.fecha_proximo_cobro + "T00:00:00"
                ).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" })}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-mist">
            {t("No tienes una suscripción activa todavía.", "You don't have an active subscription yet.")}
          </p>
        )}
      </section>

      <section className="mt-8 rounded-2xl border border-edge/60 bg-card p-6 sm:p-8">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-mist">
          {t("Cambiar contraseña", "Change password")}
        </h2>
        <form onSubmit={cambiarPassword} className="mt-4 flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-mist">
              {t("Nueva contraseña", "New password")}
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
            {guardando ? t("Guardando…", "Saving…") : t("Actualizar contraseña", "Update password")}
          </button>
        </form>
      </section>

      <section className="mt-8 rounded-2xl border border-red-500/30 bg-red-500/[0.03] p-6 sm:p-8">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-red-500">
          {t("Zona de peligro", "Danger zone")}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-mist">
          {t(
            "Esto elimina todos tus datos de WhatsApp: desconecta todos tus números de Meta y borra permanentemente todos tus mensajes, campañas y plantillas. También cancela tu suscripción y elimina tu cuenta de acceso a Du Labs. No se puede deshacer.",
            "This deletes all your WhatsApp data: it disconnects all your numbers from Meta and permanently erases all your messages, campaigns and templates. It also cancels your subscription and deletes your Du Labs login account. This can't be undone."
          )}
        </p>

        {!confirmandoBorrado ? (
          <button
            onClick={() => setConfirmandoBorrado(true)}
            className="mt-5 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-500 transition-colors hover:bg-red-500/20"
          >
            {t("Eliminar mi cuenta", "Delete my account")}
          </button>
        ) : (
          <div className="mt-5 rounded-lg border border-red-500/40 bg-red-500/10 p-4">
            <label className="block text-xs font-medium text-red-500">
              {t("Escribe ELIMINAR para confirmar", "Type DELETE to confirm")}
            </label>
            <input
              value={textoConfirmacion}
              onChange={(e) => setTextoConfirmacion(e.target.value)}
              className="mt-2 w-full rounded-lg border border-red-500/40 bg-ink-2 px-4 py-2.5 text-sm text-fg outline-none focus:border-red-500"
              placeholder={palabraConfirmar}
              autoFocus
            />
            {errorEliminar && <p className="mt-2 text-xs text-red-600">{errorEliminar}</p>}
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={eliminarCuenta}
                disabled={textoConfirmacion !== palabraConfirmar || eliminando}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {eliminando ? t("Eliminando…", "Deleting…") : t("Sí, eliminar mi cuenta", "Yes, delete my account")}
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
                {t("Cancelar", "Cancel")}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
