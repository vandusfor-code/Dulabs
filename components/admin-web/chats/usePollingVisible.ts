"use client";

import { useEffect } from "react";
import { intervaloEfectivo } from "@/lib/chats/polling";

/**
 * Ejecuta `cargar` de inmediato y luego de forma periódica, PERO solo mientras la pestaña está visible y a ritmo lento si nadie la
 * usa (ver lib/chats/polling.ts: el polling ininterrumpido agotaba el egress de Supabase). Al volver a ver la pestaña o al retomar
 * la actividad se refresca de inmediato, así que para quien la usa el "tiempo real" es el mismo de antes.
 */
export function usePollingVisible(cargar: () => void, baseMs: number, activo = true): void {
  useEffect(() => {
    if (!activo) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ultimaInteraccion = Date.now();
    let cancelado = false;

    const programar = () => {
      if (timer) clearTimeout(timer);
      if (cancelado) return;
      const ms = intervaloEfectivo(baseMs, {
        visible: document.visibilityState === "visible",
        ahora: Date.now(),
        ultimaInteraccion,
      });
      if (ms === null) return; // pestaña oculta: se reanuda con visibilitychange
      timer = setTimeout(() => {
        cargar();
        programar();
      }, ms);
    };

    const alInteractuar = () => {
      const estabaInactivo = Date.now() - ultimaInteraccion > 30_000;
      ultimaInteraccion = Date.now();
      // Tras un rato sin usarla, la próxima consulta estaba programada lejos: se adelanta.
      if (estabaInactivo && document.visibilityState === "visible") {
        cargar();
        programar();
      }
    };
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "visible") {
        ultimaInteraccion = Date.now();
        cargar();
      }
      programar();
    };

    cargar();
    programar();
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    window.addEventListener("pointerdown", alInteractuar, { passive: true });
    window.addEventListener("keydown", alInteractuar, { passive: true });
    return () => {
      cancelado = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      window.removeEventListener("pointerdown", alInteractuar);
      window.removeEventListener("keydown", alInteractuar);
    };
  }, [cargar, baseMs, activo]);
}
