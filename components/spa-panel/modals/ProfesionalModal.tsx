"use client";

import { useState } from "react";
import { Button, Field, inputClass, Modal } from "../ui";
import type { Profesional } from "@/app/agenda/[token]/profesionales/page";

export function ProfesionalModal({
  token,
  profesional,
  onClose,
  onGuardado,
}: {
  token: string;
  profesional: Profesional | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(profesional?.nombre ?? "");
  const [numero, setNumero] = useState(profesional?.numero_whatsapp ?? "");
  const [servicio, setServicio] = useState(profesional?.servicio ?? "");
  const [duracion, setDuracion] = useState(String(profesional?.duracion_min ?? 60));
  const [activo, setActivo] = useState(profesional?.activo ?? true);
  const [requiereAprobacion, setRequiereAprobacion] = useState(profesional?.requiere_aprobacion ?? false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    if (!nombre.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const url = profesional ? `/api/agenda/${token}/especialistas/${profesional.id}` : `/api/agenda/${token}/especialistas`;
      const res = await fetch(url, {
        method: profesional ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          numero_whatsapp: numero.trim(),
          servicio: servicio.trim(),
          duracion_min: Number(duracion),
          activo,
          requiere_aprobacion: requiereAprobacion,
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
      <h2 className="text-base font-semibold text-fg">{profesional ? "Editar profesional" : "Nuevo profesional"}</h2>

      <div className="mt-4 flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-0.5">
        <Field label="Nombre">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Carla" className={inputClass} />
        </Field>
        <Field label="WhatsApp" hint="Solo dígitos, con indicativo de país.">
          <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="3001234567" inputMode="tel" className={inputClass} />
        </Field>
        <Field label="Especialidad (texto libre)" hint="Ej. manos, pies, pestañas.">
          <input value={servicio} onChange={(e) => setServicio(e.target.value)} placeholder="Ej. manos" className={inputClass} />
        </Field>
        <Field label="Duración por defecto (minutos)">
          <input type="number" min={5} step={5} value={duracion} onChange={(e) => setDuracion(e.target.value)} className={inputClass} />
        </Field>
        <label className="flex items-center gap-2.5 text-sm text-fg">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="size-4 accent-lime" />
          Activo
        </label>
        <label className="flex items-center gap-2.5 text-sm text-fg">
          <input
            type="checkbox"
            checked={requiereAprobacion}
            onChange={(e) => setRequiereAprobacion(e.target.checked)}
            className="size-4 accent-lime"
          />
          Requiere aprobación manual antes de confirmar sus citas
        </label>

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
