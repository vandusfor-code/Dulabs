"use client";

import { useState } from "react";
import { Button, Field, inputClass, Modal } from "../ui";
import type { Servicio } from "@/app/agenda/[token]/servicios/page";
import type { Profesional } from "@/app/agenda/[token]/profesionales/page";

export function ServicioModal({
  token,
  servicio,
  profesionales,
  onClose,
  onGuardado,
}: {
  token: string;
  servicio: Servicio | null;
  profesionales: Profesional[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(servicio?.nombre ?? "");
  const [categoria, setCategoria] = useState(servicio?.categoria ?? "");
  const [descripcion, setDescripcion] = useState(servicio?.descripcion ?? "");
  const [duracion, setDuracion] = useState(String(servicio?.duracion_min ?? 60));
  const [precio, setPrecio] = useState(servicio?.precio != null ? String(servicio.precio) : "");
  const [activo, setActivo] = useState(servicio?.activo ?? true);
  const [especialistaIds, setEspecialistaIds] = useState<number[]>(servicio?.especialistaIds ?? []);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alternar = (id: number) => {
    setEspecialistaIds((actual) => (actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id]));
  };

  const guardar = async () => {
    const duracionNum = Number(duracion);
    if (!nombre.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    if (!Number.isInteger(duracionNum) || duracionNum <= 0) {
      setError("La duración debe ser un número entero mayor a 0");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const url = servicio ? `/api/agenda/${token}/servicios/${servicio.id}` : `/api/agenda/${token}/servicios`;
      const res = await fetch(url, {
        method: servicio ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          categoria: categoria.trim() || null,
          descripcion: descripcion.trim() || null,
          duracion_min: duracionNum,
          precio: precio.trim() ? Number(precio) : null,
          activo,
          especialistaIds,
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
      <h2 className="text-base font-semibold text-fg">{servicio ? "Editar servicio" : "Nuevo servicio"}</h2>

      <div className="mt-4 flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-0.5">
        <Field label="Nombre">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Semipermanente en manos" className={inputClass} />
        </Field>
        <Field label="Categoría (opcional)">
          <input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ej. Manos" className={inputClass} />
        </Field>
        <Field label="Descripción (opcional)">
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. Esmaltado de larga duración" className={inputClass} />
        </Field>
        <div className="flex gap-3">
          <Field label="Duración (minutos)">
            <input type="number" min={5} step={5} value={duracion} onChange={(e) => setDuracion(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Precio (opcional)">
            <input type="number" min={0} value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Ej. 45000" className={inputClass} />
          </Field>
        </div>

        <label className="flex items-center gap-2.5 text-sm text-fg">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="size-4 accent-lime" />
          Activo
        </label>

        <Field label="Profesionales que pueden realizarlo">
          {profesionales.length === 0 ? (
            <p className="text-xs text-mist">Todavía no tienes profesionales creados.</p>
          ) : (
            <div className="flex flex-col gap-1.5 rounded-xl border border-edge p-2.5">
              {profesionales.map((p) => (
                <label key={p.id} className="flex items-center gap-2.5 text-sm text-fg">
                  <input
                    type="checkbox"
                    checked={especialistaIds.includes(p.id)}
                    onChange={() => alternar(p.id)}
                    className="size-4 accent-lime"
                  />
                  {p.nombre}
                </label>
              ))}
            </div>
          )}
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
