"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { MessagesSquare, Search, Send, Tag, Plus } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { formatearTelefono } from "@/lib/format";
import { Pill } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";

type Etiqueta = { id: number; nombre: string; color: string };

type Conversacion = {
  phone_number_id: string;
  telefono_cliente: string;
  nombre_negocio: string;
  ultimo_mensaje: string;
  ultima_direccion: "entrante" | "saliente";
  ultima_fecha: string;
  pausado: boolean;
  asignado_a: { miembro_id: number; nombre: string } | null;
  etiquetas: Etiqueta[];
};

type RespuestaRapida = { id: number; atajo: string; mensaje: string };

type Filtro = "todas" | "mias" | "sin_asignar";

type MensajeHilo = {
  direccion: "entrante" | "saliente";
  contenido: string;
  created_at: string;
};

function horaCorta(fecha: string, t: (es: string, en: string) => string): string {
  return new Date(fecha).toLocaleString(t("es-CO", "en-US"), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MensajesPage() {
  const { session, negocios, rol } = useDashboard();
  const { t } = useI18n();
  const [conversaciones, setConversaciones] = useState<Conversacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [etiquetaFiltro, setEtiquetaFiltro] = useState<number | null>(null);
  const [seleccionadaClave, setSeleccionadaClave] = useState<string | null>(null);
  const [hilo, setHilo] = useState<MensajeHilo[] | null>(null);

  // Se deriva de `conversaciones` en cada render (en vez de guardarse aparte)
  // para que siempre refleje la asignación/pausa/etiquetas más recientes sin
  // necesitar un efecto que la sincronice.
  const seleccionada = conversaciones?.find((c) => `${c.phone_number_id}:${c.telefono_cliente}` === seleccionadaClave) ?? null;

  const cargarConversaciones = useCallback(() => {
    if (!session) return;
    const params = new URLSearchParams({ filtro });
    if (etiquetaFiltro) params.set("etiqueta_id", String(etiquetaFiltro));
    fetch(`/api/dashboard/conversaciones?${params}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setConversaciones(data.conversaciones ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session, filtro, etiquetaFiltro]);

  useEffect(() => {
    cargarConversaciones();
  }, [cargarConversaciones]);

  // Catálogo de etiquetas del tenant — cualquier rol activo lo puede ver.
  const [etiquetasCatalogo, setEtiquetasCatalogo] = useState<Etiqueta[] | null>(null);
  const cargarEtiquetas = useCallback(() => {
    if (!session) return;
    fetch("/api/dashboard/etiquetas", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setEtiquetasCatalogo(data.etiquetas ?? []))
      .catch(() => setEtiquetasCatalogo([]));
  }, [session]);
  useEffect(() => {
    cargarEtiquetas();
  }, [cargarEtiquetas]);

  // Respuestas rápidas — solo admin/agente las usan (lectura no envía mensajes).
  const [respuestasRapidas, setRespuestasRapidas] = useState<RespuestaRapida[]>([]);
  useEffect(() => {
    if (!session || rol === "lectura") return;
    fetch("/api/dashboard/respuestas-rapidas", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setRespuestasRapidas(data.respuestas ?? []))
      .catch(() => setRespuestasRapidas([]));
  }, [session, rol]);

  useEffect(() => {
    if (!session || !seleccionada) return;
    const params = new URLSearchParams({
      telefono_cliente: seleccionada.telefono_cliente,
      phone_number_id: seleccionada.phone_number_id,
    });
    fetch(`/api/dashboard/mensajes?${params}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((res) => res.json())
      .then((data) => setHilo(data.mensajes ?? []))
      .catch(() => setHilo([]));
  }, [session, seleccionada]);

  const [textoRespuesta, setTextoRespuesta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [fueraDeVentana, setFueraDeVentana] = useState(false);

  const enviarMensaje = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!session || !seleccionada) return;
      const texto = textoRespuesta.trim();
      if (!texto) return;
      setEnviando(true);
      setErrorEnvio(null);
      setFueraDeVentana(false);
      try {
        const res = await fetch("/api/dashboard/mensajes", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            phone_number_id: seleccionada.phone_number_id,
            telefono_cliente: seleccionada.telefono_cliente,
            texto,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.fuera_de_ventana) setFueraDeVentana(true);
          throw new Error(data.error ?? t("Error enviando el mensaje", "Error sending the message"));
        }
        setHilo((prev) => [...(prev ?? []), { direccion: "saliente", contenido: texto, created_at: new Date().toISOString() }]);
        setTextoRespuesta("");
        cargarConversaciones();
      } catch (err) {
        setErrorEnvio(err instanceof Error ? err.message : String(err));
      } finally {
        setEnviando(false);
      }
    },
    [session, seleccionada, textoRespuesta, cargarConversaciones, t]
  );

  // Picker de respuestas rápidas: escribir "/" al inicio del compose box
  // filtra por atajo; seleccionar una reemplaza el texto por su mensaje.
  const mostrarPicker = textoRespuesta.startsWith("/");
  const respuestasFiltradas = mostrarPicker
    ? respuestasRapidas.filter((r) => r.atajo.toLowerCase().startsWith(textoRespuesta.slice(1).toLowerCase()))
    : [];

  const insertarRespuestaRapida = (r: RespuestaRapida) => {
    setTextoRespuesta(r.mensaje);
  };

  // Popover de etiquetas de la conversación abierta.
  const [popoverEtiquetasAbierto, setPopoverEtiquetasAbierto] = useState(false);
  const [nuevaEtiquetaNombre, setNuevaEtiquetaNombre] = useState("");
  const [nuevaEtiquetaColor, setNuevaEtiquetaColor] = useState("#c6ff3d");
  const [guardandoEtiqueta, setGuardandoEtiqueta] = useState(false);
  const [errorEtiqueta, setErrorEtiqueta] = useState<string | null>(null);

  const alternarEtiqueta = useCallback(
    async (etiquetaId: number, aplicada: boolean) => {
      if (!session || !seleccionada) return;
      setErrorEtiqueta(null);
      try {
        const res = await fetch("/api/dashboard/conversaciones/etiquetas", {
          method: aplicada ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            phone_number_id: seleccionada.phone_number_id,
            telefono_cliente: seleccionada.telefono_cliente,
            etiqueta_id: etiquetaId,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("No se pudo actualizar la etiqueta.", "Couldn't update the tag."));
        cargarConversaciones();
      } catch (err) {
        setErrorEtiqueta(err instanceof Error ? err.message : String(err));
      }
    },
    [session, seleccionada, cargarConversaciones, t]
  );

  const crearEtiqueta = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!session || !nuevaEtiquetaNombre.trim()) return;
      setGuardandoEtiqueta(true);
      setErrorEtiqueta(null);
      try {
        const res = await fetch("/api/dashboard/etiquetas", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ nombre: nuevaEtiquetaNombre.trim(), color: nuevaEtiquetaColor }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("No se pudo crear la etiqueta.", "Couldn't create the tag."));
        setNuevaEtiquetaNombre("");
        cargarEtiquetas();
      } catch (err) {
        setErrorEtiqueta(err instanceof Error ? err.message : String(err));
      } finally {
        setGuardandoEtiqueta(false);
      }
    },
    [session, nuevaEtiquetaNombre, nuevaEtiquetaColor, cargarEtiquetas, t]
  );

  const conversacionesFiltradas =
    conversaciones?.filter(
      (c) =>
        formatearTelefono(c.telefono_cliente).includes(busqueda) ||
        c.telefono_cliente.includes(busqueda) ||
        c.nombre_negocio.toLowerCase().includes(busqueda.toLowerCase())
    ) ?? [];

  const abiertos = conversaciones?.filter((c) => !c.pausado).length ?? 0;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Lista */}
      <div className="flex w-full shrink-0 flex-col border-r border-edge md:w-80 lg:w-96">
        <div className="border-b border-edge p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-fg">{t("Mensajes", "Messages")}</h1>
            <div className="flex items-center gap-2">
              <Pill tone="success">
                <span className="size-1.5 rounded-full bg-lime" /> {abiertos} {t("activos", "active")}
              </Pill>
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <select
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as Filtro)}
              className="w-full rounded-lg border border-edge bg-card px-3 py-1.5 text-xs text-fg outline-none focus:border-lime/50"
            >
              <option value="todas">{t("Todas", "All")}</option>
              <option value="mias">{t("Mías", "Mine")}</option>
              <option value="sin_asignar">{t("Sin asignar", "Unassigned")}</option>
            </select>
            <select
              value={etiquetaFiltro ?? ""}
              onChange={(e) => setEtiquetaFiltro(e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-lg border border-edge bg-card px-3 py-1.5 text-xs text-fg outline-none focus:border-lime/50"
            >
              <option value="">{t("Todas las etiquetas", "All tags")}</option>
              {(etiquetasCatalogo ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={t("Buscar mensajes…", "Search messages…")}
              className="h-9 w-full rounded-lg border border-edge bg-card pl-9 pr-3 text-sm text-fg outline-none placeholder:text-mist focus:border-lime/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && <p className="p-4 text-xs text-red-400">{error}</p>}
          {!error && conversaciones === null && <p className="p-4 text-xs text-mist">{t("Cargando…", "Loading…")}</p>}
          {conversaciones !== null && conversacionesFiltradas.length === 0 && (
            <p className="p-4 text-xs leading-relaxed text-mist">{t("Todavía no tienes chats.", "You don't have any chats yet.")}</p>
          )}
          {conversacionesFiltradas.map((c) => (
            <button
              key={`${c.phone_number_id}:${c.telefono_cliente}`}
              onClick={() => {
                setSeleccionadaClave(`${c.phone_number_id}:${c.telefono_cliente}`);
                setHilo(null);
              }}
              className={`flex w-full gap-3 border-b border-edge/60 px-4 py-3.5 text-left transition-colors ${
                seleccionada?.telefono_cliente === c.telefono_cliente &&
                seleccionada?.phone_number_id === c.phone_number_id
                  ? "bg-ink"
                  : "hover:bg-ink/60"
              }`}
            >
              <div className="relative">
                <div className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-ink to-card text-xs font-semibold text-fg">
                  {c.telefono_cliente.slice(-2)}
                </div>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-ink-2 ${
                    c.pausado ? "bg-mist/50" : "bg-lime"
                  }`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-fg">
                    {formatearTelefono(c.telefono_cliente)}
                  </span>
                  <span className="shrink-0 text-[11px] text-mist">{horaCorta(c.ultima_fecha, t)}</span>
                </div>
                <p className="mt-0.5 truncate text-sm text-mist">{c.ultimo_mensaje}</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <p className="truncate font-mono text-[10px] uppercase tracking-widest text-mist/70">
                    {c.nombre_negocio}
                  </p>
                  <span className="size-0.5 shrink-0 rounded-full bg-mist/40" />
                  <span className="truncate text-[10px] text-mist/70">
                    {c.asignado_a?.nombre ?? t("Sin asignar", "Unassigned")}
                  </span>
                </div>
                {c.etiquetas.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {c.etiquetas.map((et) => (
                      <span key={et.id} className="flex items-center gap-1">
                        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: et.color }} />
                        <span className="truncate text-[10px] text-mist/70">{et.nombre}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Hilo */}
      <div className="hidden min-w-0 flex-1 flex-col md:flex">
        {!seleccionada ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <MessagesSquare className="size-12 text-mist/40" strokeWidth={1.2} />
            {conversaciones !== null && conversaciones.length === 0 ? (
              (negocios?.length ?? 0) === 0 ? (
                <>
                  <p className="text-sm font-semibold text-fg">{t("Conecta tu número de WhatsApp", "Connect your WhatsApp number")}</p>
                  <p className="max-w-xs text-xs leading-relaxed text-mist">
                    {t("Necesitas un número conectado para empezar a recibir y responder mensajes aquí.", "You need a connected number to start receiving and replying to messages here.")}
                  </p>
                  <Link
                    href="/dashboard/conexion"
                    className="mt-2 rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg transition-colors duration-200 hover:bg-lime-hover"
                  >
                    {t("Conectar número →", "Connect a number →")}
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-fg">{t("Todavía no hablaste con nadie", "You haven't talked to anyone yet")}</p>
                  <p className="max-w-xs text-xs leading-relaxed text-mist">
                    {t("Los chats van a aparecer aquí en cuanto tus clientes te escriban por WhatsApp.", "Chats will show up here as soon as your customers message you on WhatsApp.")}
                  </p>
                </>
              )
            ) : (
              <p className="text-sm text-mist">{t("Selecciona una conversación para ver el historial.", "Select a conversation to see the history.")}</p>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-edge px-5 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-fg">
                    {formatearTelefono(seleccionada.telefono_cliente)}
                  </span>
                  <Pill tone={seleccionada.pausado ? "neutral" : "success"}>
                    {seleccionada.pausado ? t("Pausado", "Paused") : t("IA activa", "AI active")}
                  </Pill>
                  {seleccionada.etiquetas.map((et) => (
                    <span
                      key={et.id}
                      className="flex items-center gap-1 rounded-full border border-edge px-2 py-0.5 text-[10px] text-mist"
                    >
                      <span className="size-1.5 rounded-full" style={{ backgroundColor: et.color }} />
                      {et.nombre}
                    </span>
                  ))}
                </div>
                <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-widest text-mist">
                  {seleccionada.nombre_negocio}
                </p>
              </div>
              {rol !== "lectura" && (
                <div className="relative shrink-0">
                  <button
                    onClick={() => setPopoverEtiquetasAbierto((v) => !v)}
                    className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs text-fg transition-colors hover:bg-ink"
                  >
                    <Tag className="size-3.5" />
                    {t("Etiquetas", "Tags")}
                  </button>
                  {popoverEtiquetasAbierto && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setPopoverEtiquetasAbierto(false)} />
                      <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-edge bg-card p-3 shadow-lg">
                        {(etiquetasCatalogo ?? []).length === 0 ? (
                          <p className="text-xs text-mist">{t("Todavía no hay etiquetas.", "No tags yet.")}</p>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            {(etiquetasCatalogo ?? []).map((et) => {
                              const aplicada = seleccionada.etiquetas.some((se) => se.id === et.id);
                              return (
                                <label key={et.id} className="flex cursor-pointer items-center gap-2 text-xs text-fg">
                                  <input
                                    type="checkbox"
                                    checked={aplicada}
                                    onChange={() => alternarEtiqueta(et.id, aplicada)}
                                    className="size-3.5 accent-lime"
                                  />
                                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: et.color }} />
                                  {et.nombre}
                                </label>
                              );
                            })}
                          </div>
                        )}
                        <form onSubmit={crearEtiqueta} className="mt-3 flex items-center gap-1.5 border-t border-edge pt-3">
                          <input
                            type="color"
                            value={nuevaEtiquetaColor}
                            onChange={(e) => setNuevaEtiquetaColor(e.target.value)}
                            className="size-7 shrink-0 cursor-pointer rounded border border-edge bg-transparent"
                          />
                          <input
                            type="text"
                            value={nuevaEtiquetaNombre}
                            onChange={(e) => setNuevaEtiquetaNombre(e.target.value)}
                            placeholder={t("Nueva etiqueta", "New tag")}
                            className="min-w-0 flex-1 rounded-lg border border-edge bg-ink px-2 py-1.5 text-xs text-fg outline-none focus:border-lime/50"
                          />
                          <button
                            type="submit"
                            disabled={guardandoEtiqueta || !nuevaEtiquetaNombre.trim()}
                            className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-lime text-lime-fg disabled:opacity-50"
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </form>
                        {errorEtiqueta && <p className="mt-2 text-[11px] text-red-400">{errorEtiqueta}</p>}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto bg-ink/40 p-5">
              {hilo === null && <p className="text-xs text-mist">{t("Cargando…", "Loading…")}</p>}
              {hilo?.map((m, i) => (
                <div key={i} className={`flex ${m.direccion === "saliente" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      m.direccion === "saliente"
                        ? "rounded-br-sm bg-lime text-lime-fg"
                        : "rounded-bl-sm border border-edge bg-card text-fg"
                    }`}
                  >
                    <p>{m.contenido}</p>
                    <p
                      className={`mt-1 text-[10px] ${
                        m.direccion === "saliente" ? "text-lime-fg/70" : "text-mist"
                      }`}
                    >
                      {horaCorta(m.created_at, t)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-edge p-4">
              {rol === "lectura" ? (
                <textarea
                  disabled
                  placeholder={t(
                    "No tienes permiso para responder (rol de solo lectura).",
                    "You don't have permission to reply (read-only role)."
                  )}
                  className="h-11 w-full resize-none rounded-lg border border-edge bg-ink px-3 py-2.5 text-sm text-mist placeholder:text-mist/70"
                />
              ) : (
                <form onSubmit={enviarMensaje} className="flex items-end gap-2">
                  <div className="relative flex-1">
                    {mostrarPicker && respuestasFiltradas.length > 0 && (
                      <div className="absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-lg border border-edge bg-card shadow-lg">
                        {respuestasFiltradas.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => insertarRespuestaRapida(r)}
                            className="flex w-full flex-col items-start gap-0.5 border-b border-edge/60 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-ink"
                          >
                            <span className="text-xs font-medium text-lime-text">/{r.atajo}</span>
                            <span className="truncate text-xs text-mist">{r.mensaje}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <textarea
                      value={textoRespuesta}
                      onChange={(e) => setTextoRespuesta(e.target.value)}
                      placeholder={t('Escribe una respuesta… (usa "/" para respuestas rápidas)', 'Type a reply… (use "/" for quick replies)')}
                      className="h-11 w-full resize-none rounded-lg border border-edge bg-card px-3 py-2.5 text-sm text-fg outline-none placeholder:text-mist focus:border-lime/50"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={enviando || !textoRespuesta.trim()}
                    className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-lime px-4 text-xs font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send className="size-3.5" />
                    {t("Enviar", "Send")}
                  </button>
                </form>
              )}
              {errorEnvio && (
                <p className="mt-2 text-xs text-red-400">
                  {errorEnvio}
                  {fueraDeVentana && (
                    <>
                      {" "}
                      <Link href="/dashboard/plantillas" className="underline hover:text-red-300">
                        {t("Ir a Plantillas →", "Go to Templates →")}
                      </Link>
                    </>
                  )}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Panel cliente */}
      <div className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-edge xl:flex">
        {!seleccionada ? (
          <p className="p-5 text-xs text-mist">{t("Sin conversación seleccionada.", "No conversation selected.")}</p>
        ) : (
          <>
            <div className="flex flex-col items-center border-b border-edge p-6 text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-lime/30 to-card text-lg font-semibold text-fg">
                {seleccionada.telefono_cliente.slice(-2)}
              </div>
              <p className="mt-3 font-semibold text-fg">{formatearTelefono(seleccionada.telefono_cliente)}</p>
              <p className="mt-1 font-mono text-[10.5px] uppercase tracking-widest text-mist">
                {seleccionada.nombre_negocio}
              </p>
            </div>
            <div className="p-5">
              <p className="mb-3 font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Estado", "Status")}</p>
              <div className="flex items-center gap-2.5 rounded-lg border border-edge bg-card px-3 py-2.5">
                <span className={`size-2 rounded-full ${seleccionada.pausado ? "bg-mist/50" : "bg-lime"}`} />
                <span className="text-sm text-fg">
                  {seleccionada.pausado ? t("Humano interviniendo", "Human taking over") : t("IA respondiendo", "AI replying")}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
