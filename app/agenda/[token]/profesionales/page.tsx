"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, UserRound, Plus, Pencil } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { Button } from "@/components/spa-panel/ui";
import { ProfesionalModal } from "@/components/spa-panel/modals/ProfesionalModal";

export type Profesional = {
  id: number;
  nombre: string;
  numero_whatsapp: string;
  servicio: string;
  duracion_min: number;
  activo: boolean;
  bloquea_horario: boolean;
  es_general: boolean;
  requiere_aprobacion: boolean;
};

export default function ProfesionalesPage() {
  const { token } = useAgenda();
  const [profesionales, setProfesionales] = useState<Profesional[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ modo: "crear" } | { modo: "editar"; profesional: Profesional } | null>(null);

  const recargar = useCallback(() => {
    fetch(`/api/agenda/${token}/especialistas`)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else setProfesionales(body.especialistas);
      })
      .catch(() => setError("No se pudieron cargar los profesionales"));
  }, [token]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-fg">Profesionales</h1>
          <p className="text-xs text-mist">Tu equipo y sus datos de agenda</p>
        </div>
        <Button onClick={() => setModal({ modo: "crear" })}>
          <Plus className="size-4" /> Nuevo
        </Button>
      </div>

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {!profesionales && !error ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : profesionales && profesionales.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-edge bg-card p-10 text-center">
          <UserRound className="size-6 text-mist" />
          <p className="mt-2 text-sm text-mist">Todavía no tienes profesionales registrados.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {profesionales?.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lime-soft text-lime-text">
                <UserRound className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{p.nombre}</p>
                <p className="truncate text-xs text-mist">
                  {p.servicio} · {p.duracion_min} min · {p.numero_whatsapp}
                </p>
              </div>
              <span
                className={
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold " +
                  (p.activo ? "bg-success text-success-text" : "bg-ink-2 text-mist")
                }
              >
                {p.activo ? "Activo" : "Inactivo"}
              </span>
              <button
                onClick={() => setModal({ modo: "editar", profesional: p })}
                aria-label="Editar"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-mist transition-colors hover:bg-ink-2 hover:text-fg"
              >
                <Pencil className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <ProfesionalModal
          token={token}
          profesional={modal.modo === "editar" ? modal.profesional : null}
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
