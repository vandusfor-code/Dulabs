"use client";

import { MoreHorizontal, Pencil, CalendarClock, Trash2, Eye, Check, X, Loader2 } from "lucide-react";
import { Dropdown, DropdownItem } from "./ui";
import type { Cita } from "./types";

export function AppointmentMenu({
  cita,
  procesando,
  onConfirmar,
  onRechazar,
  onEditar,
  onReagendar,
  onCancelar,
  onDetalles,
}: {
  cita: Cita;
  procesando: boolean;
  onConfirmar?: () => void;
  onRechazar?: () => void;
  onEditar: () => void;
  onReagendar: () => void;
  onCancelar: () => void;
  onDetalles: () => void;
}) {
  if (procesando) {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-mist" />
      </div>
    );
  }

  return (
    <Dropdown
      trigger={({ toggle }) => (
        <button
          onClick={toggle}
          aria-label="Más acciones"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-mist transition-colors hover:bg-ink-2 hover:text-fg"
        >
          <MoreHorizontal className="size-[18px]" />
        </button>
      )}
    >
      {(close) => (
        <>
          {cita.estado === "pendiente" && onConfirmar && (
            <DropdownItem
              icon={Check}
              onClick={() => {
                close();
                onConfirmar();
              }}
            >
              Confirmar cita
            </DropdownItem>
          )}
          {cita.estado === "confirmada" && (
            <DropdownItem
              icon={Pencil}
              onClick={() => {
                close();
                onEditar();
              }}
            >
              Editar cita
            </DropdownItem>
          )}
          {(cita.estado === "pendiente" || cita.estado === "confirmada") && (
            <DropdownItem
              icon={CalendarClock}
              onClick={() => {
                close();
                onReagendar();
              }}
            >
              Reagendar
            </DropdownItem>
          )}
          {cita.estado === "pendiente" && onRechazar && (
            <DropdownItem
              icon={X}
              danger
              onClick={() => {
                close();
                onRechazar();
              }}
            >
              Rechazar
            </DropdownItem>
          )}
          {cita.estado === "confirmada" && (
            <DropdownItem
              icon={Trash2}
              danger
              onClick={() => {
                close();
                onCancelar();
              }}
            >
              Cancelar cita
            </DropdownItem>
          )}
          <DropdownItem
            icon={Eye}
            onClick={() => {
              close();
              onDetalles();
            }}
          >
            Ver detalles
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}
