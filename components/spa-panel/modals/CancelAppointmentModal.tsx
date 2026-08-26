"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Modal } from "../ui";
import type { Cita } from "../types";

export function CancelAppointmentModal({
  cita,
  modo = "cancelar",
  onClose,
  onConfirmar,
}: {
  cita: Cita;
  modo?: "cancelar" | "rechazar";
  onClose: () => void;
  onConfirmar: () => Promise<unknown>;
}) {
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmar = async () => {
    setProcesando(true);
    setError(null);
    try {
      await onConfirmar();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la cita");
    } finally {
      setProcesando(false);
    }
  };

  const titulo = modo === "cancelar" ? "¿Cancelar esta cita?" : "¿Rechazar esta cita?";
  const detalle =
    modo === "cancelar"
      ? "Esta acción cambiará el estado de la cita a cancelada. Se le avisará a la clienta por WhatsApp."
      : "Esta acción cambiará el estado de la cita a rechazada. Se le avisará a la clienta por WhatsApp.";

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col items-center py-2 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-danger text-danger-text">
          <AlertTriangle className="size-6" />
        </div>
        <h2 className="mt-3 text-base font-semibold text-fg">{titulo}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-mist">{detalle}</p>
        <p className="mt-3 text-sm font-medium text-fg">
          {cita.nombre_cliente} · {cita.servicio}
        </p>

        {error && <p className="mt-3 text-xs text-danger-text">{error}</p>}

        <div className="mt-5 flex w-full gap-2.5">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            Volver
          </Button>
          <Button variant="danger" onClick={confirmar} loading={procesando} className="flex-1">
            Sí, {modo} cita
          </Button>
        </div>
      </div>
    </Modal>
  );
}
