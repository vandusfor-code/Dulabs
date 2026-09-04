"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, CalendarClock } from "lucide-react";
import { PortalLandingAmore } from "@/components/reservar-amore/PortalLandingAmore";
import { PasoSeleccionServicioAmore } from "@/components/reservar-amore/PasoSeleccionServicioAmore";
import { PasoSeleccionProfesionalAmore } from "@/components/reservar-amore/PasoSeleccionProfesionalAmore";
import { PasoSeleccionHorarioAmore } from "@/components/reservar-amore/PasoSeleccionHorarioAmore";
import { PasoDatosClienteAmore, type DatosClienteAmore } from "@/components/reservar-amore/PasoDatosClienteAmore";
import { PasoConfirmacionAmore } from "@/components/reservar-amore/PasoConfirmacionAmore";
import { PasoExitoAmore } from "@/components/reservar-amore/PasoExitoAmore";
import { AMORE } from "@/components/reservar-amore/tema";

// Portal público de reservas de AMORE (Fase 3, autorizado) — consumidor
// puro del MISMO núcleo de reservas ya existente y genérico
// (lib/disponibilidad-servicio.ts vía las rutas de
// app/api/reservar/[tenant]/*, sin ningún cambio de esas rutas para llegar
// hasta acá) -- idéntico contrato de datos que app/reservar/[tenant]/page.tsx
// (el portal de Daniela), pero con AMORE_TENANT_ID fijo en vez de un
// parámetro de ruta dinámico, y con una identidad visual propia (ver
// components/reservar-amore/). Ninguna disponibilidad ni precio ni
// duración se calcula aquí: todo lo que se ve es lo que el backend
// devolvió; al confirmar, el backend vuelve a validar todo desde cero.
//
// Ruta estática ("amore") a propósito, en vez de usar
// app/reservar/[tenant]/page.tsx con el UUID en la URL: Next.js prioriza un
// segmento estático sobre uno dinámico del mismo nivel, así que
// /reservar/amore convive sin conflicto con /reservar/[tenant] -- un
// enlace corto y legible para compartir por WhatsApp, en vez de un UUID.
const AMORE_TENANT_ID = "ed6ae77f-8a0c-483e-a5d9-8ede68eca50f";

const HORIZONTE_DIAS = 30;

type Servicio = {
  id: string;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  duracion_min: number;
  precio: number | null;
  imagen_url: string | null;
};

type EspecialistaOpcion = { id: number; nombre: string };

type Paso = "inicio" | "servicio" | "profesional" | "horario" | "datos" | "confirmar" | "exito";

type Seleccion = {
  servicioId: string | null;
  especialistaId: number | null;
  especialistaNombre: string | null;
  fecha: string | null;
  hora: string | null;
};

type ResultadoExito = { codigo: string; servicio: string; profesional: string; inicio: string; fin: string; duracionMin: number };

const SELECCION_VACIA: Seleccion = { servicioId: null, especialistaId: null, especialistaNombre: null, fecha: null, hora: null };
const DATOS_VACIOS: DatosClienteAmore = { nombre: "", telefono: "", cumpleDia: "", cumpleMes: "" };

function hoyISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}
function fechaMaxima(): string {
  const d = new Date();
  d.setDate(d.getDate() + HORIZONTE_DIAS);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(d);
}
function crearIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

export default function PortalReservasAmorePage() {
  const [cargando, setCargando] = useState(true);
  const [disponible, setDisponible] = useState(true);
  const [negocio, setNegocio] = useState("AMORE");
  const [telefonoNegocio, setTelefonoNegocio] = useState<string | null>(null);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [paso, setPaso] = useState<Paso>("inicio");
  const [seleccion, setSeleccion] = useState<Seleccion>(SELECCION_VACIA);
  const [datos, setDatos] = useState<DatosClienteAmore>(DATOS_VACIOS);

  const [especialistas, setEspecialistas] = useState<EspecialistaOpcion[]>([]);
  const [cargandoEspecialistas, setCargandoEspecialistas] = useState(false);

  const [horarios, setHorarios] = useState<string[]>([]);
  const [cargandoHorarios, setCargandoHorarios] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [errorReserva, setErrorReserva] = useState<string | null>(null);
  const [exito, setExito] = useState<ResultadoExito | null>(null);

  const idempotencyRef = useRef<{ firma: string; clave: string } | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch(`/api/reservar/${AMORE_TENANT_ID}`);
        const body = await res.json();
        if (cancelado) return;
        if (!res.ok) {
          setErrorCarga("No pudimos cargar esta página. Intenta de nuevo más tarde.");
          return;
        }
        setDisponible(body.disponible !== false);
        setNegocio(body.negocio || "AMORE");
        setTelefonoNegocio(body.telefonoNegocio ?? null);
        setServicios(body.servicios ?? []);
      } catch {
        if (!cancelado) setErrorCarga("No pudimos cargar esta página. Verifica tu conexión e intenta de nuevo.");
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const servicioElegido = useMemo(() => servicios.find((s) => s.id === seleccion.servicioId) ?? null, [servicios, seleccion.servicioId]);

  const elegirServicio = useCallback(async (servicio: Servicio) => {
    setSeleccion({ ...SELECCION_VACIA, servicioId: servicio.id });
    setEspecialistas([]);
    setHorarios([]);
    setCargandoEspecialistas(true);
    setPaso("profesional");
    try {
      const res = await fetch(`/api/reservar/${AMORE_TENANT_ID}/especialistas?servicioId=${encodeURIComponent(servicio.id)}`);
      const body = await res.json();
      setEspecialistas(body.especialistas ?? []);
    } finally {
      setCargandoEspecialistas(false);
    }
  }, []);

  const elegirEspecialista = useCallback((op: EspecialistaOpcion) => {
    setSeleccion((s) => ({ ...s, especialistaId: op.id, especialistaNombre: op.nombre, fecha: null, hora: null }));
    setPaso("horario");
  }, []);

  const cargarHorarios = useCallback(
    async (fecha: string) => {
      if (!seleccion.servicioId || !seleccion.especialistaId) return;
      setCargandoHorarios(true);
      setHorarios([]);
      try {
        const qs = new URLSearchParams({ servicioId: seleccion.servicioId, fecha, especialistaId: String(seleccion.especialistaId) });
        const res = await fetch(`/api/reservar/${AMORE_TENANT_ID}/disponibilidad?${qs.toString()}`);
        const body = await res.json();
        const entrada = (body.especialistas ?? [])[0];
        setHorarios(entrada?.horarios ?? []);
      } finally {
        setCargandoHorarios(false);
      }
    },
    [seleccion.servicioId, seleccion.especialistaId]
  );

  const elegirFecha = useCallback(
    (fecha: string) => {
      setSeleccion((s) => ({ ...s, fecha, hora: null }));
      cargarHorarios(fecha);
    },
    [cargarHorarios]
  );

  const elegirHora = useCallback((hora: string) => {
    setSeleccion((s) => ({ ...s, hora }));
    setPaso("datos");
  }, []);

  const irAConfirmar = useCallback(() => {
    if (!datos.nombre.trim() || !datos.telefono.trim()) return;
    setPaso("confirmar");
  }, [datos]);

  function obtenerIdempotencyKey(): string {
    const firma = JSON.stringify([seleccion.servicioId, seleccion.especialistaId, seleccion.fecha, seleccion.hora, datos]);
    if (idempotencyRef.current?.firma !== firma) {
      idempotencyRef.current = { firma, clave: crearIdempotencyKey() };
    }
    return idempotencyRef.current.clave;
  }

  const confirmarReserva = useCallback(async () => {
    if (!seleccion.servicioId || !seleccion.especialistaId || !seleccion.fecha || !seleccion.hora) return;
    setEnviando(true);
    setErrorReserva(null);
    try {
      const res = await fetch(`/api/reservar/${AMORE_TENANT_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          servicioId: seleccion.servicioId,
          especialistaId: seleccion.especialistaId,
          fecha: seleccion.fecha,
          hora: seleccion.hora,
          nombreCliente: datos.nombre.trim(),
          telefonoCliente: datos.telefono.trim(),
          fechaNacimientoDia: datos.cumpleDia ? Number(datos.cumpleDia) : undefined,
          fechaNacimientoMes: datos.cumpleMes ? Number(datos.cumpleMes) : undefined,
          idempotencyKey: obtenerIdempotencyKey(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrorReserva(body.error ?? "Hubo un problema al reservar. Por favor intenta nuevamente.");
        return;
      }
      setExito(body as ResultadoExito);
      setPaso("exito");
    } catch {
      setErrorReserva("No pudimos conectar con el servidor. Verifica tu conexión e intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccion, datos]);

  const volverAHorarioTrasOcupado = useCallback(() => {
    setSeleccion((s) => ({ ...s, hora: null }));
    setErrorReserva(null);
    setPaso("horario");
    if (seleccion.fecha) cargarHorarios(seleccion.fecha);
  }, [seleccion.fecha, cargarHorarios]);

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: AMORE.fondo }}>
        <Loader2 className="size-6 animate-spin" style={{ color: AMORE.textoSecundario }} />
      </div>
    );
  }
  if (errorCarga) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center" style={{ backgroundColor: AMORE.fondo }}>
        <p className="text-sm" style={{ color: AMORE.textoSecundario }}>
          {errorCarga}
        </p>
      </div>
    );
  }
  if (!disponible) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center" style={{ backgroundColor: AMORE.fondo }}>
        <div className="flex size-14 items-center justify-center rounded-2xl" style={{ backgroundColor: AMORE.doradoSuave, color: AMORE.dorado }}>
          <CalendarClock className="size-7" />
        </div>
        <p className="max-w-sm text-sm leading-relaxed" style={{ color: AMORE.textoSecundario }}>
          AMORE no tiene reservas disponibles en este momento.
        </p>
      </div>
    );
  }

  switch (paso) {
    case "inicio":
      return <PortalLandingAmore negocio={negocio} telefonoNegocio={telefonoNegocio} onComenzar={() => setPaso("servicio")} />;
    case "servicio":
      return <PasoSeleccionServicioAmore negocio={negocio} servicios={servicios} onElegir={elegirServicio} onVolver={() => setPaso("inicio")} />;
    case "profesional":
      return (
        <PasoSeleccionProfesionalAmore
          negocio={negocio}
          servicioNombre={servicioElegido?.nombre ?? "servicio"}
          especialistas={especialistas}
          cargando={cargandoEspecialistas}
          especialistaSeleccionadoId={seleccion.especialistaId}
          onElegir={elegirEspecialista}
          onVolver={() => setPaso("servicio")}
        />
      );
    case "horario":
      return servicioElegido ? (
        <PasoSeleccionHorarioAmore
          negocio={negocio}
          servicio={servicioElegido}
          especialistaNombre={seleccion.especialistaNombre}
          fecha={seleccion.fecha}
          fechaMinima={hoyISO()}
          fechaMaxima={fechaMaxima()}
          horarios={horarios}
          cargandoHorarios={cargandoHorarios}
          onSeleccionarFecha={elegirFecha}
          onContinuar={elegirHora}
          onVolver={() => setPaso("profesional")}
        />
      ) : null;
    case "datos":
      return <PasoDatosClienteAmore negocio={negocio} datos={datos} onCambiar={setDatos} onContinuar={irAConfirmar} onVolver={() => setPaso("horario")} />;
    case "confirmar":
      return servicioElegido ? (
        <PasoConfirmacionAmore
          negocio={negocio}
          servicio={servicioElegido}
          especialistaNombre={seleccion.especialistaNombre ?? ""}
          fecha={seleccion.fecha!}
          hora={seleccion.hora!}
          datos={datos}
          enviando={enviando}
          error={errorReserva}
          ocupado={errorReserva !== null && errorReserva.includes("acaba de ser reservado")}
          onConfirmar={confirmarReserva}
          onElegirOtroHorario={volverAHorarioTrasOcupado}
          onVolver={() => setPaso("datos")}
        />
      ) : null;
    case "exito":
      return exito ? <PasoExitoAmore resultado={exito} negocio={negocio} /> : null;
    default:
      return null;
  }
}
