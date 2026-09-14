"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MessagesSquare, Search, Send, Tag, Plus, Paperclip, X, FileText, LayoutTemplate } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatearTelefono } from "@/lib/format";
import { Pill } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";

type Etiqueta = { id: number; nombre: string; color: string };

type EstadoConversacion = "open" | "pending" | "closed";

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
  /** Fase 9 (Human Inbox, autorizado) — puede faltar si la migración de estado no está aplicada (el backend ya cae a 'open' por defecto, pero se tolera undefined igual por robustez). */
  estado?: EstadoConversacion;
  no_leidos?: number;
};

type RespuestaRapida = { id: number; atajo: string; mensaje: string };

// Fase 11 (Debt Zero, autorizado) — F9 dejó la reasignación completa
// implementada en el backend (POST /api/dashboard/conversaciones/asignar
// ya soporta reasignar a CUALQUIER miembro del equipo, con la restricción
// de rol ya aplicada server-side: un agente no-admin solo puede
// asignarse/quitarse a sí mismo) pero la UI solo exponía "Asignarme"/
// "Quitarme". Reutiliza EXACTAMENTE ese mismo endpoint -- ningún cambio de
// API, solo el picker que faltaba.
type MiembroEquipoLigero = { id: number; email: string; nombre: string | null; estado: "invitado" | "activo" | "suspendido" };

// Fase 11 (Debt Zero, autorizado) — F8 ya soporta enviar plantillas
// aprobadas (campañas, lib/meta-templates.ts) pero el Inbox solo tenía un
// composer de texto libre. Reutiliza GET /api/plantillas (ya existe, ya
// filtrado por tenant) tal cual -- nada nuevo del lado de lectura.
type PlantillaAprobada = {
  id: number;
  phone_number_id: string;
  nombre: string;
  idioma: string;
  cuerpo: string;
  estado: string;
  header_formato?: string | null;
};

type Filtro = "todas" | "mias" | "sin_asignar" | "abiertas" | "pendientes" | "cerradas" | "ia" | "humano";

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
  // useSearchParams exige un límite de Suspense (deep-link opcional desde el
  // Panel de Operaciones: /dashboard/mensajes?phone_number_id=...&telefono_cliente=...).
  return (
    <Suspense fallback={null}>
      <MensajesPageInterna />
    </Suspense>
  );
}

function MensajesPageInterna() {
  const { session, negocios, rol, miembroId } = useDashboard();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [conversaciones, setConversaciones] = useState<Conversacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [etiquetaFiltro, setEtiquetaFiltro] = useState<number | null>(null);
  const [seleccionadaClave, setSeleccionadaClave] = useState<string | null>(() => {
    const phoneNumberId = searchParams.get("phone_number_id");
    const telefonoCliente = searchParams.get("telefono_cliente");
    return phoneNumberId && telefonoCliente ? `${phoneNumberId}:${telefonoCliente}` : null;
  });
  const [hilo, setHilo] = useState<MensajeHilo[] | null>(null);

  // Se deriva de `conversaciones` en cada render (en vez de guardarse aparte)
  // para que siempre refleje la asignación/pausa/etiquetas más recientes sin
  // necesitar un efecto que la sincronice.
  const seleccionada = conversaciones?.find((c) => `${c.phone_number_id}:${c.telefono_cliente}` === seleccionadaClave) ?? null;

  // FASE F12 (Debt Zero, autorizado) — paginación real (keyset por
  // `ultima_fecha`, ver app/api/dashboard/conversaciones/route.ts): antes,
  // esta lista siempre traía la misma primera página sin forma de pedir la
  // siguiente. `siguienteCursor` viene del backend (null = no hay más).
  const [siguienteCursor, setSiguienteCursor] = useState<string | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);

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
        setSiguienteCursor(data.siguiente_cursor ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session, filtro, etiquetaFiltro]);

  const cargarMasConversaciones = useCallback(() => {
    if (!session || !siguienteCursor || cargandoMas) return;
    setCargandoMas(true);
    const params = new URLSearchParams({ filtro, cursor: siguienteCursor });
    if (etiquetaFiltro) params.set("etiqueta_id", String(etiquetaFiltro));
    fetch(`/api/dashboard/conversaciones?${params}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setConversaciones((prev) => [...(prev ?? []), ...(data.conversaciones ?? [])]);
        setSiguienteCursor(data.siguiente_cursor ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCargandoMas(false));
  }, [session, filtro, etiquetaFiltro, siguienteCursor, cargandoMas]);

  useEffect(() => {
    cargarConversaciones();
  }, [cargarConversaciones]);

  // Ref siempre apuntando a la versión más reciente de cargarConversaciones
  // -- la suscripción de Realtime de más abajo se crea UNA vez por sesión
  // (no se re-suscribe en cada cambio de filtro), así que necesita leer la
  // función actual (con el filtro/etiqueta vigentes) sin volver a montar el
  // canal cada vez que el agente cambia un filtro.
  const cargarConversacionesRef = useRef(cargarConversaciones);
  useEffect(() => {
    cargarConversacionesRef.current = cargarConversaciones;
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

  // Fase 11 (Debt Zero) — equipo del tenant, para el picker de reasignación.
  // Mismo endpoint que ya usa app/dashboard/equipo/page.tsx -- lectura
  // también puede verlo (asignar sigue bloqueado server-side para lectura).
  const [equipo, setEquipo] = useState<MiembroEquipoLigero[] | null>(null);
  useEffect(() => {
    if (!session) return;
    fetch("/api/dashboard/equipo", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setEquipo(data.miembros ?? []))
      .catch(() => setEquipo([]));
  }, [session]);
  const equipoAsignable = (equipo ?? []).filter((m) => m.estado === "activo");

  // Fase 11 (Debt Zero) — plantillas aprobadas del tenant, para el picker
  // de envío de plantillas del Inbox (fuera de la ventana de 24h).
  const [plantillas, setPlantillas] = useState<PlantillaAprobada[] | null>(null);
  useEffect(() => {
    if (!session || rol === "lectura") return;
    fetch("/api/plantillas", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setPlantillas(data.plantillas ?? []))
      .catch(() => setPlantillas([]));
  }, [session, rol]);

  // Respuestas rápidas — solo admin/agente las usan (lectura no envía mensajes).
  const [respuestasRapidas, setRespuestasRapidas] = useState<RespuestaRapida[]>([]);
  useEffect(() => {
    if (!session || rol === "lectura") return;
    fetch("/api/dashboard/respuestas-rapidas", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setRespuestasRapidas(data.respuestas ?? []))
      .catch(() => setRespuestasRapidas([]));
  }, [session, rol]);

  // Fase 9 (Human Inbox, autorizado) — marcar como leída al abrir. Best
  // effort a propósito (no bloquea ni muestra error): si la migración de
  // estado todavía no está aplicada, el endpoint responde 503 y acá se
  // ignora en silencio -- el resto del Inbox sigue funcionando igual.
  useEffect(() => {
    if (!session || !seleccionadaClave) return;
    const [phoneNumberId, telefonoCliente] = seleccionadaClave.split(":");
    fetch("/api/dashboard/conversaciones/leido", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ phone_number_id: phoneNumberId, telefono_cliente: telefonoCliente }),
    }).catch(() => {});
  }, [session, seleccionadaClave]);

  // Fase 11 (Debt Zero, autorizado) — Realtime: F9 dejó el Inbox con
  // refresco 100% manual. `refrescarTick` lo dispara la suscripción de
  // Supabase Realtime de más abajo (nuevo mensaje/evento/estado real),
  // recargando este mismo hilo sin que el agente tenga que tocar nada.
  const [refrescarTick, setRefrescarTick] = useState(0);

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
  }, [session, seleccionada, refrescarTick]);

  // Fase 11 (Debt Zero, autorizado) — suscripción real a Supabase Realtime
  // (Postgres Changes), no un sistema de websockets propio. Sin filtro por
  // phone_number_id a propósito: Realtime Authorization ya aplica las
  // MISMAS políticas RLS reales de estas tablas (ver la migración
  // 20261002000000_dulabs_inbox_realtime.sql, que verificó que
  // tenant_select ya resuelve el tenant vía membresía de equipo real, no
  // auth.uid() literal) -- un agente JAMÁS recibe eventos de otro tenant,
  // Postgres los descarta del lado del servidor antes de que lleguen al
  // navegador. Un solo canal para las 3 tablas relevantes (mensaje nuevo,
  // handoff/asignación/reasignación, cambio de estado open/pending/closed);
  // cada evento simplemente recarga la lista (y el hilo abierto, si aplica)
  // -- nunca intenta reconciliar el payload a mano, para no arriesgar un
  // estado desincronizado del que ya calculan las APIs reales.
  useEffect(() => {
    if (!session) return;
    let cancelado = false;
    let temporizador: ReturnType<typeof setTimeout> | null = null;
    const disparar = () => {
      if (cancelado) return;
      // Debounce corto -- una ráfaga de varios mensajes/eventos seguidos
      // (ej. un lote de campaña llegando) dispara UN solo refresco, no uno
      // por fila.
      if (temporizador) clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        if (cancelado) return;
        cargarConversacionesRef.current();
        setRefrescarTick((v) => v + 1);
      }, 400);
    };

    const supabase = supabaseBrowser();
    const canal = supabase
      .channel(`inbox-realtime-${session.user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dulabs_mensajes_log" }, disparar)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dulabs_conversacion_eventos" }, disparar)
      .on("postgres_changes", { event: "*", schema: "public", table: "dulabs_conversacion_estado" }, disparar)
      .subscribe();

    return () => {
      cancelado = true;
      if (temporizador) clearTimeout(temporizador);
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  const [textoRespuesta, setTextoRespuesta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [fueraDeVentana, setFueraDeVentana] = useState(false);

  // Fase 11 (Completion & Debt Zero, autorizado) — adjuntar media desde el
  // composer, reutilizando el pipeline real de F8 (POST /api/dashboard/mensajes/media
  // sube a Meta y devuelve media_id; POST /api/dashboard/mensajes ya sabe
  // enviarlo -- ver ese archivo). image/video/audio/document por tipo MIME;
  // un webp se trata como sticker (mismo criterio que usa Meta para
  // distinguirlo de una imagen normal).
  const [archivoAdjunto, setArchivoAdjunto] = useState<File | null>(null);
  const [subiendoArchivo, setSubiendoArchivo] = useState(false);
  const inputArchivoRef = useRef<HTMLInputElement>(null);

  // Fase 11 (Debt Zero) — picker de plantillas.
  const [mostrarPlantillas, setMostrarPlantillas] = useState(false);
  const [plantillaSeleccionadaId, setPlantillaSeleccionadaId] = useState<number | null>(null);
  const [variablesPlantilla, setVariablesPlantilla] = useState<string[]>([]);
  const [enviandoPlantilla, setEnviandoPlantilla] = useState(false);
  const [errorPlantilla, setErrorPlantilla] = useState<string | null>(null);

  const plantillasDelNumero = (plantillas ?? []).filter(
    (p) => p.estado === "APPROVED" && p.phone_number_id === seleccionada?.phone_number_id,
  );
  const plantillaSeleccionada = plantillasDelNumero.find((p) => p.id === plantillaSeleccionadaId) ?? null;
  const numeroVariables = plantillaSeleccionada ? (plantillaSeleccionada.cuerpo.match(/\{\{\d+\}\}/g)?.length ?? 0) : 0;
  const previsualizacionPlantilla = plantillaSeleccionada
    ? variablesPlantilla.reduce((acc, valor, i) => acc.replaceAll(`{{${i + 1}}}`, valor || `{{${i + 1}}}`), plantillaSeleccionada.cuerpo)
    : "";

  // Nota: funciones planas (no useCallback) a propósito -- dependen de
  // valores derivados en cada render (plantillaSeleccionada,
  // previsualizacionPlantilla) que el compilador de React no puede
  // memoizar de forma estable; solo se usan como handlers de botones, no
  // como dependencia de ningún efecto, así que no hace falta useCallback acá.
  function abrirPlantillas() {
    setMostrarPlantillas((v) => !v);
    setErrorPlantilla(null);
  }

  function elegirPlantilla(id: number | null) {
    setPlantillaSeleccionadaId(id);
    const p = plantillasDelNumero.find((x) => x.id === id);
    const n = p ? (p.cuerpo.match(/\{\{\d+\}\}/g)?.length ?? 0) : 0;
    setVariablesPlantilla(Array.from({ length: n }, () => ""));
    setErrorPlantilla(null);
  }

  async function enviarPlantillaSeleccionada() {
    if (!session || !seleccionada || !plantillaSeleccionada) return;
    setEnviandoPlantilla(true);
    setErrorPlantilla(null);
    try {
      const res = await fetch("/api/dashboard/mensajes/plantilla", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          phone_number_id: seleccionada.phone_number_id,
          telefono_cliente: seleccionada.telefono_cliente,
          plantilla_id: plantillaSeleccionada.id,
          variables: variablesPlantilla,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("Error enviando la plantilla", "Error sending the template"));
      setHilo((prev) => [...(prev ?? []), { direccion: "saliente", contenido: previsualizacionPlantilla, created_at: new Date().toISOString() }]);
      setMostrarPlantillas(false);
      setPlantillaSeleccionadaId(null);
      setVariablesPlantilla([]);
      cargarConversaciones();
    } catch (err) {
      setErrorPlantilla(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviandoPlantilla(false);
    }
  }

  const TAMANO_MAXIMO_MB = 16;
  function tipoMediaDeArchivo(archivo: File): "image" | "video" | "audio" | "document" | "sticker" {
    if (archivo.type === "image/webp") return "sticker";
    if (archivo.type.startsWith("image/")) return "image";
    if (archivo.type.startsWith("video/")) return "video";
    if (archivo.type.startsWith("audio/")) return "audio";
    return "document";
  }

  const seleccionarArchivo = useCallback(
    (archivo: File | null) => {
      setErrorEnvio(null);
      if (!archivo) {
        setArchivoAdjunto(null);
        return;
      }
      if (archivo.size > TAMANO_MAXIMO_MB * 1024 * 1024) {
        setErrorEnvio(t(`El archivo no puede superar ${TAMANO_MAXIMO_MB}MB.`, `File can't exceed ${TAMANO_MAXIMO_MB}MB.`));
        return;
      }
      setArchivoAdjunto(archivo);
    },
    [t]
  );

  const enviarMensaje = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!session || !seleccionada) return;
      const texto = textoRespuesta.trim();
      if (!texto && !archivoAdjunto) return;
      setEnviando(true);
      setErrorEnvio(null);
      setFueraDeVentana(false);
      try {
        let mediaPayload: { tipo: string; media_id: string; caption?: string; filename?: string; mime_type?: string; tamano_bytes?: number } | undefined;

        if (archivoAdjunto) {
          setSubiendoArchivo(true);
          const tipo = tipoMediaDeArchivo(archivoAdjunto);
          const form = new FormData();
          form.set("phone_number_id", seleccionada.phone_number_id);
          form.set("tipo", tipo);
          form.set("archivo", archivoAdjunto);
          const resSubida = await fetch("/api/dashboard/mensajes/media", {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: form,
          });
          const dataSubida = await resSubida.json();
          setSubiendoArchivo(false);
          if (!resSubida.ok) throw new Error(dataSubida.error ?? t("Error subiendo el archivo", "Error uploading the file"));
          mediaPayload = {
            tipo,
            media_id: dataSubida.media_id,
            caption: texto || undefined,
            filename: tipo === "document" ? archivoAdjunto.name : undefined,
            mime_type: dataSubida.mime_type,
            tamano_bytes: dataSubida.tamano_bytes,
          };
        }

        const res = await fetch("/api/dashboard/mensajes", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            phone_number_id: seleccionada.phone_number_id,
            telefono_cliente: seleccionada.telefono_cliente,
            texto: mediaPayload ? undefined : texto,
            media: mediaPayload,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.fuera_de_ventana) setFueraDeVentana(true);
          throw new Error(data.error ?? t("Error enviando el mensaje", "Error sending the message"));
        }
        setHilo((prev) => [
          ...(prev ?? []),
          { direccion: "saliente", contenido: mediaPayload ? mediaPayload.caption || `[${mediaPayload.tipo}]` : texto, created_at: new Date().toISOString() },
        ]);
        setTextoRespuesta("");
        setArchivoAdjunto(null);
        if (inputArchivoRef.current) inputArchivoRef.current.value = "";
        cargarConversaciones();
      } catch (err) {
        setErrorEnvio(err instanceof Error ? err.message : String(err));
      } finally {
        setEnviando(false);
        setSubiendoArchivo(false);
      }
    },
    [session, seleccionada, textoRespuesta, archivoAdjunto, cargarConversaciones, t]
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

  // Fase 9 (Human Inbox, autorizado) — handoff explícito (tomar/devolver a
  // IA), asignación (a mí/quitar) y cambio de estado (open/pending/closed).
  const [accionEnCurso, setAccionEnCurso] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const ejecutarHandoff = useCallback(
    async (accion: "tomar" | "devolver_a_ia") => {
      if (!session || !seleccionada) return;
      setAccionEnCurso(accion);
      setErrorAccion(null);
      try {
        const res = await fetch("/api/dashboard/conversaciones/handoff", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ phone_number_id: seleccionada.phone_number_id, telefono_cliente: seleccionada.telefono_cliente, accion }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("No se pudo completar la acción.", "Couldn't complete the action."));
        cargarConversaciones();
      } catch (err) {
        setErrorAccion(err instanceof Error ? err.message : String(err));
      } finally {
        setAccionEnCurso(null);
      }
    },
    [session, seleccionada, cargarConversaciones, t]
  );

  const cambiarAsignacion = useCallback(
    async (miembroId: number | null) => {
      if (!session || !seleccionada) return;
      setAccionEnCurso("asignar");
      setErrorAccion(null);
      try {
        const res = await fetch("/api/dashboard/conversaciones/asignar", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ phone_number_id: seleccionada.phone_number_id, telefono_cliente: seleccionada.telefono_cliente, miembro_id: miembroId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("No se pudo actualizar la asignación.", "Couldn't update the assignment."));
        cargarConversaciones();
      } catch (err) {
        setErrorAccion(err instanceof Error ? err.message : String(err));
      } finally {
        setAccionEnCurso(null);
      }
    },
    [session, seleccionada, cargarConversaciones, t]
  );

  const cambiarEstado = useCallback(
    async (estado: EstadoConversacion) => {
      if (!session || !seleccionada) return;
      setAccionEnCurso("estado");
      setErrorAccion(null);
      try {
        const res = await fetch("/api/dashboard/conversaciones/estado", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ phone_number_id: seleccionada.phone_number_id, telefono_cliente: seleccionada.telefono_cliente, estado }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("No se pudo cambiar el estado.", "Couldn't change the status."));
        cargarConversaciones();
      } catch (err) {
        setErrorAccion(err instanceof Error ? err.message : String(err));
      } finally {
        setAccionEnCurso(null);
      }
    },
    [session, seleccionada, cargarConversaciones, t]
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
              <option value="abiertas">{t("Abiertas", "Open")}</option>
              <option value="pendientes">{t("Pendientes", "Pending")}</option>
              <option value="cerradas">{t("Cerradas", "Closed")}</option>
              <option value="ia">{t("IA", "AI")}</option>
              <option value="humano">{t("Humano", "Human")}</option>
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
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!!c.no_leidos && (
                      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-lime px-1 text-[10px] font-semibold text-lime-fg">
                        {c.no_leidos > 99 ? "99+" : c.no_leidos}
                      </span>
                    )}
                    <span className="text-[11px] text-mist">{horaCorta(c.ultima_fecha, t)}</span>
                  </div>
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
          {siguienteCursor && (
            <button
              onClick={cargarMasConversaciones}
              disabled={cargandoMas}
              className="w-full py-3 text-center text-xs font-medium text-mist transition-colors hover:text-fg disabled:opacity-50"
            >
              {cargandoMas ? t("Cargando…", "Loading…") : t("Cargar más", "Load more")}
            </button>
          )}
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
                  {seleccionada.estado && seleccionada.estado !== "open" && (
                    <Pill tone={seleccionada.estado === "closed" ? "neutral" : "warning"}>
                      {seleccionada.estado === "closed" ? t("Cerrada", "Closed") : t("Pendiente", "Pending")}
                    </Pill>
                  )}
                  {seleccionada.asignado_a && (
                    <span className="text-[11px] text-mist">
                      {t("Asignada a", "Assigned to")} <span className="text-fg">{seleccionada.asignado_a.nombre}</span>
                    </span>
                  )}
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
                <div className="flex shrink-0 items-center gap-2">
                  <select
                    value={seleccionada.estado ?? "open"}
                    onChange={(e) => cambiarEstado(e.target.value as EstadoConversacion)}
                    disabled={accionEnCurso === "estado"}
                    className="rounded-lg border border-edge bg-card px-2 py-1.5 text-xs text-fg outline-none focus:border-lime/50 disabled:opacity-50"
                  >
                    <option value="open">{t("Abierta", "Open")}</option>
                    <option value="pending">{t("Pendiente", "Pending")}</option>
                    <option value="closed">{t("Cerrada", "Closed")}</option>
                  </select>
                  {/* Fase 11 (Debt Zero) — picker de reasignación completo.
                      Admin ve a todo el equipo activo; un agente normal solo
                      se ve a sí mismo como opción asignable (el backend ya
                      rechaza cualquier otro intento con 403, pero la UI
                      nunca debe ofrecer una acción que sabe que va a fallar). */}
                  {(() => {
                    const asignadoAOtro =
                      rol !== "admin" &&
                      seleccionada.asignado_a !== null &&
                      seleccionada.asignado_a.miembro_id !== miembroId;
                    const opciones = rol === "admin" ? equipoAsignable : equipoAsignable.filter((m) => m.id === miembroId);
                    return (
                      <select
                        value={seleccionada.asignado_a?.miembro_id ?? ""}
                        onChange={(e) => cambiarAsignacion(e.target.value === "" ? null : Number(e.target.value))}
                        disabled={accionEnCurso === "asignar" || asignadoAOtro}
                        className="max-w-[140px] rounded-lg border border-edge bg-card px-2 py-1.5 text-xs text-fg outline-none focus:border-lime/50 disabled:opacity-50"
                        title={asignadoAOtro ? t("Asignada a otro agente", "Assigned to another agent") : t("Asignar conversación", "Assign conversation")}
                      >
                        <option value="">{t("Sin asignar", "Unassigned")}</option>
                        {opciones.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.id === miembroId ? t("Yo", "Me") : m.nombre || m.email}
                          </option>
                        ))}
                      </select>
                    );
                  })()}
                  {seleccionada.pausado ? (
                    <button
                      onClick={() => ejecutarHandoff("devolver_a_ia")}
                      disabled={accionEnCurso === "devolver_a_ia"}
                      className="rounded-lg border border-lime/40 bg-lime/10 px-2.5 py-1.5 text-xs font-semibold text-lime-text transition-colors hover:bg-lime/15 disabled:opacity-50"
                    >
                      {accionEnCurso === "devolver_a_ia" ? t("Devolviendo…", "Returning…") : t("Devolver a IA", "Return to AI")}
                    </button>
                  ) : (
                    <button
                      onClick={() => ejecutarHandoff("tomar")}
                      disabled={accionEnCurso === "tomar"}
                      className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-500 transition-colors hover:bg-amber-500/15 disabled:opacity-50"
                    >
                      {accionEnCurso === "tomar" ? t("Tomando…", "Taking…") : t("Tomar conversación", "Take conversation")}
                    </button>
                  )}
                  <div className="relative">
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
                </div>
              )}
            </div>
            {errorAccion && <p className="border-b border-edge bg-red-500/5 px-5 py-2 text-xs text-red-400">{errorAccion}</p>}
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
                <>
                {mostrarPlantillas && (
                  <div className="mb-2 rounded-lg border border-edge bg-card p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-fg">{t("Enviar plantilla", "Send template")}</p>
                      <button type="button" onClick={() => setMostrarPlantillas(false)} className="rounded p-0.5 hover:bg-ink">
                        <X className="size-3.5" />
                      </button>
                    </div>
                    {plantillasDelNumero.length === 0 ? (
                      <p className="mt-2 text-xs text-mist">
                        {t("Este número no tiene plantillas aprobadas todavía.", "This number has no approved templates yet.")}{" "}
                        <Link href="/dashboard/plantillas" className="underline hover:text-fg">
                          {t("Crear una →", "Create one →")}
                        </Link>
                      </p>
                    ) : (
                      <>
                        <select
                          value={plantillaSeleccionadaId ?? ""}
                          onChange={(e) => elegirPlantilla(e.target.value ? Number(e.target.value) : null)}
                          className="mt-2 w-full rounded-lg border border-edge bg-ink px-2 py-1.5 text-xs text-fg outline-none focus:border-lime/50"
                        >
                          <option value="">{t("Elige una plantilla…", "Choose a template…")}</option>
                          {plantillasDelNumero.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nombre}
                            </option>
                          ))}
                        </select>
                        {plantillaSeleccionada && (
                          <div className="mt-2 space-y-2">
                            {Array.from({ length: numeroVariables }, (_, i) => (
                              <input
                                key={i}
                                value={variablesPlantilla[i] ?? ""}
                                onChange={(e) => {
                                  const copia = [...variablesPlantilla];
                                  copia[i] = e.target.value;
                                  setVariablesPlantilla(copia);
                                }}
                                placeholder={t(`Variable {{${i + 1}}}`, `Variable {{${i + 1}}}`)}
                                className="w-full rounded-lg border border-edge bg-ink px-2 py-1.5 text-xs text-fg outline-none placeholder:text-mist focus:border-lime/50"
                              />
                            ))}
                            <div className="rounded-lg bg-ink p-2 text-xs text-mist">{previsualizacionPlantilla}</div>
                            {errorPlantilla && <p className="text-xs text-red-400">{errorPlantilla}</p>}
                            <button
                              type="button"
                              onClick={enviarPlantillaSeleccionada}
                              disabled={enviandoPlantilla || variablesPlantilla.some((v) => !v.trim())}
                              className="w-full rounded-lg bg-lime px-3 py-1.5 text-xs font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {enviandoPlantilla ? t("Enviando…", "Sending…") : t("Enviar plantilla", "Send template")}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
                <form onSubmit={enviarMensaje} className="flex flex-col gap-2">
                  {archivoAdjunto && (
                    <div className="flex items-center gap-2 rounded-lg border border-edge bg-ink px-3 py-2 text-xs text-mist">
                      <FileText className="size-3.5 shrink-0" />
                      <span className="truncate text-fg">{archivoAdjunto.name}</span>
                      <span className="shrink-0">({(archivoAdjunto.size / 1024).toFixed(0)} KB)</span>
                      <button
                        type="button"
                        onClick={() => seleccionarArchivo(null)}
                        className="ml-auto shrink-0 rounded p-0.5 hover:bg-card"
                        title={t("Quitar archivo", "Remove file")}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <input
                      ref={inputArchivoRef}
                      type="file"
                      className="hidden"
                      accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                      onChange={(e) => seleccionarArchivo(e.target.files?.[0] ?? null)}
                    />
                    <button
                      type="button"
                      onClick={() => inputArchivoRef.current?.click()}
                      disabled={enviando}
                      title={t("Adjuntar archivo", "Attach file")}
                      className="flex h-11 shrink-0 items-center justify-center rounded-lg border border-edge px-3 text-mist transition-colors hover:bg-ink disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Paperclip className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={abrirPlantillas}
                      disabled={enviando}
                      title={t("Enviar plantilla", "Send template")}
                      className={`flex h-11 shrink-0 items-center justify-center rounded-lg border px-3 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        mostrarPlantillas ? "border-lime/40 bg-lime/10 text-lime-text" : "border-edge text-mist hover:bg-ink"
                      }`}
                    >
                      <LayoutTemplate className="size-4" />
                    </button>
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
                        placeholder={
                          archivoAdjunto
                            ? t("Agrega un texto opcional…", "Add an optional caption…")
                            : t('Escribe una respuesta… (usa "/" para respuestas rápidas)', 'Type a reply… (use "/" for quick replies)')
                        }
                        className="h-11 w-full resize-none rounded-lg border border-edge bg-card px-3 py-2.5 text-sm text-fg outline-none placeholder:text-mist focus:border-lime/50"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={enviando || (!textoRespuesta.trim() && !archivoAdjunto)}
                      className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-lime px-4 text-xs font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send className="size-3.5" />
                      {subiendoArchivo ? t("Subiendo…", "Uploading…") : enviando ? t("Enviando…", "Sending…") : t("Enviar", "Send")}
                    </button>
                  </div>
                </form>
                </>
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
