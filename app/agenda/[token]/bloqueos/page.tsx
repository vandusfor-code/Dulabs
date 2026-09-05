"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Ban, Plus, Pencil, Trash2 } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { Button } from "@/components/spa-panel/ui";
import { formatearFechaCorta, formatearHora } from "@/components/spa-panel/format";
import { BloqueoModal, TIPOS, type BloqueoFila } from "@/components/spa-panel/modals/BloqueoModal";
import type { Profesional } from "@/app/agenda/[token]/profesionales/page";

// Fase 5 (panel administrativo) — administra dulabs_bloqueos, las MISMAS
// filas que lee bloqueosDelDia (motor de disponibilidad, Fase 2) y que ya
// consume el portal público (Fase 4). Crear/editar/eliminar aquí afecta la
// disponibilidad real de inmediato, sin ninguna lógica duplicada.
export default function BloqueosPage() {
  const { token } = useAgenda();
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [bloqueos, setBloqueos] = useState<BloqueoFila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ modo: "crear" } | { modo: "editar"; bloqueo: BloqueoFila } | null>(null);

  const recargar = useCallback(() => {
    fetch(`/api/agenda/${token}/bloqueos`)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else setBloqueos(body.bloqueos);
      })
      .catch(() => setError("No se pudieron cargar los bloqueos"));
  }, [token]);

  useEffect(() => {
    recargar();
    fetch(`/api/agenda/${token}/especialistas`)
      .then((r) => r.json())
      .then((body) => setProfesionales((body.especialistas ?? []).filter((p: Profesional) => p.activo)))
      .catch(() => {});
  }, [token, recargar]);

  const nombrePorId = new Map(profesionales.map((p) => [p.id, p.nombre]));
  const etiquetaTipo = (tipo: string) => TIPOS.find((t) => t.value === tipo)?.label ?? tipo;

  const eliminar = async (id: number) => {
    if (!confirm("¿Eliminar este bloqueo?")) return;
    const res = await fetch(`/api/agenda/${token}/bloqueos/${id}`, { method: "DELETE" });
    if (res.ok) recargar();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-fg">Bloqueos</h1>
          <p className="text-xs text-mist">Vacaciones, incapacidades y otros momentos sin disponibilidad</p>
        </div>
        <Button onClick={() => setModal({ modo: "crear" })}>
          <Plus className="size-4" /> Nuevo
        </Button>
      </div>

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {!bloqueos ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : bloqueos.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-edge bg-card p-10 text-center">
          <Ban className="size-6 text-mist" />
          <p className="mt-2 text-sm text-mist">No tienes bloqueos próximos.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {bloqueos.map((b) => (
            <div key={b.id} className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">
                  {etiquetaTipo(b.tipo)} · {b.especialista_id ? nombrePorId.get(b.especialista_id) ?? "Profesional" : "Todo el negocio"}
                </p>
                <p className="truncate text-xs text-mist">
                  {formatearFechaCorta(b.inicio)} {formatearHora(b.inicio)} - {formatearFechaCorta(b.fin)} {formatearHora(b.fin)}
                  {b.motivo ? ` · ${b.motivo}` : ""}
                </p>
              </div>
              <button
                onClick={() => setModal({ modo: "editar", bloqueo: b })}
                aria-label="Editar"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-mist transition-colors hover:bg-ink-2 hover:text-fg"
              >
                <Pencil className="size-4" />
              </button>
              <button
                onClick={() => eliminar(b.id)}
                aria-label="Eliminar"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-mist transition-colors hover:bg-danger hover:text-danger-text"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <BloqueoModal
          token={token}
          profesionales={profesionales}
          bloqueo={modal.modo === "editar" ? modal.bloqueo : null}
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
