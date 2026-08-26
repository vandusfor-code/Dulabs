"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button, Field, inputClass, Modal } from "../ui";
import { normalizarTelefono } from "../format";

export function NewAppointmentModal({
  duracionDefecto,
  servicioDefecto,
  fechaInicial,
  onClose,
  onCrear,
}: {
  duracionDefecto: number;
  servicioDefecto: string;
  fechaInicial?: Date;
  onClose: () => void;
  onCrear: (body: {
    nombre_cliente: string;
    telefono_cliente?: string;
    servicio: string;
    con_quien?: string;
    inicio: string;
    duracion_min?: number;
  }) => Promise<unknown>;
}) {
  // Si el link agrupa varias especialidades, "servicioDefecto" es el rótulo
  // genérico ("Todos los servicios"), no un servicio real -- en ese caso el
  // campo arranca vacío.
  const servicioEsGenerico = servicioDefecto === "Todos los servicios";
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [servicio, setServicio] = useState(servicioEsGenerico ? "" : servicioDefecto);
  const [conQuien, setConQuien] = useState("");
  const [fecha, setFecha] = useState(() => (fechaInicial ?? new Date()).toISOString().slice(0, 10));
  const [hora, setHora] = useState("");
  const [duracion, setDuracion] = useState(String(duracionDefecto));
  const [guardando, setGuardando] = useState(false);
  const [creada, setCreada] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    if (!nombre.trim() || !hora || !servicio.trim()) {
      setError("Falta el nombre, el servicio o la hora.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const inicio = new Date(`${fecha}T${hora}:00`);
      await onCrear({
        nombre_cliente: nombre.trim(),
        telefono_cliente: normalizarTelefono(telefono),
        servicio: servicio.trim(),
        con_quien: conQuien.trim() || undefined,
        inicio: inicio.toISOString(),
        duracion_min: Number(duracion) || duracionDefecto,
      });
      setCreada(true);
      setTimeout(onClose, 1100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creando la cita");
    } finally {
      setGuardando(false);
    }
  };

  if (creada) {
    return (
      <Modal onClose={onClose}>
        <div className="flex flex-col items-center py-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-success text-success-text">
            <Check className="size-6" />
          </div>
          <p className="mt-3 text-sm font-medium text-fg">Cita creada correctamente.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-base font-semibold text-fg">Nueva cita</h2>
      <p className="mt-0.5 text-xs text-mist">Queda confirmada directamente en tu agenda.</p>

      <div className="mt-4 flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-0.5">
        <Field label="Cliente">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="María Camila" className={inputClass} />
        </Field>
        <Field label="WhatsApp (opcional)" hint="Si lo agregas, el bot reconoce a la clienta cuando escriba por esta cita.">
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="3001234567"
            inputMode="tel"
            className={inputClass}
          />
        </Field>
        <Field label="Servicio">
          <input
            value={servicio}
            onChange={(e) => setServicio(e.target.value)}
            placeholder="Ej. semipermanente en manos"
            className={inputClass}
          />
        </Field>
        <Field label="Profesional (opcional)" hint="Si no eliges a nadie, se agenda automático con quien esté libre.">
          <input
            value={conQuien}
            onChange={(e) => setConQuien(e.target.value)}
            placeholder="Ej. Daniela, Carla, Kelly"
            className={inputClass}
          />
        </Field>
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
          Crear cita
        </Button>
      </div>
    </Modal>
  );
}
