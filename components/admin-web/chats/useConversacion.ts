"use client";

import { useCallback, useEffect, useState } from "react";
import type { MensajeChat, EstadoConversacion } from "@/lib/chats/tipos";

export type ConversacionDetalle = {
  id: number;
  telefono: string;
  clienteId: number | null;
  nombreVisible: string;
  estado: EstadoConversacion;
};

// Chats AMORE (autorizado) — hilo de UNA conversación, con el mismo patrón
// de polling corto que la lista (useChats.ts). Ningún envío escribe el
// mensaje localmente: el worker es el único escritor real (ver
// worker/src/chats/persistir-mensaje.ts) -- tras un envío exitoso, esta
// misma función solo vuelve a pedir el hilo real, nunca inserta un eco
// optimista que pudiera quedar desincronizado.
const INTERVALO_HILO_MS = 3000;

type Snapshot = { id: number; conversacion: ConversacionDetalle; mensajes: MensajeChat[] };

export function useConversacion(token: string, conversacionId: number | null) {
  // Se guarda junto al id que la produjo -- así, al cambiar de conversación
  // (o deseleccionar), lo expuesto se calcula como null DURANTE el render
  // (ver `vigente` más abajo) en vez de "limpiarse" con un setState dentro
  // de un efecto (evita mostrar por un instante el hilo de la conversación
  // anterior bajo el id nuevo).
  const [datos, setDatos] = useState<Snapshot | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    if (!token || !conversacionId) return;
    const idPedido = conversacionId;
    fetch(`/api/agenda/${token}/chats/${idPedido}`)
      .then((r) => r.json())
      .then((body) => {
        if (body.conversacion && body.mensajes) setDatos({ id: idPedido, conversacion: body.conversacion, mensajes: body.mensajes });
      })
      .catch(() => {});
  }, [token, conversacionId]);

  useEffect(() => {
    if (!conversacionId) return;
    cargar();
    const id = setInterval(cargar, INTERVALO_HILO_MS);
    return () => clearInterval(id);
  }, [conversacionId, cargar]);

  const vigente = datos && datos.id === conversacionId ? datos : null;

  const enviarTexto = useCallback(
    async (texto: string) => {
      if (!token || !conversacionId) return;
      setEnviando(true);
      setError(null);
      try {
        const res = await fetch(`/api/agenda/${token}/chats/${conversacionId}/mensajes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texto }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "No se pudo enviar el mensaje");
        cargar();
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo enviar el mensaje");
        throw err;
      } finally {
        setEnviando(false);
      }
    },
    [token, conversacionId, cargar]
  );

  const enviarAudio = useCallback(
    async (audioBase64: string, mimeType: string) => {
      if (!token || !conversacionId) return;
      setEnviando(true);
      setError(null);
      try {
        const res = await fetch(`/api/agenda/${token}/chats/${conversacionId}/audio`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioBase64, mimeType }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "No se pudo enviar el audio");
        cargar();
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo enviar el audio");
        throw err;
      } finally {
        setEnviando(false);
      }
    },
    [token, conversacionId, cargar]
  );

  const cambiarEstado = useCallback(
    async (accion: "marcar_leido" | "archivar" | "desarchivar" | "manual" | "reactivar_asistente") => {
      if (!token || !conversacionId) return;
      const res = await fetch(`/api/agenda/${token}/chats/${conversacionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo actualizar la conversación");
      cargar();
    },
    [token, conversacionId, cargar]
  );

  const enviarCatalogo = useCallback(async () => {
    if (!token || !conversacionId) return;
    const res = await fetch(`/api/agenda/${token}/chats/${conversacionId}/catalogo`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "No se pudo enviar el catálogo");
    cargar();
  }, [token, conversacionId, cargar]);

  return {
    conversacion: vigente?.conversacion ?? null,
    mensajes: vigente?.mensajes ?? null,
    enviando,
    error,
    setError,
    enviarTexto,
    enviarAudio,
    cambiarEstado,
    enviarCatalogo,
    recargar: cargar,
  };
}
