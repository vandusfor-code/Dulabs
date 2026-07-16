"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bot,
  MessagesSquare,
  Gauge,
  ShieldCheck,
  Sparkles,
  FileUp,
  FileText,
  X,
  Pencil,
  Check,
  Pause,
  Play,
  TrendingUp,
  Clock,
  Send,
  MessageSquareText,
} from "lucide-react";
import { useDashboard, type Negocio } from "@/lib/dashboard-session";
import { formatearTelefono, nombreDelAgente } from "@/lib/format";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";

type MetricasNumero = {
  phone_number_id: string;
  tasaAutomatizacion: number;
  tiempoRespuestaSeg: number | null;
  mensajesAtendidos24h: number;
};

function formatearDuracion(seg: number): string {
  if (seg < 60) return `${Math.round(seg)}s`;
  const min = Math.floor(seg / 60);
  const resto = Math.round(seg % 60);
  return resto > 0 ? `${min}m ${resto}s` : `${min}m`;
}

function BaseConocimiento({
  negocio,
  accessToken,
  onActualizado,
}: {
  negocio: Negocio;
  accessToken: string;
  onActualizado: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const tieneArchivo = Boolean(negocio.base_conocimiento_nombre_archivo);

  const subirArchivo = useCallback(
    async (archivo: File) => {
      setSubiendo(true);
      setMensaje(null);
      try {
        const form = new FormData();
        form.append("phone_number_id", negocio.phone_number_id);
        form.append("archivo", archivo);
        const res = await fetch("/api/dashboard/base-conocimiento", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error subiendo el archivo");
        setMensaje(
          `Cargado: ${data.caracteres.toLocaleString("es-CO")} caracteres${data.truncado ? " (se recortó por tamaño)" : ""}.`
        );
        onActualizado();
      } catch (err) {
        setMensaje(err instanceof Error ? err.message : String(err));
      } finally {
        setSubiendo(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [accessToken, negocio.phone_number_id, onActualizado]
  );

  const quitarArchivo = useCallback(async () => {
    setSubiendo(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/dashboard/base-conocimiento", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ phone_number_id: negocio.phone_number_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error quitando el archivo");
      onActualizado();
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : String(err));
    } finally {
      setSubiendo(false);
    }
  }, [accessToken, negocio.phone_number_id, onActualizado]);

  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <FileUp className="size-4 text-mist" />
        <h3 className="text-sm font-semibold text-fg">Base de conocimiento</h3>
      </div>
      <p className="text-xs leading-relaxed text-mist">
        Sube tu listado de precios (Excel/CSV) o un documento (PDF, como estatutos o políticas). La IA lo usará como
        referencia además de las instrucciones de arriba.
      </p>

      {tieneArchivo ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-edge bg-ink p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <FileText className="size-4 shrink-0 text-lime-text" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{negocio.base_conocimiento_nombre_archivo}</p>
              <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-widest text-mist">
                {negocio.base_conocimiento_caracteres.toLocaleString("es-CO")} caracteres
              </p>
            </div>
          </div>
          <button
            onClick={quitarArchivo}
            disabled={subiendo}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-mist transition-colors hover:text-red-400 disabled:opacity-50"
            aria-label="Quitar archivo"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-mist">Todavía no has subido ningún archivo.</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.pdf"
        className="hidden"
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          if (archivo) subirArchivo(archivo);
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={subiendo}
        className="mt-3 rounded-lg border border-edge px-4 py-2 text-xs font-semibold text-fg transition-colors hover:border-lime/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {subiendo ? "Procesando…" : tieneArchivo ? "Reemplazar archivo" : "Subir archivo"}
      </button>
      {mensaje && <p className="mt-3 text-xs leading-relaxed text-mist">{mensaje}</p>}
    </div>
  );
}

type MensajePlayground = { rol: "usuario" | "ia"; texto: string };

function Playground({ negocio, accessToken }: { negocio: Negocio; accessToken: string }) {
  const [mensajes, setMensajes] = useState<MensajePlayground[]>([]);
  const [entrada, setEntrada] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = useCallback(async () => {
    const texto = entrada.trim();
    if (!texto || enviando) return;
    setEntrada("");
    setError(null);
    setMensajes((prev) => [...prev, { rol: "usuario", texto }]);
    setEnviando(true);
    try {
      const res = await fetch("/api/dashboard/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ phone_number_id: negocio.phone_number_id, mensaje: texto }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error consultando a la IA");
      setMensajes((prev) => [...prev, { rol: "ia", texto: data.respuesta }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }, [entrada, enviando, negocio.phone_number_id, accessToken]);

  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <MessageSquareText className="size-4 text-mist" />
        <h3 className="text-sm font-semibold text-fg">Probar en playground</h3>
      </div>
      <p className="text-xs leading-relaxed text-mist">
        Chatea con {nombreDelAgente(negocio)} usando sus instrucciones y base de conocimiento reales — nada de esto
        se envía por WhatsApp ni cuenta contra tu consumo.
      </p>

      <div className="mt-3 max-h-72 space-y-2.5 overflow-y-auto rounded-lg border border-edge bg-ink p-3">
        {mensajes.length === 0 ? (
          <p className="text-xs text-mist">Escribe algo como lo haría un cliente…</p>
        ) : (
          mensajes.map((m, i) => (
            <div key={i} className={`flex ${m.rol === "usuario" ? "justify-end" : "justify-start"}`}>
              <p
                className={`max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm ${
                  m.rol === "usuario" ? "bg-lime/15 text-fg" : "bg-card text-fg"
                }`}
              >
                {m.texto}
              </p>
            </div>
          ))
        )}
        {enviando && <p className="text-xs text-mist">{nombreDelAgente(negocio)} está escribiendo…</p>}
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <input
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") enviar();
          }}
          placeholder="Escribe un mensaje de prueba…"
          className="w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-lime/50"
        />
        <button
          onClick={enviar}
          disabled={enviando || !entrada.trim()}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-lime text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Enviar"
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
}

function AgentDetail({
  negocio,
  accessToken,
  onActualizado,
  metricas,
}: {
  negocio: Negocio;
  accessToken: string;
  onActualizado: () => void;
  metricas: MetricasNumero | null;
}) {
  const [prompt, setPrompt] = useState(negocio.prompt_sistema ?? "");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const entrenada = (negocio.prompt_sistema ?? "").trim().length > 0;

  const [editandoNombre, setEditandoNombre] = useState(false);
  const [nombreAgenteInput, setNombreAgenteInput] = useState(nombreDelAgente(negocio));
  const [guardandoNombre, setGuardandoNombre] = useState(false);

  const guardarNombreAgente = useCallback(async () => {
    const valor = nombreAgenteInput.trim();
    if (!valor || valor === nombreDelAgente(negocio)) {
      setEditandoNombre(false);
      setNombreAgenteInput(nombreDelAgente(negocio));
      return;
    }
    setGuardandoNombre(true);
    try {
      const res = await fetch("/api/dashboard/negocio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ phone_number_id: negocio.phone_number_id, nombre_agente: valor }),
      });
      if (!res.ok) throw new Error();
      setEditandoNombre(false);
      onActualizado();
    } catch {
      setNombreAgenteInput(nombreDelAgente(negocio));
    } finally {
      setGuardandoNombre(false);
    }
  }, [nombreAgenteInput, negocio, accessToken, onActualizado]);

  const guardar = useCallback(async () => {
    setGuardando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/dashboard/prompt", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ phone_number_id: negocio.phone_number_id, prompt_sistema: prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error guardando");
      setMensaje("Guardado. La IA usará estas instrucciones desde el próximo mensaje.");
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }, [accessToken, negocio.phone_number_id, prompt]);

  const usados = negocio.mensajes_usados;
  const limite = negocio.mensajes_limite;

  const [cambiandoPausa, setCambiandoPausa] = useState(false);
  const alternarPausa = useCallback(async () => {
    setCambiandoPausa(true);
    try {
      const res = await fetch("/api/dashboard/negocio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ phone_number_id: negocio.phone_number_id, ia_pausada: !negocio.ia_pausada }),
      });
      if (!res.ok) throw new Error();
      onActualizado();
    } finally {
      setCambiandoPausa(false);
    }
  }, [accessToken, negocio.phone_number_id, negocio.ia_pausada, onActualizado]);

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-xl border border-edge bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`flex size-14 items-center justify-center rounded-2xl ${
                entrenada ? "bg-lime/15 text-lime-text" : "bg-ink text-mist"
              }`}
            >
              <Bot className="size-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-fg">{negocio.nombre_negocio}</h2>
                <Pill tone={entrenada ? "success" : "neutral"}>{entrenada ? "Entrenada" : "Sin entrenar"}</Pill>
              </div>
              <p className="mt-1 text-sm text-mist">{formatearTelefono(negocio.telefono_negocio)} · WhatsApp Cloud API</p>
              {editandoNombre ? (
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={nombreAgenteInput}
                    maxLength={60}
                    onChange={(e) => setNombreAgenteInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") guardarNombreAgente();
                      if (e.key === "Escape") {
                        setEditandoNombre(false);
                        setNombreAgenteInput(nombreDelAgente(negocio));
                      }
                    }}
                    className="w-40 rounded-md border border-edge bg-ink px-2 py-1 text-sm text-fg outline-none focus:border-lime/50"
                  />
                  <button
                    onClick={guardarNombreAgente}
                    disabled={guardandoNombre}
                    className="flex size-6 items-center justify-center rounded-md text-lime-text hover:bg-lime/10 disabled:opacity-50"
                    aria-label="Guardar nombre del agente"
                  >
                    <Check className="size-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setEditandoNombre(false);
                      setNombreAgenteInput(nombreDelAgente(negocio));
                    }}
                    className="flex size-6 items-center justify-center rounded-md text-mist hover:bg-ink"
                    aria-label="Cancelar"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <button onClick={() => setEditandoNombre(true)} className="group mt-2 flex items-center gap-1.5">
                  <span className="text-xs text-mist">
                    Agente: <span className="font-medium text-lime-text">{nombreDelAgente(negocio)}</span>
                  </span>
                  <Pencil className="size-3 text-mist opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {negocio.ia_pausada && <Pill tone="warning">IA pausada</Pill>}
            <button
              onClick={alternarPausa}
              disabled={cambiandoPausa}
              className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                negocio.ia_pausada
                  ? "border-lime/40 text-lime-text hover:bg-lime/10"
                  : "border-edge text-fg hover:border-red-400/40 hover:text-red-400"
              }`}
            >
              {negocio.ia_pausada ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {negocio.ia_pausada ? "Reanudar IA" : "Pausar IA"}
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge bg-edge md:grid-cols-4">
          <Metric
            icon={TrendingUp}
            label="Resolución (24h)"
            value={metricas && metricas.mensajesAtendidos24h > 0 ? `${Math.round(metricas.tasaAutomatizacion * 100)}%` : "—"}
          />
          <Metric icon={MessagesSquare} label="Mensajes este mes" value={usados.toLocaleString("es-CO")} />
          <Metric
            icon={Clock}
            label="Latencia promedio"
            value={metricas?.tiempoRespuestaSeg != null ? formatearDuracion(metricas.tiempoRespuestaSeg) : "—"}
          />
          <Metric
            icon={Gauge}
            label="Límite del plan"
            value={limite === null ? "Ilimitado" : limite.toLocaleString("es-CO")}
          />
        </div>
      </div>

      <div className="rounded-xl border border-edge bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-4 text-mist" />
          <h3 className="text-sm font-semibold text-fg">Instrucciones (precios, horarios, tono)</h3>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={7}
          maxLength={4000}
          placeholder={`Eres el asistente de WhatsApp del negocio "${negocio.nombre_negocio}". Responde de forma breve, amable y útil. Nuestros precios son... Atendemos de... a...`}
          className="w-full rounded-lg border border-edge bg-ink px-4 py-3 text-sm leading-relaxed text-fg outline-none transition-colors duration-200 focus:border-lime/50"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            onClick={guardar}
            disabled={guardando}
            className="btn-shine rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
          <span className="text-xs text-mist">{prompt.length} / 4000</span>
        </div>
        {mensaje && <p className="mt-3 text-xs leading-relaxed text-mist">{mensaje}</p>}
      </div>

      <BaseConocimiento negocio={negocio} accessToken={accessToken} onActualizado={onActualizado} />

      <Playground negocio={negocio} accessToken={accessToken} />

      <div className="rounded-xl border border-edge bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="size-4 text-mist" />
          <h3 className="text-sm font-semibold text-fg">Cómo opera</h3>
        </div>
        <ul className="space-y-2 text-sm">
          {[
            "Responde con la API Oficial de WhatsApp Business de Meta",
            "Se pausa automáticamente si tú respondes desde tu celular",
            negocio.ia_pausada ? "Actualmente pausada manualmente — no responderá hasta que la reanudes" : "Solo usa las instrucciones y la base de conocimiento que le diste, nada más",
          ].map((t) => (
            <li key={t} className="flex items-center gap-2.5 rounded-lg border border-edge bg-ink px-3 py-2.5 text-fg/90">
              <span className="size-1.5 rounded-full bg-lime" />
              {t}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Bot; label: string; value: string }) {
  return (
    <div className="bg-card p-4">
      <div className="flex items-center gap-1.5 text-mist">
        <Icon className="size-3.5" />
        <span className="font-mono text-[10.5px] uppercase tracking-widest">{label}</span>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-fg">{value}</p>
    </div>
  );
}

export default function AgentesPage() {
  const { session, negocios, cargarNegocios } = useDashboard();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [metricasPorNumero, setMetricasPorNumero] = useState<MetricasNumero[] | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch("/api/dashboard/resumen", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setMetricasPorNumero(data.metricasPorNumero ?? []))
      .catch(() => setMetricasPorNumero([]));
  }, [session]);

  const activo = negocios?.find((n) => n.phone_number_id === activeId) ?? negocios?.[0] ?? null;
  const metricasActivo = metricasPorNumero?.find((m) => m.phone_number_id === activo?.phone_number_id) ?? null;

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Operar"
        title="Agentes de IA"
        description="Cada número conectado tiene su propio asistente, entrenado con tus precios, horarios y tono — responde 24/7 sobre la API Oficial de Meta."
      />

      <div className="px-4 pt-6 md:px-8">
        {negocios !== null && negocios.length === 0 && (
          <div className="rounded-xl border border-edge bg-card p-8 text-center">
            <Bot className="mx-auto size-10 text-mist/40" strokeWidth={1.2} />
            <p className="mt-3 text-sm font-semibold text-fg">Todavía no tienes ningún número conectado</p>
            <p className="mt-1 text-xs text-mist">Conecta tu WhatsApp para entrenar tu primer asistente.</p>
            <Link
              href="/dashboard/conexion"
              className="mt-4 inline-block rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg hover:bg-lime-hover"
            >
              Conectar número →
            </Link>
          </div>
        )}

        {negocios && negocios.length > 0 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
            <div className="space-y-3">
              {negocios.map((n) => {
                const entrenada = (n.prompt_sistema ?? "").trim().length > 0;
                const seleccionado = activo?.phone_number_id === n.phone_number_id;
                return (
                  <button
                    key={n.phone_number_id}
                    onClick={() => setActiveId(n.phone_number_id)}
                    className={`w-full rounded-xl border p-4 text-left transition-colors ${
                      seleccionado ? "border-lime/40 bg-card" : "border-edge bg-card hover:border-lime/25"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex size-10 items-center justify-center rounded-xl ${
                          entrenada ? "bg-lime/15 text-lime-text" : "bg-ink text-mist"
                        }`}
                      >
                        <Bot className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-fg">{n.nombre_negocio}</p>
                        <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-widest text-mist">
                          {formatearTelefono(n.telefono_negocio)}
                        </p>
                      </div>
                      <Pill tone={entrenada ? "success" : "neutral"}>{entrenada ? "Entrenada" : "Nueva"}</Pill>
                    </div>
                  </button>
                );
              })}
            </div>

            <div>
              {session && activo && (
                <AgentDetail
                  negocio={activo}
                  accessToken={session.access_token}
                  onActualizado={cargarNegocios}
                  metricas={metricasActivo}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
