"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  MessagesSquare,
  Phone,
  Bot,
  FileUp,
  FileText,
  X,
  Pencil,
  Check,
  Send,
  MessageSquareText,
  Plus,
  ArrowRightLeft,
  Wand2,
  ShoppingBag,
  ListChecks,
} from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";
import { AgenteIcono } from "@/components/dashboard/marketplace/AgenteIcono";
import { PLANES, resolverPlanId } from "@/lib/planes";
import { formatearTelefono } from "@/lib/format";
import {
  labelEstadoImplementacion,
  toneEstadoImplementacion,
  labelEstadoOnboarding,
  labelEstadoPago,
  toneEstadoPago,
} from "@/lib/admin-ui";

type Detalle = {
  cliente: {
    idTenant: string;
    nombre: string | null;
    correo: string | null;
    telefono: string | null;
    plan: string;
    fechaCompra: string;
    estadoPago: string;
  };
  onboarding: {
    estado: string;
    businessDescription: string | null;
    implementationIdea: string | null;
    additionalInformation: string | null;
    phoneNumberId: string;
    telefonoCliente: string;
  } | null;
  implementacion: {
    estado: string;
    iniciadaAt: string | null;
    activadaAt: string | null;
    actualizadoAt: string;
  } | null;
  creditosMasivos: { limite: number; usados: number; disponibles: number } | null;
};

type NumeroAdmin = {
  phoneNumberId: string;
  nombreNegocio: string;
  telefonoNegocio: string;
  conectado: boolean;
  agenteId: number | null;
  marketplaceActivacionId: number | null;
};

type AgenteMarketplaceVista = {
  slug: string;
  nombre: string;
  categoria: string;
  icono: string;
  descripcion: string;
  usaAgenda: boolean;
  activacion: {
    phoneNumberId: string;
    nombreNegocio: string;
    tipoPlan: string;
    esCortesia: boolean;
    cortesiaActivadaPorEmail: string | null;
    cortesiaMotivo: string | null;
    createdAt: string;
  } | null;
};

type MarketplaceData = { numeros: NumeroAdmin[]; agentes: AgenteMarketplaceVista[] };

type AgentePerfil = {
  id: number;
  nombre: string;
  prompt_sistema: string | null;
  base_conocimiento_nombre_archivo: string | null;
  base_conocimiento_actualizado_at: string | null;
  created_at: string;
};

type AgenteData = { agentes: AgentePerfil[]; numeros: NumeroAdmin[]; limite: number | null; enUso: number; plan: string };

const ESTADOS_IMPLEMENTACION = ["PENDIENTE", "EN_CONFIGURACION", "EN_PRUEBAS", "ACTIVO", "REQUIERE_ATENCION"];

const SIGUIENTE_ACCION: Partial<Record<string, { label: string; siguienteEstado: string }>> = {
  PENDIENTE: { label: "Iniciar configuración", siguienteEstado: "EN_CONFIGURACION" },
  EN_CONFIGURACION: { label: "Pasar a pruebas", siguienteEstado: "EN_PRUEBAS" },
  EN_PRUEBAS: { label: "Marcar como activo", siguienteEstado: "ACTIVO" },
};

function fechaLarga(fecha: string | null): string {
  if (!fecha) return "—";
  return new Date(fecha).toLocaleString("es-CO", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Bloque({ label, texto }: { label: string; texto: string | null }) {
  return (
    <div>
      <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{label}</p>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-fg">{texto || "—"}</p>
    </div>
  );
}

function Seccion({ titulo, icono: Icono, children, accion }: { titulo: string; icono: typeof Bot; children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-edge bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icono className="size-4 text-mist" />
          <h3 className="text-sm font-semibold text-fg">{titulo}</h3>
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

// --- Mensajes masivos: saldo de cortesía (solo lectura, ver /dashboard/campanas para el envío) ---

function SeccionMensajesMasivos({ creditosMasivos }: { creditosMasivos: Detalle["creditosMasivos"] }) {
  if (!creditosMasivos) {
    return (
      <Seccion titulo="Mensajes masivos" icono={Send}>
        <p className="text-sm text-mist">Este cliente todavía no tiene un paquete de mensajes masivos asignado.</p>
      </Seccion>
    );
  }
  const { limite, usados, disponibles } = creditosMasivos;
  return (
    <Seccion titulo="Mensajes masivos" icono={Send}>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-mist">Límite</p>
          <p className="font-semibold tabular-nums text-fg">{limite}</p>
        </div>
        <div>
          <p className="text-xs text-mist">Utilizados</p>
          <p className="font-semibold tabular-nums text-fg">{usados}</p>
        </div>
        <div>
          <p className="text-xs text-mist">Disponibles</p>
          <p className={`font-semibold tabular-nums ${disponibles <= 0 ? "text-red-400" : "text-fg"}`}>{disponibles}</p>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink">
        <div
          className={`h-full rounded-full ${disponibles <= 0 ? "bg-red-500" : "bg-lime"}`}
          style={{ width: `${Math.min(100, Math.round((usados / Math.max(1, limite)) * 100))}%` }}
        />
      </div>
    </Seccion>
  );
}

// --- Onboarding: info recibida + "usar como base para configurar" -----------

function textoOnboardingComoPrompt(onboarding: NonNullable<Detalle["onboarding"]>): string {
  return [
    onboarding.businessDescription ? `Descripción del negocio:\n${onboarding.businessDescription}` : null,
    onboarding.implementationIdea ? `Qué quiere implementar:\n${onboarding.implementationIdea}` : null,
    onboarding.additionalInformation ? `Información adicional:\n${onboarding.additionalInformation}` : null,
  ]
    .filter((p): p is string => Boolean(p))
    .join("\n\n");
}

function SeccionOnboarding({
  onboarding,
  hayAgenteSeleccionado,
  onUsarComoBase,
}: {
  onboarding: Detalle["onboarding"];
  hayAgenteSeleccionado: boolean;
  onUsarComoBase: (texto: string) => void;
}) {
  return (
    <Seccion
      titulo="Información recibida en onboarding"
      icono={FileText}
      accion={
        onboarding && hayAgenteSeleccionado ? (
          <button
            onClick={() => onUsarComoBase(textoOnboardingComoPrompt(onboarding))}
            className="flex items-center gap-1.5 rounded-lg border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-semibold text-lime-text transition-colors hover:bg-lime/15"
          >
            <Wand2 className="size-3.5" />
            Usar como base para configurar
          </button>
        ) : undefined
      }
    >
      {onboarding ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <Bloque label="Descripción del negocio" texto={onboarding.businessDescription} />
          <Bloque label="Qué quiere implementar" texto={onboarding.implementationIdea} />
          <Bloque label="Información adicional" texto={onboarding.additionalInformation} />
        </div>
      ) : (
        <p className="text-sm text-mist">Sin onboarding todavía.</p>
      )}
      {onboarding && !hayAgenteSeleccionado && (
        <p className="mt-3 text-xs text-mist">Crea un agente en la sección de abajo para poder usar esta información como base.</p>
      )}
    </Seccion>
  );
}

// --- Soluciones (Marketplace en cortesía) ------------------------------------

function ConfirmarCortesia({
  agente,
  numeroDefecto,
  guardando,
  onCancelar,
  onConfirmar,
}: {
  agente: AgenteMarketplaceVista;
  numeroDefecto: NumeroAdmin;
  guardando: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  return (
    <div className="mt-3 rounded-lg border border-lime/30 bg-lime/5 p-4">
      <p className="text-sm text-fg">
        ¿Activar <strong>&quot;{agente.nombre}&quot;</strong> en cortesía para {numeroDefecto.nombreNegocio} ({formatearTelefono(numeroDefecto.telefonoNegocio)})?
      </p>
      <p className="mt-1 text-xs text-mist">Esto no realizará ningún cobro al cliente.</p>
      <label className="mt-3 block">
        <span className="font-mono text-[10.5px] uppercase tracking-widest text-mist">Motivo</span>
        <input
          autoFocus
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ej. Incluido en implementación, Prueba, Cortesía comercial…"
          maxLength={200}
          className="mt-1.5 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-lime/50"
        />
      </label>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => onConfirmar(motivo)}
          disabled={guardando || !motivo.trim()}
          className="rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {guardando ? "Activando…" : "Activar"}
        </button>
        <button onClick={onCancelar} disabled={guardando} className="rounded-lg px-4 py-2 text-xs font-medium text-mist hover:bg-ink disabled:opacity-50">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function SeccionSoluciones({ idTenant, accessToken }: { idTenant: string; accessToken: string }) {
  const [data, setData] = useState<MarketplaceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmandoSlug, setConfirmandoSlug] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const cargar = useCallback(() => {
    fetch(`/api/dashboard/admin/clientes/${idTenant}/marketplace`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Error cargando soluciones");
        setData(json);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [idTenant, accessToken]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const activar = useCallback(
    async (slug: string, phoneNumberId: string, motivo: string) => {
      setGuardando(true);
      setMensaje(null);
      try {
        const res = await fetch(`/api/dashboard/admin/clientes/${idTenant}/marketplace`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ slug, phone_number_id: phoneNumberId, motivo }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "No se pudo activar");
        setMensaje(json.mensaje ?? "Solución activada correctamente.");
        setConfirmandoSlug(null);
        cargar();
      } catch (err) {
        setMensaje(err instanceof Error ? err.message : String(err));
      } finally {
        setGuardando(false);
      }
    },
    [idTenant, accessToken, cargar]
  );

  if (error) return <Seccion titulo="Soluciones" icono={ShoppingBag}><p className="text-sm text-red-400">{error}</p></Seccion>;
  if (!data) return <Seccion titulo="Soluciones" icono={ShoppingBag}><p className="text-sm text-mist">Cargando…</p></Seccion>;

  const numeroDefecto = data.numeros[0] ?? null;

  return (
    <Seccion titulo="Soluciones" icono={ShoppingBag}>
      {!numeroDefecto && (
        <p className="mb-3 rounded-lg border border-edge bg-ink p-3 text-xs leading-relaxed text-mist">
          Este cliente todavía no tiene WhatsApp conectado — no se puede activar ninguna solución hasta que conecte un número.
        </p>
      )}
      {mensaje && <p className="mb-3 text-xs text-mist">{mensaje}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data.agentes.map((a) => (
          <div key={a.slug} className="rounded-lg border border-edge bg-ink p-4">
            <div className="flex items-start gap-3">
              <AgenteIcono icono={a.icono} className="size-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">{a.nombre}</p>
                <p className="mt-0.5 text-xs text-mist">{a.categoria}</p>
                {a.activacion ? (
                  <div className="mt-2 flex flex-col gap-1">
                    <Pill tone="success">{a.activacion.esCortesia ? "Activo (cortesía)" : "Activo"}</Pill>
                    <p className="text-[11px] text-mist">
                      en {a.activacion.nombreNegocio}
                      {a.activacion.esCortesia && a.activacion.cortesiaMotivo ? ` — ${a.activacion.cortesiaMotivo}` : ""}
                    </p>
                    {a.activacion.esCortesia && a.activacion.cortesiaActivadaPorEmail && (
                      <p className="text-[11px] text-mist/70">
                        Otorgada por {a.activacion.cortesiaActivadaPorEmail} el {fechaLarga(a.activacion.createdAt)}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="mt-2">
                    <Pill tone="neutral">No activo</Pill>
                  </div>
                )}
              </div>
            </div>

            {!a.activacion && numeroDefecto && confirmandoSlug !== a.slug && (
              <button
                onClick={() => setConfirmandoSlug(a.slug)}
                className="mt-3 w-full rounded-lg border border-dashed border-edge px-3 py-2 text-xs font-semibold text-fg transition-colors hover:border-lime/40"
              >
                Activar en cortesía
              </button>
            )}
            {confirmandoSlug === a.slug && numeroDefecto && (
              <ConfirmarCortesia
                agente={a}
                numeroDefecto={numeroDefecto}
                guardando={guardando}
                onCancelar={() => setConfirmandoSlug(null)}
                onConfirmar={(motivo) => activar(a.slug, numeroDefecto.phoneNumberId, motivo)}
              />
            )}
          </div>
        ))}
      </div>
    </Seccion>
  );
}

// --- Agente de IA -------------------------------------------------------------

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
    [idTenant, agenteId, accessToken, onActualizado]
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
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,.pdf" className="hidden" onChange={(e) => { const archivo = e.target.files?.[0]; if (archivo) subirArchivo(archivo); }} />
      <button onClick={() => inputRef.current?.click()} disabled={subiendo} className="mt-3 rounded-lg border border-edge px-4 py-2 text-xs font-semibold text-fg transition-colors hover:border-lime/40 disabled:cursor-not-allowed disabled:opacity-50">
        {subiendo ? "Procesando…" : tieneArchivo ? "Reemplazar archivo" : "Subir archivo"}
      </button>
      {mensaje && <p className="mt-3 text-xs leading-relaxed text-mist">{mensaje}</p>}
    </div>
  );
}

function SeccionAgente({
  idTenant,
  accessToken,
  plantillaPropuesta,
  onConsumirPlantilla,
  onHayAgenteChange,
}: {
  idTenant: string;
  accessToken: string;
  plantillaPropuesta: string | null;
  onConsumirPlantilla: () => void;
  onHayAgenteChange: (hay: boolean) => void;
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
  }, [data, onHayAgenteChange]);

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

  if (error) return <Seccion titulo="Agente de IA" icono={Bot}><p className="text-sm text-red-400">{error}</p></Seccion>;
  if (!data) return <Seccion titulo="Agente de IA" icono={Bot}><p className="text-sm text-mist">Cargando…</p></Seccion>;

  // Selección con fallback al primer agente si todavía no se eligió ninguno
  // -- valor derivado en cada render, sin sincronizarlo vía efecto (mismo
  // patrón que /dashboard/agentes).
  const seleccionado = data.agentes.find((a) => a.id === seleccionadoId) ?? data.agentes[0] ?? null;

  return (
    <Seccion titulo="Agente de IA" icono={Bot}>
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

  // La plantilla del onboarding solo llega aquí cuando el especialista hizo
  // clic explícito en "Usar como base para configurar" (sección de arriba)
  // -- nunca sobrescribe el prompt automáticamente. Se aplica durante el
  // render ("ajustar estado cuando cambia una prop", con un useState que
  // recuerda la última plantilla ya aplicada) en vez de en un efecto, para
  // no llamar setState síncrono dentro de un effect. onConsumirPlantilla()
  // sí vive en un efecto porque actualiza estado del PADRE, no de este
  // componente.
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
    [idTenant, agente.id, accessToken, onActualizado]
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
            className="btn-shine rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
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

// --- WhatsApp -----------------------------------------------------------------

function SeccionWhatsApp({ numeros }: { numeros: NumeroAdmin[] | null }) {
  return (
    <Seccion titulo="WhatsApp" icono={Phone}>
      {numeros === null ? (
        <p className="text-sm text-mist">Cargando…</p>
      ) : numeros.length === 0 ? (
        <p className="rounded-lg border border-edge bg-ink p-3 text-sm text-mist">WhatsApp pendiente de conexión.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {numeros.map((n) => (
            <div key={n.phoneNumberId} className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-ink px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <Phone className="size-3.5 shrink-0 text-mist" />
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg">{n.nombreNegocio}</p>
                  <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{formatearTelefono(n.telefonoNegocio)}</p>
                </div>
              </div>
              <Pill tone={n.conectado ? "success" : "neutral"}>{n.conectado ? "Conectado" : "Pendiente"}</Pill>
            </div>
          ))}
        </div>
      )}
    </Seccion>
  );
}

// --- Página principal -----------------------------------------------------------

export default function DetalleClientePage() {
  const params = useParams<{ idTenant: string }>();
  const { session } = useDashboard();
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [numerosWhatsApp, setNumerosWhatsApp] = useState<NumeroAdmin[] | null>(null);
  const [hayAgente, setHayAgente] = useState(false);
  const [plantillaPropuesta, setPlantillaPropuesta] = useState<string | null>(null);

  const cargar = useCallback(() => {
    if (!session) return;
    fetch(`/api/dashboard/admin/clientes/${params.idTenant}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error cargando el cliente");
        setDetalle(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session, params.idTenant]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // El bloque de WhatsApp reutiliza los mismos números que ya trae la
  // sección de Agente (misma consulta, un solo fetch adicional para toda la
  // página, no uno por sección).
  useEffect(() => {
    if (!session) return;
    fetch(`/api/dashboard/admin/clientes/${params.idTenant}/agente`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setNumerosWhatsApp(data.numeros ?? []))
      .catch(() => setNumerosWhatsApp([]));
  }, [session, params.idTenant]);

  async function cambiarEstado(nuevoEstado: string) {
    if (!session) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/admin/clientes/${params.idTenant}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ estado_implementacion: nuevoEstado }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo cambiar el estado");
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  if (error && !detalle) {
    return (
      <div>
        <PageHeader eyebrow="Panel de Operaciones" title="Cliente" />
        <div className="px-4 py-6 md:px-8">
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>
        </div>
      </div>
    );
  }
  if (!detalle || !session) {
    return (
      <div>
        <PageHeader eyebrow="Panel de Operaciones" title="Cliente" />
        <div className="px-4 py-6 md:px-8">
          <p className="text-sm text-mist">Cargando…</p>
        </div>
      </div>
    );
  }

  const { cliente, onboarding, implementacion, creditosMasivos } = detalle;
  const accessToken = session.access_token;

  return (
    <div>
      <PageHeader eyebrow="Panel de Operaciones" title={cliente.nombre ?? "Cliente sin nombre"} description={cliente.correo ?? undefined}>
        {onboarding && (
          <Link
            href={`/dashboard/mensajes?phone_number_id=${onboarding.phoneNumberId}&telefono_cliente=${onboarding.telefonoCliente}`}
            className="btn-shine inline-flex items-center gap-2 rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-lime-fg transition-colors hover:bg-lime-hover"
          >
            <MessagesSquare className="size-4" />
            Ver conversación
          </Link>
        )}
      </PageHeader>

      <div className="flex flex-col gap-5 px-4 py-6 md:px-8">
        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}

        <Seccion titulo="Cliente" icono={FileText}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Bloque label="Nombre" texto={cliente.nombre} />
            <Bloque label="Correo" texto={cliente.correo} />
            <Bloque label="WhatsApp" texto={cliente.telefono ? formatearTelefono(cliente.telefono) : null} />
            <Bloque label="Plan" texto={PLANES[resolverPlanId(cliente.plan)].nombre} />
            <Bloque label="Fecha de compra" texto={fechaLarga(cliente.fechaCompra)} />
            <div>
              <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">Estado del pago</p>
              <div className="mt-1.5">
                <Pill tone={toneEstadoPago(cliente.estadoPago)}>{labelEstadoPago(cliente.estadoPago)}</Pill>
              </div>
            </div>
          </div>
        </Seccion>

        <SeccionMensajesMasivos creditosMasivos={creditosMasivos} />

        <SeccionOnboarding onboarding={onboarding} hayAgenteSeleccionado={hayAgente} onUsarComoBase={setPlantillaPropuesta} />

        <SeccionSoluciones idTenant={params.idTenant} accessToken={accessToken} />

        <SeccionAgente
          idTenant={params.idTenant}
          accessToken={accessToken}
          plantillaPropuesta={plantillaPropuesta}
          onConsumirPlantilla={() => setPlantillaPropuesta(null)}
          onHayAgenteChange={setHayAgente}
        />

        <SeccionWhatsApp numeros={numerosWhatsApp} />

        <Seccion titulo="Implementación" icono={ListChecks}>
          {implementacion && (
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {SIGUIENTE_ACCION[implementacion.estado] && (
                <button
                  disabled={guardando}
                  onClick={() => cambiarEstado(SIGUIENTE_ACCION[implementacion.estado]!.siguienteEstado)}
                  className="btn-shine rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-lime-fg transition-colors hover:bg-lime-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {SIGUIENTE_ACCION[implementacion.estado]!.label}
                </button>
              )}
              {implementacion.estado !== "REQUIERE_ATENCION" && (
                <button
                  disabled={guardando}
                  onClick={() => cambiarEstado("REQUIERE_ATENCION")}
                  className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Marcar requiere atención
                </button>
              )}
            </div>
          )}

          <div className="mb-4">
            <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">O elige el estado directamente</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {ESTADOS_IMPLEMENTACION.map((e) => (
                <button key={e} disabled={guardando || !implementacion || implementacion.estado === e} onClick={() => cambiarEstado(e)} className="disabled:cursor-not-allowed">
                  <Pill
                    tone={toneEstadoImplementacion(e)}
                    className={!implementacion ? "opacity-40" : implementacion.estado === e ? "ring-1 ring-lime/60" : "opacity-60 hover:opacity-100"}
                  >
                    {labelEstadoImplementacion(e)}
                  </Pill>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Bloque label="Fecha de inicio" texto={fechaLarga(implementacion?.iniciadaAt ?? null)} />
            <Bloque label="Fecha de activación" texto={fechaLarga(implementacion?.activadaAt ?? null)} />
            <Bloque label="Última actualización" texto={fechaLarga(implementacion?.actualizadoAt ?? null)} />
          </div>
          {!implementacion && (
            <p className="mt-3 text-xs text-mist">
              Este cliente todavía no tiene sesión de onboarding (no se le pudo enviar la bienvenida — revisa si tiene WhatsApp guardado).
            </p>
          )}
          {onboarding && (
            <div className="mt-4 border-t border-edge pt-4">
              <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">Estado de onboarding</p>
              <div className="mt-1.5">
                <Pill tone="info">{labelEstadoOnboarding(onboarding.estado)}</Pill>
              </div>
            </div>
          )}
        </Seccion>
      </div>
    </div>
  );
}
