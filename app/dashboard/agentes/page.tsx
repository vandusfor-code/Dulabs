"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bot,
  MessagesSquare,
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
  Plus,
  Trash2,
  ArrowRightLeft,
  Phone,
} from "lucide-react";
import { useDashboard, type Negocio } from "@/lib/dashboard-session";
import { formatearTelefono, nombreDelAgente } from "@/lib/format";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import { PLANES, resolverPlanId } from "@/lib/planes";

type AgentePerfil = {
  id: number;
  nombre: string;
  prompt_sistema: string | null;
  base_conocimiento_nombre_archivo: string | null;
  base_conocimiento_actualizado_at: string | null;
  created_at: string;
};

type MetricasNumero = {
  phone_number_id: string;
  tasaAutomatizacion: number;
  tiempoRespuestaSeg: number | null;
  mensajesAtendidos24h: number;
};

type Objetivo = { tipo: "agente"; id: number } | { tipo: "legado"; phoneNumberId: string };

function formatearDuracion(seg: number): string {
  if (seg < 60) return `${Math.round(seg)}s`;
  const min = Math.floor(seg / 60);
  const resto = Math.round(seg % 60);
  return resto > 0 ? `${min}m ${resto}s` : `${min}m`;
}

// Base de conocimiento reutilizable: apunta a un agente nuevo (agenteId) o,
// en la ruta legada, directo a un número (phoneNumberId).
function BaseConocimiento({
  target,
  nombreArchivo,
  accessToken,
  onActualizado,
}: {
  target: { agenteId: number } | { phoneNumberId: string };
  nombreArchivo: string | null;
  accessToken: string;
  onActualizado: () => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const tieneArchivo = Boolean(nombreArchivo);

  const subirArchivo = useCallback(
    async (archivo: File) => {
      setSubiendo(true);
      setMensaje(null);
      try {
        const form = new FormData();
        if ("agenteId" in target) form.append("agente_id", String(target.agenteId));
        else form.append("phone_number_id", target.phoneNumberId);
        form.append("archivo", archivo);
        const res = await fetch("/api/dashboard/base-conocimiento", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("Error subiendo el archivo", "Error uploading the file"));
        setMensaje(
          t(
            `Cargado: ${data.caracteres.toLocaleString("es-CO")} caracteres${data.truncado ? " (se recortó por tamaño)" : ""}.`,
            `Loaded: ${data.caracteres.toLocaleString("en-US")} characters${data.truncado ? " (trimmed for size)" : ""}.`
          )
        );
        onActualizado();
      } catch (err) {
        setMensaje(err instanceof Error ? err.message : String(err));
      } finally {
        setSubiendo(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [accessToken, target, onActualizado, t]
  );

  const quitarArchivo = useCallback(async () => {
    setSubiendo(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/dashboard/base-conocimiento", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify("agenteId" in target ? { agente_id: target.agenteId } : { phone_number_id: target.phoneNumberId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("Error quitando el archivo", "Error removing the file"));
      onActualizado();
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : String(err));
    } finally {
      setSubiendo(false);
    }
  }, [accessToken, target, onActualizado, t]);

  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <FileUp className="size-4 text-mist" />
        <h3 className="text-sm font-semibold text-fg">{t("Base de conocimiento", "Knowledge base")}</h3>
      </div>
      <p className="text-xs leading-relaxed text-mist">
        {t(
          "Sube tu listado de precios (Excel/CSV) o un documento (PDF, como estatutos o políticas). La IA lo usará como referencia además de las instrucciones de arriba.",
          "Upload your price list (Excel/CSV) or a document (PDF, such as bylaws or policies). The AI will use it as a reference in addition to the instructions above."
        )}
      </p>

      {tieneArchivo ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-edge bg-ink p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <FileText className="size-4 shrink-0 text-lime-text" />
            <p className="truncate text-sm font-medium text-fg">{nombreArchivo}</p>
          </div>
          <button
            onClick={quitarArchivo}
            disabled={subiendo}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-mist transition-colors hover:text-red-400 disabled:opacity-50"
            aria-label={t("Quitar archivo", "Remove file")}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-mist">{t("Todavía no has subido ningún archivo.", "You haven't uploaded any file yet.")}</p>
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
        {subiendo ? t("Procesando…", "Processing…") : tieneArchivo ? t("Reemplazar archivo", "Replace file") : t("Subir archivo", "Upload file")}
      </button>
      {mensaje && <p className="mt-3 text-xs leading-relaxed text-mist">{mensaje}</p>}
    </div>
  );
}

type MensajePlayground = { rol: "usuario" | "ia"; texto: string };

function Playground({ phoneNumberId, nombreMostrado, accessToken }: { phoneNumberId: string; nombreMostrado: string; accessToken: string }) {
  const { t } = useI18n();
  const [mensajes, setMensajes] = useState<MensajePlayground[]>([]);
  const [entrada, setEntrada] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = useCallback(async () => {
    const texto = entrada.trim();
    if (!texto || enviando) return;
    const historialPrevio = mensajes;
    setEntrada("");
    setError(null);
    setMensajes((prev) => [...prev, { rol: "usuario", texto }]);
    setEnviando(true);
    try {
      const res = await fetch("/api/dashboard/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ phone_number_id: phoneNumberId, mensaje: texto, historial: historialPrevio }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("Error consultando a la IA", "Error querying the AI"));
      setMensajes((prev) => [...prev, { rol: "ia", texto: data.respuesta }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }, [entrada, enviando, mensajes, phoneNumberId, accessToken, t]);

  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <MessageSquareText className="size-4 text-mist" />
        <h3 className="text-sm font-semibold text-fg">{t("Probar en playground", "Test in playground")}</h3>
      </div>
      <p className="text-xs leading-relaxed text-mist">
        {t(
          `Chatea con ${nombreMostrado} usando sus instrucciones y base de conocimiento reales. La conversación mantiene contexto entre mensajes, igual que en WhatsApp — nada de esto se envía por WhatsApp ni cuenta contra tu consumo.`,
          `Chat with ${nombreMostrado} using its real instructions and knowledge base. The conversation keeps context across messages, just like WhatsApp — none of this is sent over WhatsApp or counts against your usage.`
        )}
      </p>

      <div className="mt-3 max-h-72 space-y-2.5 overflow-y-auto rounded-lg border border-edge bg-ink p-3">
        {mensajes.length === 0 ? (
          <p className="text-xs text-mist">{t("Escribe algo como lo haría un cliente…", "Type something a customer would say…")}</p>
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
        {enviando && <p className="text-xs text-mist">{t(`${nombreMostrado} está escribiendo…`, `${nombreMostrado} is typing…`)}</p>}
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <input
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") enviar();
          }}
          placeholder={t("Escribe un mensaje de prueba…", "Type a test message…")}
          className="w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-lime/50"
        />
        <button
          onClick={enviar}
          disabled={enviando || !entrada.trim()}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-lime text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t("Enviar", "Send")}
        >
          <Send className="size-4" />
        </button>
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

// Vista de un agente NUEVO (dulabs_agentes): prompt propio, base de
// conocimiento propia, y una lista de números del tenant para asignarlo o
// quitarlo. Puede estar asignado a varios números a la vez (ej. "Ventas" en
// dos líneas distintas) o a ninguno todavía.
function AgentePerfilDetail({
  agente,
  negocios,
  accessToken,
  onActualizado,
}: {
  agente: AgentePerfil;
  negocios: Negocio[];
  accessToken: string;
  onActualizado: () => void;
}) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState(agente.prompt_sistema ?? "");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const entrenado = (agente.prompt_sistema ?? "").trim().length > 0;

  const [editandoNombre, setEditandoNombre] = useState(false);
  const [nombreInput, setNombreInput] = useState(agente.nombre);
  const [guardandoNombre, setGuardandoNombre] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [asignando, setAsignando] = useState<string | null>(null);

  const guardarNombre = useCallback(async () => {
    const valor = nombreInput.trim();
    if (!valor || valor === agente.nombre) {
      setEditandoNombre(false);
      setNombreInput(agente.nombre);
      return;
    }
    setGuardandoNombre(true);
    try {
      const res = await fetch("/api/dashboard/agentes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ id: agente.id, nombre: valor }),
      });
      if (!res.ok) throw new Error();
      setEditandoNombre(false);
      onActualizado();
    } catch {
      setNombreInput(agente.nombre);
    } finally {
      setGuardandoNombre(false);
    }
  }, [nombreInput, agente, accessToken, onActualizado]);

  const guardarPrompt = useCallback(async () => {
    setGuardando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/dashboard/agentes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ id: agente.id, prompt_sistema: prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("Error guardando", "Error saving"));
      setMensaje(t("Guardado. La IA usará estas instrucciones desde el próximo mensaje.", "Saved. The AI will use these instructions from the next message on."));
      onActualizado();
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }, [accessToken, agente.id, prompt, onActualizado, t]);

  const eliminar = useCallback(async () => {
    if (!confirm(t("¿Eliminar este agente? Los números que lo usan volverán a quedar sin agente asignado.", "Delete this agent? The numbers using it will go back to unassigned."))) return;
    setEliminando(true);
    try {
      const res = await fetch("/api/dashboard/agentes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ id: agente.id }),
      });
      if (!res.ok) throw new Error();
      onActualizado();
    } finally {
      setEliminando(false);
    }
  }, [agente.id, accessToken, onActualizado, t]);

  const asignar = useCallback(
    async (phoneNumberId: string, asignar: boolean) => {
      setAsignando(phoneNumberId);
      try {
        const res = await fetch("/api/dashboard/negocio", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ phone_number_id: phoneNumberId, agente_id: asignar ? agente.id : null }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("Error asignando", "Error assigning"));
        onActualizado();
      } finally {
        setAsignando(null);
      }
    },
    [agente.id, accessToken, onActualizado, t]
  );

  const numerosAsignados = negocios.filter((n) => n.agente_id === agente.id);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-edge bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`flex size-14 items-center justify-center rounded-2xl ${entrenado ? "bg-lime/15 text-lime-text" : "bg-ink text-mist"}`}>
              <Bot className="size-7" />
            </div>
            <div>
              {editandoNombre ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={nombreInput}
                    maxLength={60}
                    onChange={(e) => setNombreInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") guardarNombre();
                      if (e.key === "Escape") {
                        setEditandoNombre(false);
                        setNombreInput(agente.nombre);
                      }
                    }}
                    className="w-48 rounded-md border border-edge bg-ink px-2 py-1 text-lg font-semibold text-fg outline-none focus:border-lime/50"
                  />
                  <button onClick={guardarNombre} disabled={guardandoNombre} className="flex size-6 items-center justify-center rounded-md text-lime-text hover:bg-lime/10 disabled:opacity-50" aria-label={t("Guardar", "Save")}>
                    <Check className="size-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setEditandoNombre(false);
                      setNombreInput(agente.nombre);
                    }}
                    className="flex size-6 items-center justify-center rounded-md text-mist hover:bg-ink"
                    aria-label={t("Cancelar", "Cancel")}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <button onClick={() => setEditandoNombre(true)} className="group flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-fg">{agente.nombre}</h2>
                  <Pencil className="size-3.5 text-mist opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              )}
              <div className="mt-1 flex items-center gap-2">
                <Pill tone={entrenado ? "success" : "neutral"}>{entrenado ? t("Entrenado", "Trained") : t("Sin entrenar", "Untrained")}</Pill>
                <span className="text-xs text-mist">
                  {numerosAsignados.length === 0
                    ? t("Sin número asignado", "Not assigned to any number")
                    : t(`Asignado a ${numerosAsignados.length} número(s)`, `Assigned to ${numerosAsignados.length} number(s)`)}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={eliminar}
            disabled={eliminando}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          >
            <Trash2 className="size-3.5" />
            {t("Eliminar agente", "Delete agent")}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-edge bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-4 text-mist" />
          <h3 className="text-sm font-semibold text-fg">{t("Instrucciones (precios, horarios, tono)", "Instructions (prices, hours, tone)")}</h3>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={7}
          maxLength={4000}
          placeholder={t(`Eres "${agente.nombre}". Responde de forma breve, amable y útil.`, `You are "${agente.nombre}". Reply briefly, kindly and helpfully.`)}
          className="w-full rounded-lg border border-edge bg-ink px-4 py-3 text-sm leading-relaxed text-fg outline-none transition-colors duration-200 focus:border-lime/50"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            onClick={guardarPrompt}
            disabled={guardando}
            className="btn-shine rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {guardando ? t("Guardando…", "Saving…") : t("Guardar", "Save")}
          </button>
          <span className="text-xs text-mist">{prompt.length} / 4000</span>
        </div>
        {mensaje && <p className="mt-3 text-xs leading-relaxed text-mist">{mensaje}</p>}
      </div>

      <BaseConocimiento
        target={{ agenteId: agente.id }}
        nombreArchivo={agente.base_conocimiento_nombre_archivo}
        accessToken={accessToken}
        onActualizado={onActualizado}
      />

      <div className="rounded-xl border border-edge bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <ArrowRightLeft className="size-4 text-mist" />
          <h3 className="text-sm font-semibold text-fg">{t("Números que atiende", "Numbers it handles")}</h3>
        </div>
        <p className="text-xs leading-relaxed text-mist">
          {t(
            "Marca en qué números de WhatsApp responde este agente. Puedes asignarlo a varios a la vez.",
            "Check which WhatsApp numbers this agent replies on. You can assign it to more than one."
          )}
        </p>
        <div className="mt-3 space-y-2">
          {negocios.map((n) => {
            const asignado = n.agente_id === agente.id;
            const ocupadoPorOtro = n.agente_id !== null && n.agente_id !== agente.id;
            return (
              <label
                key={n.phone_number_id}
                className={`flex items-center justify-between gap-3 rounded-lg border border-edge bg-ink px-3 py-2.5 ${ocupadoPorOtro ? "opacity-50" : ""}`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Phone className="size-3.5 shrink-0 text-mist" />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-fg">{n.nombre_negocio}</p>
                    <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{formatearTelefono(n.telefono_negocio)}</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={asignado}
                  disabled={asignando === n.phone_number_id || (ocupadoPorOtro && !asignado)}
                  onChange={(e) => asignar(n.phone_number_id, e.target.checked)}
                  className="size-4 accent-lime"
                />
              </label>
            );
          })}
        </div>
      </div>

      {numerosAsignados[0] && <Playground phoneNumberId={numerosAsignados[0].phone_number_id} nombreMostrado={agente.nombre} accessToken={accessToken} />}
    </div>
  );
}

// Vista LEGADA (número sin agente_id asignado): mismo comportamiento de
// siempre — prompt y base de conocimiento viven directo en la fila del
// número. Se ofrece migrarlo a un agente nuevo cuando el usuario quiera.
function LegadoDetail({
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
  const { t } = useI18n();
  const [prompt, setPrompt] = useState(negocio.prompt_sistema ?? "");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const entrenada = (negocio.prompt_sistema ?? "").trim().length > 0;
  const [migrando, setMigrando] = useState(false);

  const guardar = useCallback(async () => {
    setGuardando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/dashboard/prompt", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ phone_number_id: negocio.phone_number_id, prompt_sistema: prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("Error guardando", "Error saving"));
      setMensaje(t("Guardado. La IA usará estas instrucciones desde el próximo mensaje.", "Saved. The AI will use these instructions from the next message on."));
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }, [accessToken, negocio.phone_number_id, prompt, t]);

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

  const migrar = useCallback(async () => {
    setMigrando(true);
    try {
      const res = await fetch("/api/dashboard/agentes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ migrar_desde_phone_number_id: negocio.phone_number_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("Error migrando", "Error migrating"));
      onActualizado();
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : String(err));
    } finally {
      setMigrando(false);
    }
  }, [negocio.phone_number_id, accessToken, onActualizado, t]);

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-xl border border-edge bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`flex size-14 items-center justify-center rounded-2xl ${entrenada ? "bg-lime/15 text-lime-text" : "bg-ink text-mist"}`}>
              <Bot className="size-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-fg">{negocio.nombre_negocio}</h2>
                <Pill tone={entrenada ? "success" : "neutral"}>{entrenada ? t("Entrenada", "Trained") : t("Sin entrenar", "Untrained")}</Pill>
                <Pill tone="warning">{t("Agente heredado", "Legacy agent")}</Pill>
              </div>
              <p className="mt-1 text-sm text-mist">{formatearTelefono(negocio.telefono_negocio)} · WhatsApp Cloud API</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {negocio.ia_pausada && <Pill tone="warning">{t("IA pausada", "AI paused")}</Pill>}
            <button
              onClick={alternarPausa}
              disabled={cambiandoPausa}
              className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                negocio.ia_pausada ? "border-lime/40 text-lime-text hover:bg-lime/10" : "border-edge text-fg hover:border-red-400/40 hover:text-red-400"
              }`}
            >
              {negocio.ia_pausada ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {negocio.ia_pausada ? t("Reanudar IA", "Resume AI") : t("Pausar IA", "Pause AI")}
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge bg-edge md:grid-cols-3">
          <Metric
            icon={TrendingUp}
            label={t("Resolución (24h)", "Resolution (24h)")}
            value={metricas && metricas.mensajesAtendidos24h > 0 ? `${Math.round(metricas.tasaAutomatizacion * 100)}%` : "—"}
          />
          <Metric icon={MessagesSquare} label={t("Mensajes este mes", "Messages this month")} value={negocio.mensajes_usados.toLocaleString("es-CO")} />
          <Metric
            icon={Clock}
            label={t("Latencia promedio", "Average latency")}
            value={metricas?.tiempoRespuestaSeg != null ? formatearDuracion(metricas.tiempoRespuestaSeg) : "—"}
          />
        </div>
      </div>

      <div className="rounded-xl border border-lime/25 bg-lime/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-fg">{t("Migrar a un agente reutilizable", "Migrate to a reusable agent")}</p>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-mist">
              {t(
                "Convierte estas instrucciones en un agente que después puedes reasignar a otros números o duplicar. No cambia cómo responde ahora mismo.",
                "Turn these instructions into an agent you can later reassign to other numbers or duplicate. It won't change how it replies right now."
              )}
            </p>
          </div>
          <button
            onClick={migrar}
            disabled={migrando}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowRightLeft className="size-3.5" />
            {migrando ? t("Migrando…", "Migrating…") : t("Migrar a agente nuevo", "Migrate to new agent")}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-edge bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-4 text-mist" />
          <h3 className="text-sm font-semibold text-fg">{t("Instrucciones (precios, horarios, tono)", "Instructions (prices, hours, tone)")}</h3>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={7}
          maxLength={4000}
          placeholder={t(
            `Eres el asistente de WhatsApp del negocio "${negocio.nombre_negocio}". Responde de forma breve, amable y útil. Nuestros precios son... Atendemos de... a...`,
            `You are the WhatsApp assistant for "${negocio.nombre_negocio}". Reply briefly, kindly and helpfully. Our prices are... We're open from... to...`
          )}
          className="w-full rounded-lg border border-edge bg-ink px-4 py-3 text-sm leading-relaxed text-fg outline-none transition-colors duration-200 focus:border-lime/50"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            onClick={guardar}
            disabled={guardando}
            className="btn-shine rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {guardando ? t("Guardando…", "Saving…") : t("Guardar", "Save")}
          </button>
          <span className="text-xs text-mist">{prompt.length} / 4000</span>
        </div>
        {mensaje && <p className="mt-3 text-xs leading-relaxed text-mist">{mensaje}</p>}
      </div>

      <BaseConocimiento
        target={{ phoneNumberId: negocio.phone_number_id }}
        nombreArchivo={negocio.base_conocimiento_nombre_archivo}
        accessToken={accessToken}
        onActualizado={onActualizado}
      />

      <Playground phoneNumberId={negocio.phone_number_id} nombreMostrado={nombreDelAgente(negocio)} accessToken={accessToken} />

      <div className="rounded-xl border border-edge bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="size-4 text-mist" />
          <h3 className="text-sm font-semibold text-fg">{t("Cómo opera", "How it works")}</h3>
        </div>
        <ul className="space-y-2 text-sm">
          {[
            t("Responde con la API Oficial de WhatsApp Business de Meta", "Replies via Meta's Official WhatsApp Business API"),
            t("Se pausa automáticamente si tú respondes desde tu celular", "Pauses automatically if you reply from your phone"),
            negocio.ia_pausada
              ? t("Actualmente pausada manualmente — no responderá hasta que la reanudes", "Currently paused manually — it won't reply until you resume it")
              : t("Solo usa las instrucciones y la base de conocimiento que le diste, nada más", "Uses only the instructions and knowledge base you gave it, nothing else"),
          ].map((linea) => (
            <li key={linea} className="flex items-center gap-2.5 rounded-lg border border-edge bg-ink px-3 py-2.5 text-fg/90">
              <span className="size-1.5 rounded-full bg-lime" />
              {linea}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function AgentesPage() {
  const { session, negocios, suscripcion, cargarNegocios } = useDashboard();
  const { t } = useI18n();
  const plan = PLANES[resolverPlanId(suscripcion?.plan)];

  const [agentes, setAgentes] = useState<AgentePerfil[] | null>(null);
  const [enUso, setEnUso] = useState(0);
  const [objetivo, setObjetivo] = useState<Objetivo | null>(null);
  const [metricasPorNumero, setMetricasPorNumero] = useState<MetricasNumero[] | null>(null);
  const [creando, setCreando] = useState(false);
  const [errorCrear, setErrorCrear] = useState<string | null>(null);

  const cargarAgentes = useCallback(() => {
    if (!session) return;
    fetch("/api/dashboard/agentes", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => {
        setAgentes(data.agentes ?? []);
        setEnUso(data.enUso ?? 0);
      })
      .catch(() => setAgentes([]));
  }, [session]);

  useEffect(() => {
    cargarAgentes();
  }, [cargarAgentes]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/dashboard/resumen", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setMetricasPorNumero(data.metricasPorNumero ?? []))
      .catch(() => setMetricasPorNumero([]));
  }, [session]);

  const actualizarTodo = useCallback(() => {
    cargarAgentes();
    cargarNegocios();
  }, [cargarAgentes, cargarNegocios]);

  const numerosLegado = (negocios ?? []).filter((n) => !n.agente_id);

  // Selección efectiva: la que el usuario eligió, o si todavía no eligió
  // nada, el primer agente (o si no hay agentes, el primer número legado) —
  // así la pantalla nunca abre vacía si hay algo que configurar. Se computa
  // en cada render en vez de guardarse en un efecto: no hay estado que
  // sincronizar con nada externo, solo un valor por defecto derivado.
  const objetivoActivo: Objetivo | null =
    objetivo ??
    (agentes && agentes.length > 0
      ? { tipo: "agente", id: agentes[0].id }
      : numerosLegado.length > 0
        ? { tipo: "legado", phoneNumberId: numerosLegado[0].phone_number_id }
        : null);

  const crearAgente = useCallback(async () => {
    if (!session) return;
    setCreando(true);
    setErrorCrear(null);
    try {
      const res = await fetch("/api/dashboard/agentes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("Error creando el agente", "Error creating agent"));
      cargarAgentes();
      setObjetivo({ tipo: "agente", id: data.agente.id });
    } catch (err) {
      setErrorCrear(err instanceof Error ? err.message : String(err));
    } finally {
      setCreando(false);
    }
  }, [session, cargarAgentes, t]);

  const enTope = plan.limites.agentesIA !== null && enUso >= plan.limites.agentesIA;
  const agenteSeleccionado =
    objetivoActivo?.tipo === "agente" ? agentes?.find((a) => a.id === objetivoActivo.id) ?? null : null;
  const legadoSeleccionado =
    objetivoActivo?.tipo === "legado" ? negocios?.find((n) => n.phone_number_id === objetivoActivo.phoneNumberId) ?? null : null;
  const metricasLegado = legadoSeleccionado
    ? metricasPorNumero?.find((m) => m.phone_number_id === legadoSeleccionado.phone_number_id) ?? null
    : null;

  const sinNada = negocios !== null && negocios.length === 0 && agentes !== null && agentes.length === 0;

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow={t("Operar", "Operate")}
        title={t("Agentes de IA", "AI agents")}
        description={t(
          "Crea perfiles de IA reutilizables — con su propio tono, precios y base de conocimiento — y asígnalos a los números que quieras.",
          "Create reusable AI profiles — with their own tone, prices and knowledge base — and assign them to whichever numbers you want."
        )}
      />

      <div className="px-4 pt-6 md:px-8">
        {sinNada ? (
          <div className="rounded-xl border border-edge bg-card p-8 text-center">
            <Bot className="mx-auto size-10 text-mist/40" strokeWidth={1.2} />
            <p className="mt-3 text-sm font-semibold text-fg">{t("Todavía no tienes ningún número conectado", "You don't have any connected number yet")}</p>
            <p className="mt-1 text-xs text-mist">{t("Conecta tu WhatsApp para entrenar tu primer asistente.", "Connect your WhatsApp to train your first assistant.")}</p>
            <Link href="/dashboard/conexion" className="mt-4 inline-block rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg hover:bg-lime-hover">
              {t("Conectar número →", "Connect number →")}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">
                  {plan.limites.agentesIA !== null
                    ? `${enUso} / ${plan.limites.agentesIA} ${t("agentes de tu plan", "agents on your plan")} ${plan.nombre}`
                    : t("Agentes ilimitados", "Unlimited agents")}
                </p>
              </div>

              {enTope ? (
                <p className="rounded-lg border border-edge bg-ink p-3 text-xs leading-relaxed text-mist">
                  {t(`Ya usas los ${plan.limites.agentesIA} agentes de tu plan ${plan.nombre}.`, `You're already using all ${plan.limites.agentesIA} agents on your ${plan.nombre} plan.`)}{" "}
                  <Link href="/precios" className="font-semibold text-lime-text hover:text-fg">
                    {t("Mejorar plan →", "Upgrade plan →")}
                  </Link>
                </p>
              ) : (
                <button
                  onClick={crearAgente}
                  disabled={creando}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-edge px-4 py-2.5 text-xs font-semibold text-fg transition-colors hover:border-lime/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="size-3.5" />
                  {creando ? t("Creando…", "Creating…") : t("Crear agente", "Create agent")}
                </button>
              )}
              {errorCrear && <p className="text-xs text-red-400">{errorCrear}</p>}

              {agentes?.map((a) => {
                const seleccionado = objetivoActivo?.tipo === "agente" && objetivoActivo.id === a.id;
                const entrenado = (a.prompt_sistema ?? "").trim().length > 0;
                const asignadoA = (negocios ?? []).filter((n) => n.agente_id === a.id).length;
                return (
                  <button
                    key={a.id}
                    onClick={() => setObjetivo({ tipo: "agente", id: a.id })}
                    className={`w-full rounded-xl border p-4 text-left transition-colors ${seleccionado ? "border-lime/40 bg-card" : "border-edge bg-card hover:border-lime/25"}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex size-10 items-center justify-center rounded-xl ${entrenado ? "bg-lime/15 text-lime-text" : "bg-ink text-mist"}`}>
                        <Bot className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-fg">{a.nombre}</p>
                        <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-widest text-mist">
                          {asignadoA === 0 ? t("sin asignar", "unassigned") : t(`${asignadoA} número(s)`, `${asignadoA} number(s)`)}
                        </p>
                      </div>
                      <Pill tone={entrenado ? "success" : "neutral"}>{entrenado ? t("Entrenado", "Trained") : t("Nuevo", "New")}</Pill>
                    </div>
                  </button>
                );
              })}

              {numerosLegado.length > 0 && (
                <>
                  <p className="pt-2 font-mono text-[10.5px] uppercase tracking-widest text-mist/70">
                    {t("Números sin agente asignado", "Numbers without an assigned agent")}
                  </p>
                  {numerosLegado.map((n) => {
                    const seleccionado = objetivoActivo?.tipo === "legado" && objetivoActivo.phoneNumberId === n.phone_number_id;
                    const entrenada = (n.prompt_sistema ?? "").trim().length > 0;
                    return (
                      <button
                        key={n.phone_number_id}
                        onClick={() => setObjetivo({ tipo: "legado", phoneNumberId: n.phone_number_id })}
                        className={`w-full rounded-xl border p-4 text-left transition-colors ${seleccionado ? "border-lime/40 bg-card" : "border-edge bg-card hover:border-lime/25"}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`flex size-10 items-center justify-center rounded-xl ${entrenada ? "bg-lime/15 text-lime-text" : "bg-ink text-mist"}`}>
                            <Bot className="size-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-fg">{n.nombre_negocio}</p>
                            <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-widest text-mist">{formatearTelefono(n.telefono_negocio)}</p>
                          </div>
                          <Pill tone="warning">{t("heredado", "legacy")}</Pill>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
            </div>

            <div>
              {session && agenteSeleccionado && (
                <AgentePerfilDetail key={agenteSeleccionado.id} agente={agenteSeleccionado} negocios={negocios ?? []} accessToken={session.access_token} onActualizado={actualizarTodo} />
              )}
              {session && !agenteSeleccionado && legadoSeleccionado && (
                <LegadoDetail key={legadoSeleccionado.phone_number_id} negocio={legadoSeleccionado} accessToken={session.access_token} onActualizado={actualizarTodo} metricas={metricasLegado} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
