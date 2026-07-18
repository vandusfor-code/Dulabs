"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";

type RespuestaRapida = {
  id: number;
  atajo: string;
  mensaje: string;
  created_at: string;
  updated_at: string;
};

export default function RespuestasRapidasPage() {
  const router = useRouter();
  const { session, rol } = useDashboard();
  const { t } = useI18n();

  const [respuestas, setRespuestas] = useState<RespuestaRapida[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    if (!session) return;
    fetch("/api/dashboard/respuestas-rapidas", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setRespuestas(data.respuestas ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Solo admin/agente ven esta página — lectura nunca envía mensajes, así
  // que no tiene uso para snippets de compose box. La API es el gate real.
  useEffect(() => {
    if (rol && rol === "lectura") router.replace("/dashboard");
  }, [rol, router]);

  const [atajo, setAtajo] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [creando, setCreando] = useState(false);
  const [errorCrear, setErrorCrear] = useState<string | null>(null);

  const crear = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!session) return;
      setErrorCrear(null);
      setCreando(true);
      try {
        const res = await fetch("/api/dashboard/respuestas-rapidas", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ atajo: atajo.trim(), mensaje: mensaje.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("No se pudo crear la respuesta rápida.", "Couldn't create the quick reply."));
        setAtajo("");
        setMensaje("");
        cargar();
      } catch (err) {
        setErrorCrear(err instanceof Error ? err.message : String(err));
      } finally {
        setCreando(false);
      }
    },
    [session, atajo, mensaje, cargar, t]
  );

  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [editAtajo, setEditAtajo] = useState("");
  const [editMensaje, setEditMensaje] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [borrandoId, setBorrandoId] = useState<number | null>(null);

  const empezarEdicion = (r: RespuestaRapida) => {
    setEditandoId(r.id);
    setEditAtajo(r.atajo);
    setEditMensaje(r.mensaje);
  };

  const guardarEdicion = useCallback(
    async (id: number) => {
      if (!session) return;
      setGuardando(true);
      setError(null);
      try {
        const res = await fetch("/api/dashboard/respuestas-rapidas", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ id, atajo: editAtajo.trim(), mensaje: editMensaje.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("No se pudo guardar.", "Couldn't save."));
        setEditandoId(null);
        cargar();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setGuardando(false);
      }
    },
    [session, editAtajo, editMensaje, cargar, t]
  );

  const borrar = useCallback(
    async (id: number) => {
      if (!session) return;
      setBorrandoId(id);
      setError(null);
      try {
        const res = await fetch("/api/dashboard/respuestas-rapidas", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("No se pudo borrar.", "Couldn't delete."));
        cargar();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBorrandoId(null);
      }
    },
    [session, cargar, t]
  );

  if (rol && rol === "lectura") return null;

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Inbox"
        title={t("Respuestas rápidas", "Quick replies")}
        description={t(
          "Snippets de texto que puedes insertar en el compose box del Inbox escribiendo \"/\" seguido del atajo.",
          'Text snippets you can insert into the Inbox compose box by typing "/" followed by the shortcut.'
        )}
      />

      <div className="px-4 pt-6 md:px-8">
        <section className="rounded-xl border border-edge bg-card p-5">
          <h2 className="text-sm font-semibold text-fg">{t("Nueva respuesta rápida", "New quick reply")}</h2>
          <form onSubmit={crear} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-48">
              <label className="mb-1.5 block text-xs font-medium text-mist">{t("Atajo", "Shortcut")}</label>
              <input
                type="text"
                required
                value={atajo}
                onChange={(e) => setAtajo(e.target.value)}
                placeholder={t("saludo", "greeting")}
                className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium text-mist">{t("Mensaje", "Message")}</label>
              <input
                type="text"
                required
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                placeholder={t("Hola, ¿en qué te puedo ayudar?", "Hi, how can I help you?")}
                className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
              />
            </div>
            <button
              type="submit"
              disabled={creando}
              className="flex items-center justify-center gap-2 rounded-lg bg-lime px-4 py-2.5 text-sm font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="size-4" />
              {creando ? t("Creando…", "Creating…") : t("Crear", "Create")}
            </button>
          </form>
          {errorCrear && <p className="mt-3 text-xs text-red-400">{errorCrear}</p>}
        </section>

        <section className="mt-6 rounded-xl border border-edge bg-card p-5">
          <h2 className="text-sm font-semibold text-fg">{t("Tus respuestas rápidas", "Your quick replies")}</h2>
          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
          {respuestas === null ? (
            <p className="mt-4 text-sm text-mist">{t("Cargando…", "Loading…")}</p>
          ) : respuestas.length === 0 ? (
            <p className="mt-4 text-sm text-mist">{t("Todavía no hay respuestas rápidas.", "No quick replies yet.")}</p>
          ) : (
            <div className="mt-4 divide-y divide-edge">
              {respuestas.map((r) =>
                editandoId === r.id ? (
                  <div key={r.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-end">
                    <input
                      type="text"
                      value={editAtajo}
                      onChange={(e) => setEditAtajo(e.target.value)}
                      className="rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-lime/50 sm:w-40"
                    />
                    <input
                      type="text"
                      value={editMensaje}
                      onChange={(e) => setEditMensaje(e.target.value)}
                      className="flex-1 rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-lime/50"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => guardarEdicion(r.id)}
                        disabled={guardando}
                        className="rounded-lg bg-lime px-3 py-2 text-xs font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {t("Guardar", "Save")}
                      </button>
                      <button
                        onClick={() => setEditandoId(null)}
                        className="rounded-lg border border-edge px-3 py-2 text-xs font-medium text-fg transition-colors hover:bg-ink"
                      >
                        {t("Cancelar", "Cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">/{r.atajo}</p>
                      <p className="truncate text-xs text-mist">{r.mensaje}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => empezarEdicion(r)}
                        className="rounded-lg border border-edge p-2 text-fg transition-colors hover:bg-ink"
                        aria-label={t("Editar", "Edit")}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => borrar(r.id)}
                        disabled={borrandoId === r.id}
                        className="rounded-lg border border-red-500/40 p-2 text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                        aria-label={t("Borrar", "Delete")}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
