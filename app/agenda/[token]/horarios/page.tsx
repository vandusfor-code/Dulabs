"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Clock3, Plus, Pencil, Trash2 } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { Button } from "@/components/spa-panel/ui";
import { HorarioModal, DIAS, type HorarioFila } from "@/components/spa-panel/modals/HorarioModal";
import type { Profesional } from "@/app/agenda/[token]/profesionales/page";

// Fase 5 (panel administrativo) — administra dulabs_horario_especialista,
// las MISMAS filas que lee ventanasLaboralesEspecialista (motor de
// disponibilidad, Fase 2). No hay una segunda fuente de horarios.
export default function HorariosPage() {
  const { token } = useAgenda();
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [especialistaId, setEspecialistaId] = useState<number | null>(null);
  const [horarios, setHorarios] = useState<HorarioFila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ modo: "crear" } | { modo: "editar"; horario: HorarioFila } | null>(null);

  useEffect(() => {
    fetch(`/api/agenda/${token}/especialistas`)
      .then((r) => r.json())
      .then((body) => {
        const activos: Profesional[] = (body.especialistas ?? []).filter((p: Profesional) => p.activo);
        setProfesionales(activos);
        if (activos.length > 0) setEspecialistaId(activos[0].id);
      })
      .catch(() => setError("No se pudieron cargar los profesionales"));
  }, [token]);

  const recargar = useCallback(() => {
    if (!especialistaId) return;
    fetch(`/api/agenda/${token}/horarios?especialistaId=${especialistaId}`)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else setHorarios(body.horarios);
      })
      .catch(() => setError("No se pudieron cargar los horarios"));
  }, [token, especialistaId]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const eliminar = async (id: number) => {
    if (!confirm("¿Eliminar esta ventana de horario?")) return;
    const res = await fetch(`/api/agenda/${token}/horarios/${id}`, { method: "DELETE" });
    if (res.ok) recargar();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-fg">Horarios</h1>
          <p className="text-xs text-mist">Jornada laboral real por profesional</p>
        </div>
        <Button onClick={() => setModal({ modo: "crear" })} disabled={!especialistaId}>
          <Plus className="size-4" /> Nueva ventana
        </Button>
      </div>

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {profesionales.length > 0 && (
        <select
          value={especialistaId ?? ""}
          onChange={(e) => setEspecialistaId(Number(e.target.value))}
          className="w-full rounded-[10px] border border-edge bg-ink px-3.5 py-2.5 text-sm text-fg outline-none focus:border-lime/50 sm:w-64"
        >
          {profesionales.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      )}

      {profesionales.length === 0 ? (
        <p className="text-sm text-mist">Crea primero un profesional activo para poder configurar sus horarios.</p>
      ) : !horarios ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : horarios.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-edge bg-card p-10 text-center">
          <Clock3 className="size-6 text-mist" />
          <p className="mt-2 text-sm text-mist">Sin horario configurado -- se usa el horario general del negocio mientras tanto.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {horarios.map((h) => (
            <div key={h.id} className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{DIAS[h.dia_semana]}</p>
                <p className="text-xs text-mist">
                  {h.hora_inicio.slice(0, 5)} - {h.hora_fin.slice(0, 5)}
                </p>
              </div>
              <button
                onClick={() => setModal({ modo: "editar", horario: h })}
                aria-label="Editar"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-mist transition-colors hover:bg-ink-2 hover:text-fg"
              >
                <Pencil className="size-4" />
              </button>
              <button
                onClick={() => eliminar(h.id)}
                aria-label="Eliminar"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-mist transition-colors hover:bg-danger hover:text-danger-text"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {modal && especialistaId && (
        <HorarioModal
          token={token}
          especialistaId={especialistaId}
          horario={modal.modo === "editar" ? modal.horario : null}
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
