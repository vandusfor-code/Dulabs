"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClienteVinculado, CitaResumenChat } from "@/lib/chats/tipos";

type Snapshot = { id: number; cliente: ClienteVinculado; historial: CitaResumenChat[] };

// Chats AMORE (autorizado) — panel de cliente del chat: vincula por
// coincidencia real de teléfono contra dulabs_clientes_conocidos (Fase 3/4),
// nunca un cliente inventado. "Crear cliente" reutiliza el mismo endpoint
// que ya llama a recordarNombreCliente -- cero modelo de cliente paralelo.
// El snapshot se guarda junto al id que lo produjo (mismo patrón que
// useConversacion.ts) -- así "cargando" y los datos expuestos se derivan
// DURANTE el render en vez de resetearse con un setState síncrono dentro de
// un efecto al cambiar de conversación.
export function useClienteChat(token: string, conversacionId: number | null) {
  const [datos, setDatos] = useState<Snapshot | null>(null);

  const cargar = useCallback(() => {
    if (!token || !conversacionId) return;
    const idPedido = conversacionId;
    fetch(`/api/agenda/${token}/chats/${idPedido}/cliente`)
      .then((r) => r.json())
      .then((body) => setDatos({ id: idPedido, cliente: body.cliente ?? null, historial: body.historial ?? [] }))
      .catch(() => {});
  }, [token, conversacionId]);

  useEffect(() => {
    if (!conversacionId) return;
    cargar();
  }, [conversacionId, cargar]);

  const crearCliente = useCallback(
    async (body: { nombre: string; correo?: string; cumpleDia?: number; cumpleMes?: number }) => {
      if (!token || !conversacionId) return;
      const res = await fetch(`/api/agenda/${token}/chats/${conversacionId}/cliente`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear el cliente");
      await cargar();
      return data.cliente;
    },
    [token, conversacionId, cargar]
  );

  const vigente = datos && datos.id === conversacionId ? datos : null;

  return {
    cliente: vigente?.cliente ?? null,
    historial: vigente?.historial ?? [],
    cargando: !vigente,
    crearCliente,
    recargar: cargar,
  };
}
