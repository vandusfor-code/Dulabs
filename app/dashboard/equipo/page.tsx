"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import type { Rol } from "@/lib/team";

type MiembroEquipo = {
  id: number;
  email: string;
  nombre: string | null;
  rol: Rol;
  estado: "invitado" | "activo" | "suspendido";
  created_at: string;
};

export default function EquipoPage() {
  const router = useRouter();
  const { session, rol } = useDashboard();
  const { t } = useI18n();

  const [miembros, setMiembros] = useState<MiembroEquipo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargarEquipo = useCallback(() => {
    if (!session) return;
    fetch("/api/dashboard/equipo", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setMiembros(data.miembros ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session]);

  useEffect(() => {
    cargarEquipo();
  }, [cargarEquipo]);

  // Solo admin puede ver esta página. La API es el gate real; esto solo
  // evita mostrar la pantalla a quien no debería verla.
  useEffect(() => {
    if (rol && rol !== "admin") router.replace("/dashboard");
  }, [rol, router]);

  const [email, setEmail] = useState("");
  const [rolInvitado, setRolInvitado] = useState<Rol>("agente");
  const [invitando, setInvitando] = useState(false);
  const [errorInvitar, setErrorInvitar] = useState<string | null>(null);
  const [mensajeInvitar, setMensajeInvitar] = useState<string | null>(null);

  const invitar = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!session) return;
      setErrorInvitar(null);
      setMensajeInvitar(null);
      setInvitando(true);
      try {
        const res = await fetch("/api/dashboard/equipo", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ email: email.trim(), rol: rolInvitado }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("Error enviando la invitación", "Error sending the invitation"));
        setMensajeInvitar(t("Invitación enviada.", "Invitation sent."));
        setEmail("");
        cargarEquipo();
      } catch (err) {
        setErrorInvitar(err instanceof Error ? err.message : String(err));
      } finally {
        setInvitando(false);
      }
    },
    [session, email, rolInvitado, cargarEquipo, t]
  );

  const [actualizando, setActualizando] = useState<number | null>(null);

  const cambiarMiembro = useCallback(
    async (miembroId: number, cambios: { rol?: Rol; estado?: "activo" | "suspendido" }) => {
      if (!session) return;
      setActualizando(miembroId);
      setError(null);
      try {
        const res = await fetch("/api/dashboard/equipo", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ miembro_id: miembroId, ...cambios }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("No se pudo actualizar el miembro.", "Couldn't update the member."));
        cargarEquipo();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setActualizando(null);
      }
    },
    [session, cargarEquipo, t]
  );

  const estadoTono: Record<MiembroEquipo["estado"], "success" | "warning" | "neutral"> = {
    activo: "success",
    invitado: "warning",
    suspendido: "neutral",
  };
  const estadoLabel: Record<MiembroEquipo["estado"], string> = {
    activo: t("Activo", "Active"),
    invitado: t("Invitado", "Invited"),
    suspendido: t("Suspendido", "Suspended"),
  };

  if (rol && rol !== "admin") return null;

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Infraestructura"
        title={t("Equipo", "Team")}
        description={t(
          "Invita a tu equipo a responder desde el Inbox web y controla qué puede hacer cada persona.",
          "Invite your team to reply from the web Inbox and control what each person can do."
        )}
      />

      <div className="px-4 pt-6 md:px-8">
        <section className="rounded-xl border border-edge bg-card p-5">
          <h2 className="text-sm font-semibold text-fg">{t("Invitar a alguien", "Invite someone")}</h2>
          <form onSubmit={invitar} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium text-mist">{t("Correo", "Email")}</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nombre@ejemplo.com"
                className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">{t("Rol", "Role")}</label>
              <select
                value={rolInvitado}
                onChange={(e) => setRolInvitado(e.target.value as Rol)}
                className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50 sm:w-auto"
              >
                <option value="admin">{t("Administrador", "Admin")}</option>
                <option value="agente">{t("Agente", "Agent")}</option>
                <option value="lectura">{t("Solo lectura", "Read only")}</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={invitando}
              className="flex items-center justify-center gap-2 rounded-lg bg-lime px-4 py-2.5 text-sm font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UserPlus className="size-4" />
              {invitando ? t("Invitando…", "Inviting…") : t("Invitar", "Invite")}
            </button>
          </form>
          {errorInvitar && <p className="mt-3 text-xs text-red-400">{errorInvitar}</p>}
          {mensajeInvitar && <p className="mt-3 text-xs text-lime-text">{mensajeInvitar}</p>}
        </section>

        <section className="mt-6 rounded-xl border border-edge bg-card p-5">
          <h2 className="text-sm font-semibold text-fg">{t("Miembros del equipo", "Team members")}</h2>
          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
          {miembros === null ? (
            <p className="mt-4 text-sm text-mist">{t("Cargando…", "Loading…")}</p>
          ) : miembros.length === 0 ? (
            <p className="mt-4 text-sm text-mist">{t("Todavía no hay miembros.", "No members yet.")}</p>
          ) : (
            <div className="mt-4 divide-y divide-edge">
              {miembros.map((m) => (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{m.nombre || m.email}</p>
                    <p className="truncate text-xs text-mist">{m.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Pill tone={estadoTono[m.estado]}>{estadoLabel[m.estado]}</Pill>
                    <select
                      value={m.rol}
                      disabled={actualizando === m.id}
                      onChange={(e) => cambiarMiembro(m.id, { rol: e.target.value as Rol })}
                      className="rounded-lg border border-edge bg-ink px-2.5 py-1.5 text-xs text-fg outline-none focus:border-lime/50 disabled:opacity-50"
                    >
                      <option value="admin">{t("Administrador", "Admin")}</option>
                      <option value="agente">{t("Agente", "Agent")}</option>
                      <option value="lectura">{t("Solo lectura", "Read only")}</option>
                    </select>
                    {m.estado === "suspendido" ? (
                      <button
                        onClick={() => cambiarMiembro(m.id, { estado: "activo" })}
                        disabled={actualizando === m.id}
                        className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-ink disabled:opacity-50"
                      >
                        {t("Reactivar", "Reactivate")}
                      </button>
                    ) : (
                      <button
                        onClick={() => cambiarMiembro(m.id, { estado: "suspendido" })}
                        disabled={actualizando === m.id}
                        className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                      >
                        {t("Suspender", "Suspend")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
