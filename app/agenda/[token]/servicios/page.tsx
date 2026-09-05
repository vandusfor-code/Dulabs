"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles, Plus, Pencil } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { Button } from "@/components/spa-panel/ui";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { ServicioModal } from "@/components/spa-panel/modals/ServicioModal";
import type { Profesional } from "@/app/agenda/[token]/profesionales/page";
import { AmoreServiciosScreen } from "@/components/spa-panel/amore/AmoreServiciosScreen";

export type Servicio = {
  id: string;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  duracion_min: number;
  precio: number | null;
  activo: boolean;
  especialistaIds: number[];
};

export default function ServiciosPage() {
  const { token, datos } = useAgenda();
  const [servicios, setServicios] = useState<Servicio[] | null>(null);
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ modo: "crear" } | { modo: "editar"; servicio: Servicio } | null>(null);

  const recargar = useCallback(() => {
    fetch(`/api/agenda/${token}/servicios`)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else setServicios(body.servicios);
      })
      .catch(() => setError("No se pudieron cargar los servicios"));
  }, [token]);

  useEffect(() => {
    recargar();
    fetch(`/api/agenda/${token}/especialistas`)
      .then((r) => r.json())
      .then((body) => setProfesionales(body.especialistas ?? []))
      .catch(() => {});
  }, [token, recargar]);

  // AMORE (Fase 5, diseño visual completo, autorizado) — SOLO este tenant ve
  // el catálogo con el design system móvil (misma API real de arriba, solo
  // otra piel). Daniela conserva exactamente esta misma página tal cual
  // estaba (todos los hooks de arriba ya se llamaron igual para ambos).
  if (datos.negocio === "AMORE") {
    return <AmoreServiciosScreen />;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-fg">Servicios</h1>
          <p className="text-xs text-mist">Catálogo real que verán tus clientas al reservar</p>
        </div>
        <Button onClick={() => setModal({ modo: "crear" })}>
          <Plus className="size-4" /> Nuevo
        </Button>
      </div>

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {!servicios && !error ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : servicios && servicios.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-edge bg-card p-10 text-center">
          <Sparkles className="size-6 text-mist" />
          <p className="mt-2 text-sm text-mist">Todavía no tienes servicios creados.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {servicios?.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{s.nombre}</p>
                <p className="truncate text-xs text-mist">
                  {s.duracion_min} min{s.precio != null ? ` · ${formatearPrecioCop(s.precio)}` : ""} ·{" "}
                  {s.especialistaIds.length} profesional{s.especialistaIds.length === 1 ? "" : "es"}
                </p>
              </div>
              <span
                className={
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold " +
                  (s.activo ? "bg-success text-success-text" : "bg-ink-2 text-mist")
                }
              >
                {s.activo ? "Activo" : "Inactivo"}
              </span>
              <button
                onClick={() => setModal({ modo: "editar", servicio: s })}
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
