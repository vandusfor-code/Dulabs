"use client";

import { useCallback, useEffect, useState } from "react";
import type { Accion, Datos } from "./types";

// Mismo contrato de API que ya usa el panel actual (app/api/agenda/[token]),
// solo se le cambia la piel -- ver ese archivo para el detalle exacto de
// cada acción.
export function useAgendaData(token: string) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [procesandoId, setProcesandoId] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/agenda/${token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar tu agenda");
      setDatos(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando tu agenda");
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/agenda/${token}`)
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error ?? "No se pudo cargar tu agenda");
        setDatos(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error cargando tu agenda"));
  }, [token]);

  const ejecutarAccion = useCallback(
    // Antes tragaba el error, lo guardaba en un estado global y devolvía
    // false -- los modales (Editar/Reagendar/Cancelar) esperan que esto
    // lance para mostrar el error DENTRO del modal (ej. "ya tiene cita a
    // esta hora") en vez de cerrarse igual con el error perdido en un
    // estado que nadie mostraba post-carga.
    async (
      citaId: number,
      body: {
        accion: Accion;
        motivo?: string;
        nuevo_inicio?: string;
        duracion_min?: number;
        servicio?: string;
        nuevo_especialista_id?: number;
      }
    ) => {
      setProcesandoId(citaId);
      try {
        const res = await fetch(`/api/agenda/${token}/citas/${citaId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "No se pudo actualizar la cita");
        await cargar();
      } finally {
        setProcesandoId(null);
      }
    },
    [token, cargar]
  );

  const crearCita = useCallback(
    async (body: {
      servicioId: string;
      especialistaId: number;
      fecha: string;
      hora: string;
      nombreCliente: string;
      telefonoCliente?: string;
      correoCliente?: string;
      idempotencyKey: string;
    }) => {
      const res = await fetch(`/api/agenda/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear la cita");
      await cargar();
      return data;
    },
    [token, cargar]
  );

  return { datos, error, setError, procesandoId, cargar, ejecutarAccion, crearCita };
}
