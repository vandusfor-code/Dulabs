"use client";

import { useState } from "react";
import { Button, Field, inputClass, Modal } from "../ui";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export type HorarioFila = { id: number; especialista_id: number; dia_semana: number; hora_inicio: string; hora_fin: string; activo: boolean };

export function HorarioModal({
  token,
  especialistaId,
  horario,
  onClose,
  onGuardado,
}: {
  token: string;
  especialistaId: number;
  horario: HorarioFila | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [diaSemana, setDiaSemana] = useState(horario?.dia_semana ?? 1);
  const [horaInicio, setHoraInicio] = useState(horario?.hora_inicio.slice(0, 5) ?? "09:00");
  const [horaFin, setHoraFin] = useState(horario?.hora_fin.slice(0, 5) ?? "18:00");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const url = horario ? `/api/agenda/${token}/horarios/${horario.id}` : `/api/agenda/${token}/horarios`;
      const res = await fetch(url, {
        method: horario ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          especialista_id: especialistaId,
          dia_semana: diaSemana,
          hora_inicio: horaInicio,
          hora_fin: horaFin,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "No se pudo guardar");
      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error guardando");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 className="text-base font-semibold text-fg">{horario ? "Editar ventana" : "Nueva ventana"}</h2>

      <div className="mt-4 flex flex-col gap-3">
        <Field label="Día">
          <select value={diaSemana} onChange={(e) => setDiaSemana(Number(e.target.value))} className={inputClass}>
            {DIAS.map((d, i) => (
              <option key={i} value={i}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex gap-3">
          <Field label="Desde">
            <input type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Hasta">
            <input type="time" value={horaFin} onChange={(e) => setHoraFin(e.target.value)} className={inputClass} />
          </Field>
        </div>
        {error && <p className="text-xs text-danger-text">{error}</p>}
      </div>

      <div className="mt-4 flex gap-2.5">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          Cancelar
        </Button>
        <Button onClick={guardar} loading={guardando} className="flex-1">
          Guardar
        </Button>
      </div>
    </Modal>
  );
}

export { DIAS };
