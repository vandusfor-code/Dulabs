"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles, Plus, Pencil } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { AdminOnlyDesktop } from "@/components/admin-web/AdminOnlyDesktop";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { ServicioModal } from "@/components/spa-panel/modals/ServicioModal";
import type { Profesional } from "@/app/agenda/[token]/profesionales/page";
import type { Servicio } from "@/app/agenda/[token]/servicios/page";

// Panel web AMORE (autorizado) — Servicios desktop: MISMAS APIs y MISMO
// ServicioModal reales que ya usa el móvil, en tabla. Admin-only.
export default function AdminAmoreServiciosPage() {
  return (
    <AdminOnlyDesktop>
      <ServiciosContenido />
    </AdminOnlyDesktop>
  );
}

function ServiciosContenido() {
  const { token } = useAdminWeb();
  const [servicios, setServicios] = useState<Servicio[] | null>(null);
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ modo: "crear" } | { modo: "editar"; servicio: Servicio } | null>(null);

  const recargar = useCallback(() => {
    fetch(`/api/agenda/${token}/servicios`)
      .then((r) => r.json())
      .then((body) => (body.error ? setError(body.error) : setServicios(body.servicios)))
      .catch(() => setError("No se pudieron cargar los servicios"));
  }, [token]);

  useEffect(() => {
    recargar();
    fetch(`/api/agenda/${token}/especialistas`)
      .then((r) => r.json())
      .then((body) => setProfesionales(body.especialistas ?? []))
      .catch(() => {});
  }, [token, recargar]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">Servicios</h1>
          <p className="text-sm text-mist">Catálogo real que verán tus clientas al reservar</p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ modo: "crear" })}
          className="flex items-center gap-1.5 rounded-xl bg-lime px-4 py-2.5 text-sm font-medium text-lime-fg hover:bg-lime-hover"
        >
          <Plus className="size-4" /> Nuevo
        </button>
      </div>

      {error && <p className="text-sm text-danger-text">{error}</p>}

      <div className="rounded-2xl border border-edge bg-card shadow-sm">
        {!servicios && !error ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-5 animate-spin text-mist" />
          </div>
        ) : servicios && servicios.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <Sparkles className="size-6 text-mist" />
            <p className="mt-2 text-sm text-mist">Todavía no tienes servicios creados.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-mist">
                <th className="px-5 py-3 font-medium">Servicio</th>
                <th className="px-5 py-3 font-medium">Duración</th>
                <th className="px-5 py-3 font-medium">Precio</th>
                <th className="px-5 py-3 font-medium">Profesionales</th>
                <th className="px-5 py-3 font-medium">Estado</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {servicios?.map((s) => (
                <tr key={s.id}>
                  <td className="px-5 py-3 font-medium text-fg">{s.nombre}</td>
                  <td className="px-5 py-3 text-fg">{s.duracion_min} min</td>
                  <td className="px-5 py-3 text-fg">{s.precio != null ? formatearPrecioCop(s.precio) : "—"}</td>
                  <td className="px-5 py-3 text-fg">{s.especialistaIds.length}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                        s.activo ? "bg-success text-success-text" : "bg-ink-2 text-mist"
                      }`}
                    >
                      {s.activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setModal({ modo: "editar", servicio: s })}
                      aria-label="Editar"
                      className="flex size-8 items-center justify-center rounded-lg text-mist hover:bg-ink-2 hover:text-fg"
                    >
                      <Pencil className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <ServicioModal
          token={token}
          servicio={modal.modo === "editar" ? modal.servicio : null}
          profesionales={profesionales}
          onClose={() => setModal(null)}
          onGuardado={() => {
            setModal(null);
            recargar();
          }}
        />
      )}
    </div>
  );
}
