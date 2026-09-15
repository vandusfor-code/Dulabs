"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, KeyRound } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { AdminOnlyDesktop } from "@/components/admin-web/AdminOnlyDesktop";
import { inicialesDe } from "@/components/spa-panel/format";
import { ProfesionalModal } from "@/components/spa-panel/modals/ProfesionalModal";
import type { Profesional } from "@/app/agenda/[token]/profesionales/page";
import type { Servicio } from "@/app/agenda/[token]/servicios/page";
import { RUTA_EQUIPO, RUTA_EQUIPO_USUARIOS } from "@/components/admin-web/admin-web-routes";

// Panel web AMORE (autorizado) — Trabajadoras desktop: MISMAS APIs y MISMO
// ProfesionalModal reales que ya usa el móvil, en tabla. Admin-only.
export default function AdminAmoreEquipoPage() {
  return (
    <AdminOnlyDesktop>
      <EquipoContenido />
    </AdminOnlyDesktop>
  );
}

function EquipoContenido() {
  const { token } = useAdminWeb();
  const router = useRouter();
  const [especialistas, setEspecialistas] = useState<Profesional[] | null>(null);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<Profesional | null | "nuevo">(null);

  const cargar = useCallback(() => {
    fetch(`/api/agenda/${token}/especialistas`)
      .then((r) => r.json())
      .then((body) => (body.error ? setError(body.error) : setEspecialistas(body.especialistas)))
      .catch(() => setError("No se pudo cargar el equipo"));
    fetch(`/api/agenda/${token}/servicios`)
      .then((r) => r.json())
      .then((body) => setServicios(body.servicios ?? []))
      .catch(() => {});
  }, [token]);

  useEffect(() => cargar(), [cargar]);

  function serviciosDe(id: number): number {
    return servicios.filter((s) => s.especialistaIds.includes(id)).length;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">Trabajadoras</h1>
          <p className="text-sm text-mist">Especialistas de AMORE</p>
        </div>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => router.push(RUTA_EQUIPO_USUARIOS)}
            className="flex items-center gap-1.5 rounded-xl bg-ink-2 px-4 py-2.5 text-sm font-medium text-fg"
          >
            <KeyRound className="size-4" /> Usuarios
          </button>
          <button
            type="button"
            onClick={() => setEditando("nuevo")}
            className="flex items-center gap-1.5 rounded-xl bg-lime px-4 py-2.5 text-sm font-medium text-lime-fg hover:bg-lime-hover"
          >
            <Plus className="size-4" /> Nueva
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-danger-text">{error}</p>}

      <div className="grid grid-cols-3 gap-4">
        {!especialistas ? (
          <div className="col-span-3 flex justify-center py-16">
            <Loader2 className="size-5 animate-spin text-mist" />
          </div>
        ) : (
          especialistas.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => router.push(`${RUTA_EQUIPO}/${m.id}`)}
              className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-4 text-left shadow-sm hover:border-lime/40"
            >
              <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-lime-soft text-sm font-semibold text-lime-text">
                {inicialesDe(m.nombre)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{m.nombre}</p>
                <p className="truncate text-xs text-mist">
                  {serviciosDe(m.id)} {serviciosDe(m.id) === 1 ? "servicio asignado" : "servicios asignados"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  m.activo ? "bg-success text-success-text" : "bg-ink-2 text-mist"
                }`}
              >
                {m.activo ? "Activa" : "Inactiva"}
              </span>
            </button>
          ))
        )}
      </div>

      {editando && (
        <ProfesionalModal
          token={token}
          profesional={editando === "nuevo" ? null : editando}
          onClose={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}
