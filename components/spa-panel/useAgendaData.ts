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
    async (citaId: number, body: { accion: Accion; motivo?: string; nuevo_inicio?: string; duracion_min?: number; servicio?: string }) => {
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
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al actualizar la cita");
        return false;
      } finally {
        setProcesandoId(null);
      }
    },
    [token, cargar]
  );

  const crearCita = useCallback(
    async (body: {
      nombre_cliente: string;
      telefono_cliente?: string;
      servicio: string;
      con_quien?: string;
      inicio: string;
      duracion_min?: number;
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
