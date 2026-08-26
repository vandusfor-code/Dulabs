"use client";

import { useState } from "react";
import { Button, Field, inputClass, Modal } from "../ui";
import type { Cita, MiembroEquipo } from "../types";

export function EditAppointmentModal({
  cita,
  equipo,
  onClose,
  onGuardar,
}: {
  cita: Cita;
  equipo: MiembroEquipo[];
  onClose: () => void;
  onGuardar: (body: {
    nuevo_inicio: string;
    servicio: string;
    duracion_min: number;
    nuevo_especialista_id?: number;
  }) => Promise<unknown>;
}) {
  const actual = new Date(cita.inicio);
  const duracionActual = Math.round((new Date(cita.fin).getTime() - actual.getTime()) / 60000);
  const [servicio, setServicio] = useState(cita.servicio);
  const [fecha, setFecha] = useState(() => actual.toISOString().slice(0, 10));
  const [hora, setHora] = useState(() => actual.toTimeString().slice(0, 5));
  const [duracion, setDuracion] = useState(String(duracionActual));
  const [profesionalId, setProfesionalId] = useState(String(cita.especialista_id));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    if (!hora || !servicio.trim()) {
      setError("Falta la hora o el servicio.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const nuevoInicio = new Date(`${fecha}T${hora}:00`);
      const nuevoId = Number(profesionalId);
      await onGuardar({
        nuevo_inicio: nuevoInicio.toISOString(),
        servicio: servicio.trim(),
        duracion_min: Number(duracion) || duracionActual,
        nuevo_especialista_id: nuevoId !== cita.especialista_id ? nuevoId : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error editando la cita");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 className="text-base font-semibold text-fg">Editar cita</h2>
      <p className="mt-0.5 text-xs text-mist">
        {cita.nombre_cliente}. Le avisamos por WhatsApp del cambio, no necesita confirmar de nuevo.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <Field label="Cliente">
          <input value={cita.nombre_cliente} disabled className={`${inputClass} opacity-60`} />
        </Field>
        <Field label="Servicio">
          <input value={servicio} onChange={(e) => setServicio(e.target.value)} className={inputClass} />
        </Field>
        {equipo.length > 1 && (
          <Field label="Profesional">
            <select value={profesionalId} onChange={(e) => setProfesionalId(e.target.value)} className={inputClass}>
              {equipo.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="flex gap-3">
          <Field label="Fecha">
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Hora">
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <Field label="Duración (minutos)">
          <input
            type="number"
            min={5}
            step={5}
            value={duracion}
            onChange={(e) => setDuracion(e.target.value)}
            className={inputClass}
          />
        </Field>

        {error && <p className="text-xs text-danger-text">{error}</p>}
      </div>

      <div className="mt-4 flex gap-2.5">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          Cancelar
        </Button>
        <Button onClick={guardar} loading={guardando} className="flex-1">
          Guardar cambios
        </Button>
      </div>
    </Modal>
  );
}
