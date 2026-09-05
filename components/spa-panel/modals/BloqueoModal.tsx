"use client";

import { useState } from "react";
import { Button, Field, inputClass, Modal } from "../ui";
import type { Profesional } from "@/app/agenda/[token]/profesionales/page";

// Mismos 5 valores exactos del CHECK dulabs_bloqueos_tipo_valido (Fase 1) --
// nunca texto libre, para no depender de que la UI adivine lo que la DB
// acepta.
const TIPOS: { value: string; label: string }[] = [
  { value: "almuerzo", label: "Almuerzo" },
  { value: "vacaciones", label: "Vacaciones" },
  { value: "incapacidad", label: "Incapacidad" },
  { value: "reunion", label: "Reunión" },
  { value: "manual", label: "Otro / manual" },
];

export type BloqueoFila = {
  id: number;
  especialista_id: number | null;
  tipo: string;
  inicio: string;
  fin: string;
  motivo: string | null;
  activo: boolean;
};

function aDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BloqueoModal({
  token,
  profesionales,
  bloqueo,
  onClose,
  onGuardado,
}: {
  token: string;
  profesionales: Profesional[];
  bloqueo: BloqueoFila | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [especialistaId, setEspecialistaId] = useState<string>(bloqueo?.especialista_id != null ? String(bloqueo.especialista_id) : "");
  const [tipo, setTipo] = useState(bloqueo?.tipo ?? "manual");
  const [inicio, setInicio] = useState(bloqueo ? aDatetimeLocal(bloqueo.inicio) : "");
  const [fin, setFin] = useState(bloqueo ? aDatetimeLocal(bloqueo.fin) : "");
  const [motivo, setMotivo] = useState(bloqueo?.motivo ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    if (!inicio || !fin) {
      setError("La fecha/hora de inicio y fin son obligatorias");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const url = bloqueo ? `/api/agenda/${token}/bloqueos/${bloqueo.id}` : `/api/agenda/${token}/bloqueos`;
      const res = await fetch(url, {
        method: bloqueo ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          especialista_id: especialistaId ? Number(especialistaId) : null,
          tipo,
          inicio: new Date(inicio).toISOString(),
          fin: new Date(fin).toISOString(),
          motivo: motivo.trim() || null,
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
      <h2 className="text-base font-semibold text-fg">{bloqueo ? "Editar bloqueo" : "Nuevo bloqueo"}</h2>

      <div className="mt-4 flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-0.5">
        <Field label="Profesional" hint="Déjalo vacío para un bloqueo general del negocio (ej. día cerrado).">
          <select value={especialistaId} onChange={(e) => setEspecialistaId(e.target.value)} className={inputClass}>
            <option value="">Todo el negocio</option>
            {profesionales.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputClass}>
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex gap-3">
          <Field label="Desde">
            <input type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Hasta">
            <input type="datetime-local" value={fin} onChange={(e) => setFin(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <Field label="Motivo (opcional)">
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Vacaciones de fin de año" className={inputClass} />
        </Field>
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

export { TIPOS };
