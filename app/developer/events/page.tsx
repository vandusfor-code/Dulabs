"use client";

import { useEffect, useState } from "react";
import { useDeveloper } from "@/lib/dev-dashboard/developer-session";
import { puedeGestionarRecursos } from "@/lib/dev-dashboard/dev-permissions";
import { mensajeDeError } from "@/lib/dev-dashboard/dev-errors";
import { PageHeader } from "@/components/developer/PageHeader";
import { StatCard } from "@/components/developer/StatCard";
import { StatusBadge } from "@/components/developer/StatusBadge";
import { DataTable } from "@/components/developer/DataTable";
import { EmptyState } from "@/components/developer/EmptyState";
import { ErrorState } from "@/components/developer/ErrorState";
import { TableSkeleton } from "@/components/developer/Skeleton";
import { Modal } from "@/components/developer/Modal";
import { formatearFecha } from "@/lib/dev-dashboard/dev-format";
import type { DevEvent, EventMetrics } from "@/lib/dev-dashboard/dev-client";

// DuLabs Developer V1 -- Fase 13 (autorizado). Events & Logs: historial de
// eventos del workspace + observabilidad de entrega (estado/intentos/último
// error/DLQ), métricas y re-entrega manual (OWNER/ADMIN). Proyección segura
// (payload redactado; nunca secretos). No reimplementa el pipeline.

const TIPOS = ["", "received", "queued", "sending", "sent", "delivered", "read", "failed"];
const ESTADOS = ["", "pendiente", "entregando", "entregado", "fallido", "dlq", "sin_webhook"];

function tonoEntrega(estado: string): "success" | "danger" | "warning" | "info" | "neutral" {
  if (estado === "entregado") return "success";
  if (estado === "dlq") return "danger";
  if (estado === "fallido") return "warning";
  if (estado === "pendiente" || estado === "entregando") return "info";
  return "neutral";
}

export default function EventsPage() {
  const { client, rol, selectedWorkspaceId } = useDeveloper();
  const puedeGestionar = puedeGestionarRecursos(rol);

  const [tipo, setTipo] = useState("");
  const [estado, setEstado] = useState("");
  const [events, setEvents] = useState<DevEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<EventMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
  const [detalle, setDetalle] = useState<DevEvent | null>(null);
  const [replayId, setReplayId] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let vivo = true;
    // Estado escrito SOLO dentro de callbacks de promesa (regla React 19, igual
    // que useDevResource), nunca sincrónicamente en el cuerpo del efecto.
    Promise.resolve()
      .then(() => {
        if (!vivo) return null;
        if (!selectedWorkspaceId) {
          setLoading(false);
          return null;
        }
        setLoading(true);
        setAviso(null);
        return Promise.all([
          client.events.list({ tipo: tipo || undefined, entregaEstado: estado || undefined, limit: 25 }),
          client.events.metrics({}),
        ]);
      })
      .then(
        (r) => {
          if (!vivo || !r) return;
          setEvents(r[0].events);
          setCursor(r[0].nextCursor);
          setMetrics(r[1]);
          setError(null);
          setLoading(false);
        },
        (err) => {
          if (!vivo) return;
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      );
    return () => {
      vivo = false;
    };
  }, [client, selectedWorkspaceId, tipo, estado, nonce]);

  function cargarMas() {
    if (!cursor || cargandoMas) return;
    setCargandoMas(true);
    client.events
      .list({ tipo: tipo || undefined, entregaEstado: estado || undefined, cursor, limit: 25 })
      .then((lista) => {
        setEvents((prev) => [...prev, ...lista.events]);
        setCursor(lista.nextCursor);
      })
      .catch((err) => setAviso({ tono: "error", texto: mensajeDeError(err) }))
      .finally(() => setCargandoMas(false));
  }

  function reintentar(ev: DevEvent) {
    if (replayId) return;
    setReplayId(ev.id);
    setAviso(null);
    client.events
      .replay(String(ev.id))
      .then(() => {
        setAviso({ tono: "ok", texto: `Evento ${ev.eventId} re-encolado para nueva entrega.` });
        setEvents((prev) => prev.map((e) => (e.id === ev.id ? { ...e, delivery: { ...e.delivery, estado: "pendiente", replayable: false } } : e)));
      })
      .catch((err) => setAviso({ tono: "error", texto: mensajeDeError(err) }))
      .finally(() => setReplayId(null));
  }

  return (
    <>
      <PageHeader title="Events & Logs" description="Eventos entrantes y estado de entrega a tu webhook. Payloads redactados por seguridad. Reintenta entregas en DLQ o fallidas." />

      {metrics ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Eventos (total)" value={String(metrics.total)} />
          <StatCard label="Entregados" value={String(metrics.porEstadoEntrega.entregado ?? 0)} />
          <StatCard label="Fallidos / DLQ" value={`${metrics.porEstadoEntrega.fallido ?? 0} / ${metrics.porEstadoEntrega.dlq ?? 0}`} />
          <StatCard label="Tasa de entrega" value={metrics.deliveryRate === null ? "—" : `${Math.round(metrics.deliveryRate * 100)}%`} />
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded-md border border-edge bg-ink px-3 py-1.5 text-sm text-fg outline-none focus:border-dev-accent">
          {TIPOS.map((t) => <option key={t} value={t}>{t === "" ? "Todos los tipos" : t}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className="rounded-md border border-edge bg-ink px-3 py-1.5 text-sm text-fg outline-none focus:border-dev-accent">
          {ESTADOS.map((s) => <option key={s} value={s}>{s === "" ? "Toda entrega" : s}</option>)}
        </select>
      </div>

      {aviso ? <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${aviso.tono === "ok" ? "border-success-text/30 bg-success text-success-text" : "border-danger-text/30 bg-danger text-danger-text"}`}>{aviso.texto}</div> : null}

      {loading ? (
        <TableSkeleton cols={5} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => setNonce((n) => n + 1)} />
      ) : !selectedWorkspaceId ? (
        <EmptyState title="Selecciona un workspace" />
      ) : (
        <>
          <DataTable<DevEvent>
            rows={events}
            rowKey={(e) => String(e.id)}
            empty={<EmptyState title="Sin eventos" description="Cuando lleguen mensajes o cambios de estado desde Meta, aparecerán aquí." />}
            columns={[
              { key: "tipo", header: "Tipo", render: (e) => <span className="font-mono text-xs text-fg">{e.tipo}</span> },
              { key: "created", header: "Fecha", render: (e) => <span className="text-xs text-mist">{formatearFecha(e.createdAt)}</span> },
              { key: "delivery", header: "Entrega", render: (e) => <StatusBadge tono={tonoEntrega(e.delivery.estado)}>{e.delivery.estado}</StatusBadge> },
              { key: "intentos", header: "Intentos", render: (e) => <span className="text-xs text-mist">{e.delivery.intentos}</span> },
              { key: "error", header: "Último error", render: (e) => <span className="max-w-[220px] truncate text-xs text-mist" title={e.delivery.ultimoError ?? ""}>{e.delivery.ultimoError ?? "—"}</span> },
              {
                key: "acciones",
                header: "",
                align: "right" as const,
                render: (e) => (
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setDetalle(e)} className="rounded-md border border-edge px-2.5 py-1 text-xs text-fg hover:bg-white/5">Ver</button>
                    {puedeGestionar && e.delivery.replayable ? (
                      <button onClick={() => reintentar(e)} disabled={replayId !== null} className="rounded-md bg-dev-accent px-2.5 py-1 text-xs font-medium text-dev-accent-fg hover:bg-dev-accent-hover disabled:opacity-50">
                        {replayId === e.id ? "…" : "Reintentar"}
                      </button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
          {cursor ? (
            <div className="mt-4 flex justify-center">
              <button onClick={cargarMas} disabled={cargandoMas} className="rounded-md border border-edge px-4 py-1.5 text-sm text-fg hover:bg-white/5 disabled:opacity-50">{cargandoMas ? "Cargando…" : "Cargar más"}</button>
            </div>
          ) : null}
        </>
      )}

      <Modal open={detalle !== null} onClose={() => setDetalle(null)} title={detalle ? `Evento ${detalle.eventId}` : ""}>
        {detalle ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs text-mist">
              <span>Tipo: <span className="text-fg">{detalle.tipo}</span></span>
              <span>Entrega: <span className="text-fg">{detalle.delivery.estado}</span></span>
              <span>Intentos: <span className="text-fg">{detalle.delivery.intentos}</span></span>
              <span>Próximo intento: <span className="text-fg">{detalle.delivery.nextAttemptAt ? formatearFecha(detalle.delivery.nextAttemptAt) : "—"}</span></span>
              {detalle.correlationId ? <span className="col-span-2">correlation_id: <span className="font-mono text-fg">{detalle.correlationId}</span></span> : null}
              {detalle.delivery.ultimoError ? <span className="col-span-2 text-danger-text">Error: {detalle.delivery.ultimoError}</span> : null}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-mist">Payload (redactado)</p>
              <pre className="max-h-72 overflow-auto rounded-md border border-edge bg-ink p-3 text-[11px] text-fg">{JSON.stringify(detalle.payload, null, 2)}</pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
