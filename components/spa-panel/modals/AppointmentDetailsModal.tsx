"use client";

import { Modal, StatusBadge } from "../ui";
import type { Cita } from "../types";
import { formatearFechaCorta, formatearHora, minutosEntre, formatearDuracion } from "../format";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-edge py-2.5 last:border-b-0">
      <span className="text-xs text-mist">{label}</span>
      <span className="text-sm font-medium text-fg">{value}</span>
    </div>
  );
}

export function AppointmentDetailsModal({
  cita,
  especialista,
  onClose,
}: {
  cita: Cita;
  especialista: string;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose}>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-fg">{cita.nombre_cliente}</h2>
          <p className="mt-0.5 text-xs text-mist">Detalles de la cita</p>
        </div>
        <StatusBadge estado={cita.estado} />
      </div>

      <div className="mt-4">
        {cita.telefono_cliente && <Row label="Teléfono" value={cita.telefono_cliente} />}
        <Row label="Servicio" value={cita.servicio} />
        <Row label="Fecha" value={formatearFechaCorta(cita.inicio)} />
        <Row label="Hora" value={formatearHora(cita.inicio)} />
        <Row label="Duración" value={formatearDuracion(minutosEntre(cita.inicio, cita.fin))} />
        <Row label="Profesional" value={especialista} />
      </div>

      <button
        onClick={onClose}
        className="mt-4 w-full rounded-full border border-edge bg-ink py-2.5 text-sm font-medium text-fg transition-colors hover:bg-ink-2"
      >
        Cerrar
      </button>
    </Modal>
  );
}
