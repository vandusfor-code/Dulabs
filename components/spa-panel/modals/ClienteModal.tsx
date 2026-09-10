"use client";

import { useState } from "react";
import { Button, Field, inputClass, Modal } from "../ui";

export type ClienteEditable = {
  id: number;
  nombre: string;
  telefono: string;
  correo: string | null;
  cumpleDia: number | null;
  cumpleMes: number | null;
};

/**
 * Editar cliente (autorizado, item 4 del pedido) -- MISMO patrón exacto que
 * ProfesionalModal/ServicioModal (Modal/Field/Button reales, sin rediseño).
 * Persiste de verdad vía PATCH /api/agenda/[token]/clientes/[id] -- el
 * WhatsApp se normaliza server-side (misma identidad real que usa todo el
 * sistema, ver app/api/agenda/[token]/clientes/identidad.ts).
 */
export function ClienteModal({
  token,
  cliente,
  onClose,
  onGuardado,
}: {
  token: string;
  cliente: ClienteEditable;
  onClose: () => void;
  onGuardado: (cliente: ClienteEditable) => void;
}) {
  const [nombre, setNombre] = useState(cliente.nombre);
  const [telefono, setTelefono] = useState(cliente.telefono);
  const [correo, setCorreo] = useState(cliente.correo ?? "");
  const [cumpleDia, setCumpleDia] = useState(cliente.cumpleDia != null ? String(cliente.cumpleDia) : "");
  const [cumpleMes, setCumpleMes] = useState(cliente.cumpleMes != null ? String(cliente.cumpleMes) : "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    if (!nombre.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    if (!telefono.trim()) {
      setError("El WhatsApp es obligatorio");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/agenda/${token}/clientes/${cliente.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          telefono: telefono.trim(),
          correo: correo.trim() || null,
          cumpleDia: cumpleDia.trim() ? Number(cumpleDia) : null,
          cumpleMes: cumpleMes.trim() ? Number(cumpleMes) : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "No se pudo guardar");
      onGuardado(body.cliente);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error guardando");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 className="text-base font-semibold text-fg">Editar cliente</h2>

      <div className="mt-4 flex flex-col gap-3">
        <Field label="Nombre">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="María Camila" className={inputClass} />
        </Field>
        <Field label="WhatsApp" hint="Solo dígitos, con indicativo de país.">
          <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="3001234567" inputMode="tel" className={inputClass} />
        </Field>
        <Field label="Correo (opcional)">
          <input value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="correo@ejemplo.com" inputMode="email" className={inputClass} />
        </Field>
        <div className="flex gap-3">
          <Field label="Día de cumpleaños (opcional)">
            <input type="number" min={1} max={31} value={cumpleDia} onChange={(e) => setCumpleDia(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Mes (opcional)">
            <input type="number" min={1} max={12} value={cumpleMes} onChange={(e) => setCumpleMes(e.target.value)} className={inputClass} />
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
