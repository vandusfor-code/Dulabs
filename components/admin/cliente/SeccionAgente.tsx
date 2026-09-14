"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, FileText, X, Pencil, Check, Send, MessageSquareText, Plus, ArrowRightLeft, Phone, Bot } from "lucide-react";
import { Pill } from "@/components/dashboard/shell/ui";
import { formatearTelefono } from "@/lib/format";
import { Seccion } from "./AdminClienteUI";

// F15.2 (Operations Center, cierre) -- portado del admin legacy (ver
// SeccionImplementacion.tsx). Gestión completa del agente de IA de un
// cliente: crear, renombrar, editar instrucciones, base de conocimiento,
// asignar a números, y un playground para probarlo SIN enviar por WhatsApp
// ni consumir cupo real del cliente. Todas las mutaciones pasan por
// /api/dashboard/admin/clientes/[idTenant]/agente(/asignar|/base-conocimiento|/playground),
// ya existentes y sin cambios -- este archivo es el porte de la UI.

export type NumeroAdmin = { phoneNumberId: string; nombreNegocio: string; telefonoNegocio: string; conectado: boolean; agenteId: number | null; marketplaceActivacionId: number | null };
export type AgentePerfil = { id: number; nombre: string; prompt_sistema: string | null; base_conocimiento_nombre_archivo: string | null; base_conocimiento_actualizado_at: string | null; created_at: string };
export type AgenteData = { agentes: AgentePerfil[]; numeros: NumeroAdmin[]; limite: number | null; enUso: number; plan: string };

function PlaygroundAdmin({ idTenant, phoneNumberId, nombreMostrado, accessToken }: { idTenant: string; phoneNumberId: string; nombreMostrado: string; accessToken: string }) {
  type MensajePlayground = { rol: "usuario" | "ia"; texto: string };
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
      const res = await fetch(`/api/dashboard/admin/clientes/${idTenant}/agente/playground`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ phone_number_id: phoneNumberId, mensaje: texto, historial: historialPrevio }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error consultando a la IA");
      setMensajes((prev) => [...prev, { rol: "ia", texto: data.respuesta }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }, [entrada, enviando, mensajes, idTenant, phoneNumberId, accessToken]);

  return (
    <div className="rounded-lg border border-edge bg-ink p-4">
      <div className="mb-3 flex items-center gap-2">
        <MessageSquareText className="size-4 text-mist" />
        <p className="text-sm font-semibold text-fg">Probar en playground</p>
      </div>
      <p className="text-xs leading-relaxed text-mist">
        Chatea con {nombreMostrado} usando sus instrucciones reales. No se envía por WhatsApp ni cuenta contra el consumo del cliente.
      </p>
      <div className="mt-3 max-h-64 space-y-2.5 overflow-y-auto rounded-lg border border-edge bg-card p-3">
        {mensajes.length === 0 ? (
          <p className="text-xs text-mist">Escribe algo como lo haría un cliente…</p>
        ) : (
          mensajes.map((m, i) => (
            <div key={i} className={`flex ${m.rol === "usuario" ? "justify-end" : "justify-start"}`}>
              <p className={`max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm ${m.rol === "usuario" ? "bg-lime/15 text-fg" : "bg-ink text-fg"}`}>{m.texto}</p>
            </div>
          ))
        )}
        {enviando && <p className="text-xs text-mist">{nombreMostrado} está escribiendo…</p>}
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
          className="w-full rounded-lg border border-edge bg-card px-3 py-2 text-sm text-fg outline-none focus:border-lime/50"
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

function BaseConocimientoAdmin({
  idTenant,
  agenteId,
  nombreArchivo,
  accessToken,
  onActualizado,
}: {
  idTenant: string;
  agenteId: number;
  nombreArchivo: string | null;
  accessToken: string;
  onActualizado: () => void;
}) {
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
        form.append("agente_id", String(agenteId));
        form.append("archivo", archivo);
        const res = await fetch(`/api/dashboard/admin/clientes/${idTenant}/agente/base-conocimiento`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error subiendo el archivo");
        setMensaje(`Cargado: ${data.caracteres.toLocaleString("es-CO")} caracteres${data.truncado ? " (se recortó por tamaño)" : ""}.`);
        onActualizado();
      } catch (err) {
        setMensaje(err instanceof Error ? err.message : String(err));
      } finally {
        setSubiendo(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [idTenant, agenteId, accessToken, onActualizado],
  );

  const quitarArchivo = useCallback(async () => {
    setSubiendo(true);
    setMensaje(null);
    try {
      const res = await fetch(`/api/dashboard/admin/clientes/${idTenant}/agente/base-conocimiento`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ agente_id: agenteId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error quitando el archivo");
      onActualizado();
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : String(err));
    } finally {
      setSubiendo(false);
    }
  }, [idTenant, agenteId, accessToken, onActualizado]);

  return (
    <div className="rounded-lg border border-edge bg-ink p-4">
      <div className="mb-3 flex items-center gap-2">
        <FileUp className="size-4 text-mist" />
        <p className="text-sm font-semibold text-fg">Base de conocimiento</p>
      </div>
      {tieneArchivo ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-card p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <FileText className="size-4 shrink-0 text-lime-text" />
            <p className="truncate text-sm font-medium text-fg">{nombreArchivo}</p>
          </div>
          <button onClick={quitarArchivo} disabled={subiendo} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-mist transition-colors hover:text-red-400 disabled:opacity-50" aria-label="Quitar archivo">
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <p className="text-xs text-mist">Todavía no tiene ningún archivo.</p>
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
      <button onClick={() => inputRef.current?.click()} disabled={subiendo} className="mt-3 rounded-lg border border-edge px-4 py-2 text-xs font-semibold text-fg transition-colors hover:border-lime/40 disabled:cursor-not-allowed disabled:opacity-50">
        {subiendo ? "Procesando…" : tieneArchivo ? "Reemplazar archivo" : "Subir archivo"}
      </button>
      {mensaje && <p className="mt-3 text-xs leading-relaxed text-mist">{mensaje}</p>}
    </div>
  );
}

function AgenteEditor({
  idTenant,
  accessToken,
  agente,
  numeros,
  plantillaPropuesta,
  onConsumirPlantilla,
  onActualizado,
}: {
  idTenant: string;
  accessToken: string;
  agente: AgentePerfil;
  numeros: NumeroAdmin[];
  plantillaPropuesta: string | null;
  onConsumirPlantilla: () => void;
  onActualizado: () => void;
}) {
  const [nombre, setNombre] = useState(agente.nombre);
  const [editandoNombre, setEditandoNombre] = useState(false);
  const [guardandoNombre, setGuardandoNombre] = useState(false);
  const [prompt, setPrompt] = useState(agente.prompt_sistema ?? "");
  const [guardandoPrompt, setGuardandoPrompt] = useState(false);
  const [mensajePrompt, setMensajePrompt] = useState<string | null>(null);
  const [asignando, setAsignando] = useState<string | null>(null);

  const guardarNombre = useCallback(async () => {
    const valor = nombre.trim();
    if (!valor || valor === agente.nombre) {
      setEditandoNombre(false);
      setNombre(agente.nombre);
      return;
    }
    setGuardandoNombre(true);
    try {
      const res = await fetch(`/api/dashboard/admin/clientes/${idTenant}/agente`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ id: agente.id, nombre: valor }),
      });
      if (!res.ok) throw new Error();
      setEditandoNombre(false);
      onActualizado();
    } catch {
      setNombre(agente.nombre);
    } finally {
      setGuardandoNombre(false);
    }
  }, [nombre, agente, idTenant, accessToken, onActualizado]);

  const guardarPrompt = useCallback(async () => {
    setGuardandoPrompt(true);
    setMensajePrompt(null);
    try {
      const res = await fetch(`/api/dashboard/admin/clientes/${idTenant}/agente`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ id: agente.id, prompt_sistema: prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error guardando");
      setMensajePrompt("Guardado. La IA usará estas instrucciones desde el próximo mensaje.");
      onActualizado();
    } catch (err) {
      setMensajePrompt(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardandoPrompt(false);
    }
  }, [idTenant, accessToken, agente.id, prompt, onActualizado]);

  // La plantilla del onboarding solo llega aquí cuando el operador hizo clic
  // explícito en "Usar como base para configurar" (SeccionOnboarding) --
  // nunca sobrescribe el prompt automáticamente. Aplicada durante el render
  // (patrón "ajustar estado cuando cambia una prop") en vez de en un efecto,
  // para no llamar setState síncrono dentro de un effect.
  const [plantillaAplicada, setPlantillaAplicada] = useState<string | null>(null);
  if (plantillaPropuesta && plantillaPropuesta !== plantillaAplicada) {
    setPlantillaAplicada(plantillaPropuesta);
    setPrompt(plantillaPropuesta);
    setMensajePrompt("Se llenó el prompt con la información del onboarding — revísala y guarda cuando esté lista.");
  }
  useEffect(() => {
    if (plantillaPropuesta) onConsumirPlantilla();
  }, [plantillaPropuesta, onConsumirPlantilla]);

  const asignar = useCallback(
    async (phoneNumberId: string, asignarAlAgente: boolean) => {
      setAsignando(phoneNumberId);
      try {
        const res = await fetch(`/api/dashboard/admin/clientes/${idTenant}/agente/asignar`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ phone_number_id: phoneNumberId, agente_id: asignarAlAgente ? agente.id : null }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error asignando");
        onActualizado();
      } finally {
        setAsignando(null);
      }
    },
    [idTenant, agente.id, accessToken, onActualizado],
  );

  const numerosAsignados = numeros.filter((n) => n.agenteId === agente.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-4">
        <div className="flex items-center gap-2">
          {editandoNombre ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={nombre}
                maxLength={60}
                onChange={(e) => setNombre(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") guardarNombre();
                  if (e.key === "Escape") {
                    setEditandoNombre(false);
                    setNombre(agente.nombre);
                  }
                }}
                className="w-48 rounded-md border border-edge bg-ink px-2 py-1 text-sm font-semibold text-fg outline-none focus:border-lime/50"
              />
              <button onClick={guardarNombre} disabled={guardandoNombre} className="flex size-6 items-center justify-center rounded-md text-lime-text hover:bg-lime/10 disabled:opacity-50" aria-label="Guardar">
                <Check className="size-3.5" />
              </button>
              <button
                onClick={() => {
                  setEditandoNombre(false);
                  setNombre(agente.nombre);
                }}
                className="flex size-6 items-center justify-center rounded-md text-mist hover:bg-card"
                aria-label="Cancelar"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <button onClick={() => setEditandoNombre(true)} className="group flex items-center gap-2">
              <span className="text-sm font-semibold text-fg">{agente.nombre}</span>
              <Pencil className="size-3 text-mist opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          <Pill tone={numerosAsignados.length > 0 ? "success" : "neutral"}>
            {numerosAsignados.length === 0 ? "Sin número asignado" : `${numerosAsignados.length} número(s)`}
          </Pill>
        </div>
      </div>

      <div>
        <p className="mb-2 font-mono text-[10.5px] uppercase tracking-widest text-mist">Instrucciones (precios, horarios, tono)</p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={7}
          maxLength={4000}
          placeholder={`Eres "${agente.nombre}". Responde de forma breve, amable y útil.`}
          className="w-full rounded-lg border border-edge bg-ink px-4 py-3 text-sm leading-relaxed text-fg outline-none transition-colors duration-200 focus:border-lime/50"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            onClick={guardarPrompt}
            disabled={guardandoPrompt}
            className="rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-colors hover:bg-lime-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {guardandoPrompt ? "Guardando…" : "Guardar"}
          </button>
          <span className="text-xs text-mist">{prompt.length} / 4000</span>
        </div>
        {mensajePrompt && <p className="mt-3 text-xs leading-relaxed text-mist">{mensajePrompt}</p>}
      </div>

      <BaseConocimientoAdmin
        idTenant={idTenant}
        agenteId={agente.id}
        nombreArchivo={agente.base_conocimiento_nombre_archivo}
        accessToken={accessToken}
        onActualizado={onActualizado}
      />

      <div>
        <div className="mb-2 flex items-center gap-2">
          <ArrowRightLeft className="size-3.5 text-mist" />
          <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">Números que atiende</p>
        </div>
        {numeros.length === 0 ? (
          <p className="text-xs text-mist">Este cliente no tiene ningún número de WhatsApp conectado.</p>
        ) : (
          <div className="space-y-2">
            {numeros.map((n) => {
              const asignado = n.agenteId === agente.id;
              const ocupadoPorOtro = n.agenteId !== null && n.agenteId !== agente.id;
              return (
                <label key={n.phoneNumberId} className={`flex items-center justify-between gap-3 rounded-lg border border-edge bg-ink px-3 py-2.5 ${ocupadoPorOtro ? "opacity-50" : ""}`}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Phone className="size-3.5 shrink-0 text-mist" />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-fg">{n.nombreNegocio}</p>
                      <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{formatearTelefono(n.telefonoNegocio)}</p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={asignado}
                    disabled={asignando === n.phoneNumberId || (ocupadoPorOtro && !asignado)}
                    onChange={(e) => asignar(n.phoneNumberId, e.target.checked)}
                    className="size-4 accent-lime"
                  />
                </label>
              );
            })}
          </div>
        )}
      </div>

      {numerosAsignados[0] && (
        <PlaygroundAdmin idTenant={idTenant} phoneNumberId={numerosAsignados[0].phoneNumberId} nombreMostrado={agente.nombre} accessToken={accessToken} />
      )}
    </div>
  );
}

export function SeccionAgente({
  idTenant,
  accessToken,
  plantillaPropuesta,
  onConsumirPlantilla,
  onHayAgenteChange,
  onNumerosChange,
}: {
  idTenant: string;
  accessToken: string;
  plantillaPropuesta: string | null;
  onConsumirPlantilla: () => void;
  onHayAgenteChange: (hay: boolean) => void;
  /** F15.2 -- SeccionWhatsApp reusa esta MISMA carga de números (evita un fetch aparte solo para eso). */
  onNumerosChange?: (numeros: NumeroAdmin[]) => void;
}) {
  const [data, setData] = useState<AgenteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seleccionadoId, setSeleccionadoId] = useState<number | null>(null);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(() => {
    fetch(`/api/dashboard/admin/clientes/${idTenant}/agente`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Error cargando el agente");
        setData(json);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [idTenant, accessToken]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!data) return;
    onHayAgenteChange(data.agentes.length > 0);
    onNumerosChange?.(data.numeros);
  }, [data, onHayAgenteChange, onNumerosChange]);

  const crearAgente = useCallback(async () => {
    setCreando(true);
    try {
      const res = await fetch(`/api/dashboard/admin/clientes/${idTenant}/agente`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error creando el agente");
      setSeleccionadoId(json.agente.id);
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreando(false);
    }
  }, [idTenant, accessToken, cargar]);

  if (error) return <Seccion titulo="Agente de IA"><p className="text-sm text-red-400">{error}</p></Seccion>;
  if (!data) return <Seccion titulo="Agente de IA"><p className="text-sm text-mist">Cargando…</p></Seccion>;

  const seleccionado = data.agentes.find((a) => a.id === seleccionadoId) ?? data.agentes[0] ?? null;

  return (
    <Seccion titulo="Agente de IA">
      {data.agentes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-edge bg-ink p-6 text-center">
          <Bot className="mx-auto size-8 text-mist/40" strokeWidth={1.2} />
          <p className="mt-2 text-sm font-semibold text-fg">No hay un agente configurado</p>
          <p className="mt-1 text-xs text-mist">
            {data.limite !== null ? `${data.enUso} / ${data.limite} agentes del plan ${data.plan}` : `Agentes ilimitados (plan ${data.plan})`}
          </p>
          <button
            onClick={crearAgente}
            disabled={creando || (data.limite !== null && data.enUso >= data.limite)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg hover:bg-lime-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="size-3.5" />
            {creando ? "Creando…" : "Crear agente"}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {data.agentes.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {data.agentes.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSeleccionadoId(a.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${a.id === seleccionadoId ? "border-lime/40 bg-lime/10 text-lime-text" : "border-edge text-mist hover:border-lime/25"}`}
                >
                  {a.nombre}
                </button>
              ))}
              <button
                onClick={crearAgente}
                disabled={creando || (data.limite !== null && data.enUso >= data.limite)}
                className="flex items-center gap-1 rounded-lg border border-dashed border-edge px-3 py-1.5 text-xs font-medium text-mist hover:border-lime/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="size-3" /> Nuevo
              </button>
            </div>
          )}
          {seleccionado && (
            <AgenteEditor
              key={seleccionado.id}
              idTenant={idTenant}
              accessToken={accessToken}
              agente={seleccionado}
              numeros={data.numeros}
              plantillaPropuesta={plantillaPropuesta}
              onConsumirPlantilla={onConsumirPlantilla}
              onActualizado={cargar}
            />
          )}
        </div>
      )}
    </Seccion>
  );
}
