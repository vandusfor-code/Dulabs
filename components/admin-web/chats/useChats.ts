"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConversacionResumen } from "@/lib/chats/tipos";

export type TabChats = "todos" | "no_leidos" | "clientes" | "archivados";

// Chats AMORE (autorizado) — "tiempo real" real vía polling corto (elegido
// explícitamente sobre SSE/WebSocket por simplicidad y estabilidad, ver
// spec: "lo que sea más simple y estable"). La lista se refresca sola: un
// mensaje nuevo reordena la conversación y actualiza su contador sin que
// Jessica tenga que recargar la página.
const INTERVALO_LISTA_MS = 4000;

export function useChats(token: string) {
  const [tab, setTab] = useState<TabChats>("todos");
  const [q, setQ] = useState("");
  const [conversaciones, setConversaciones] = useState<ConversacionResumen[] | null>(null);
  const [whatsapp, setWhatsapp] = useState<{ conectado: boolean; numero: string | null }>({ conectado: false, numero: null });
  const [seleccionId, setSeleccionId] = useState<number | null>(null);

  const cargar = useCallback(() => {
    if (!token) return;
    const params = new URLSearchParams({ tab });
    if (q.trim()) params.set("q", q.trim());
    fetch(`/api/agenda/${token}/chats?${params.toString()}`)
      .then((r) => r.json())
      .then((body) => {
        if (body.conversaciones) setConversaciones(body.conversaciones);
        if (body.whatsapp) setWhatsapp(body.whatsapp);
      })
      .catch(() => {});
  }, [token, tab, q]);

  useEffect(() => {
    cargar();
    const id = setInterval(cargar, INTERVALO_LISTA_MS);
    return () => clearInterval(id);
  }, [cargar]);

  return { tab, setTab, q, setQ, conversaciones, whatsapp, seleccionId, setSeleccionId, recargarLista: cargar };
}
