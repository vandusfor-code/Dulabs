"use client";

import { useState } from "react";
import { Button, Field, inputClass, Modal } from "../ui";
import type { Cita } from "../types";
import { formatearFechaCorta, formatearHora } from "../format";

export function RescheduleModal({
  cita,
  duracionDefecto,
  onClose,
  onProponer,
}: {
  cita: Cita;
  duracionDefecto: number;
  onClose: () => void;
  onProponer: (body: { nuevo_inicio: string; duracion_min: number }) => Promise<unknown>;
}) {
  const actual = new Date(cita.inicio);
  const [fecha, setFecha] = useState(() => actual.toISOString().slice(0, 10));
  const [hora, setHora] = useState(() => actual.toTimeString().slice(0, 5));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proponer = async () => {
    if (!hora) {
      setError("Falta la hora.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const nuevoInicio = new Date(`${fecha}T${hora}:00`);
      await onProponer({ nuevo_inicio: nuevoInicio.toISOString(), duracion_min: duracionDefecto });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error proponiendo el horario");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 className="text-base font-semibold text-fg">Reagendar cita</h2>
      <p className="mt-0.5 text-xs text-mist">
        Le avisamos por WhatsApp del nuevo horario y queda a la espera de que confirme.
      </p>

      <div className="mt-4 rounded-xl border border-edge bg-ink p-3.5 text-sm">
        <p className="font-medium text-fg">{cita.nombre_cliente}</p>
        <p className="mt-0.5 text-xs text-mist">{cita.servicio}</p>
        <p className="mt-2 text-xs text-mist">
          Fecha actual: <span className="text-fg">{formatearFechaCorta(cita.inicio)} · {formatearHora(cita.inicio)}</span>
        </p>
      </div>

      <div className="mt-4 flex gap-3">
        <Field label="Nueva fecha">
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Nueva hora">
          <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={inputClass} />
        </Field>
      </div>

      {error && <p className="mt-3 text-xs text-danger-text">{error}</p>}

      <div className="mt-4 flex gap-2.5">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          Volver
        </Button>
        <Button onClick={proponer} loading={guardando} className="flex-1">
          Confirmar nuevo horario
        </Button>
      </div>
    </Modal>
  );
}
