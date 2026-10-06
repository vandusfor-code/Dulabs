"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, CalendarClock } from "lucide-react";
import { PortalLandingAmore } from "@/components/reservar-amore/PortalLandingAmore";
import { PasoSeleccionServicioAmore } from "@/components/reservar-amore/PasoSeleccionServicioAmore";
import { PasoSeleccionProfesionalAmore } from "@/components/reservar-amore/PasoSeleccionProfesionalAmore";
import { PasoSeleccionHorarioAmore } from "@/components/reservar-amore/PasoSeleccionHorarioAmore";
import { PasoDatosClienteAmore, telefonoWhatsappValido, type DatosClienteAmore } from "@/components/reservar-amore/PasoDatosClienteAmore";
import { PasoConfirmacionAmore } from "@/components/reservar-amore/PasoConfirmacionAmore";
import { PasoExitoAmore } from "@/components/reservar-amore/PasoExitoAmore";
import { AMORE } from "@/components/reservar-amore/tema";
import { MAX_SERVICIOS_POR_DEFECTO, mismosServicios, parametroServicioIds, serviciosDeIds, type ServicioDelPortal } from "@/lib/reservar-amore-servicios";

// Portal público de reservas de AMORE (Fase 3, autorizado) — consumidor
// puro del MISMO núcleo de reservas ya existente y genérico
// (lib/disponibilidad-servicio.ts vía las rutas de
// app/api/reservar/[tenant]/*) -- idéntico contrato de datos que
// app/reservar/[tenant]/page.tsx (el portal de Daniela), pero con
// AMORE_TENANT_ID fijo en vez de un parámetro de ruta dinámico, y con una
// identidad visual propia (ver components/reservar-amore/). Ninguna
// disponibilidad ni precio ni duración se calcula aquí: todo lo que se ve
// es lo que el backend devolvió; al confirmar, el backend vuelve a validar
// todo desde cero.
//
// VARIOS SERVICIOS en una sola cita (ej. uñas de manos + de pies): la
// clienta marca los que quiera (hasta `maxServiciosPorCita`, que manda el
// servidor); el backend busca a las profesionales que hacen TODOS, ofrece
// bloques continuos con la duración sumada y crea UNA sola cita. La pantalla
// solo manda la lista de ids (`servicioIds`).
//
// Ruta estática ("amore") a propósito, en vez de usar
// app/reservar/[tenant]/page.tsx con el UUID en la URL: Next.js prioriza un
// segmento estático sobre uno dinámico del mismo nivel, así que
// /reservar/amore convive sin conflicto con /reservar/[tenant] -- un
// enlace corto y legible para compartir por WhatsApp, en vez de un UUID.
const AMORE_TENANT_ID = "ed6ae77f-8a0c-483e-a5d9-8ede68eca50f";

const HORIZONTE_DIAS = 30;

type EspecialistaOpcion = { id: number; nombre: string };

type Paso = "inicio" | "servicio" | "profesional" | "horario" | "datos" | "confirmar" | "exito";

type Seleccion = {
  servicioIds: string[];
  especialistaId: number | null;
  especialistaNombre: string | null;
  fecha: string | null;
  hora: string | null;
};

type ResultadoExito = { codigo: string; servicio: string; profesional: string; inicio: string; fin: string; duracionMin: number; enlaceGestion?: string | null };

const SELECCION_VACIA: Seleccion = { servicioIds: [], especialistaId: null, especialistaNombre: null, fecha: null, hora: null };
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
  const [servicios, setServicios] = useState<ServicioDelPortal[]>([]);
  const [maxServicios, setMaxServicios] = useState(MAX_SERVICIOS_POR_DEFECTO);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [paso, setPaso] = useState<Paso>("inicio");
  const [seleccion, setSeleccion] = useState<Seleccion>(SELECCION_VACIA);
  const [datos, setDatos] = useState<DatosClienteAmore>(DATOS_VACIOS);

  const [especialistas, setEspecialistas] = useState<EspecialistaOpcion[]>([]);
  const [cargandoEspecialistas, setCargandoEspecialistas] = useState(false);
  const [errorEspecialistas, setErrorEspecialistas] = useState(false);
  const [sinProfesionalComun, setSinProfesionalComun] = useState(false);

  const [horarios, setHorarios] = useState<string[]>([]);
  const [cargandoHorarios, setCargandoHorarios] = useState(false);
  const [errorHorarios, setErrorHorarios] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [errorReserva, setErrorReserva] = useState<string | null>(null);
  const [exito, setExito] = useState<ResultadoExito | null>(null);

  const idempotencyRef = useRef<{ firma: string; clave: string } | null>(null);
  // Cada consulta lleva un número: si la clienta cambia de servicio o de fecha mientras una respuesta vieja viaja, esa respuesta se descarta.
  const solicitudEspecialistasRef = useRef(0);
  const solicitudHorariosRef = useRef(0);
  // Servicios para los que ya se cargó la lista de profesionales: si vuelve y no cambió nada, se conserva todo lo ya elegido.
  const serviciosDeEspecialistasRef = useRef<string[]>([]);

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
        if (Number.isInteger(body.maxServiciosPorCita) && body.maxServiciosPorCita >= 1) setMaxServicios(body.maxServiciosPorCita);
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

  // Cada pantalla nueva arranca desde arriba (si no, quedaría a medio desplazar de la anterior). `instant` evita el desplazamiento suave global del sitio.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [paso]);

  const serviciosElegidos = useMemo(() => serviciosDeIds(seleccion.servicioIds, servicios), [seleccion.servicioIds, servicios]);

  const cambiarSeleccionServicios = useCallback((ids: string[]) => {
    setSeleccion((s) => ({ ...s, servicioIds: ids }));
  }, []);

  const cargarEspecialistas = useCallback(async (ids: string[]) => {
    const solicitud = ++solicitudEspecialistasRef.current;
    setEspecialistas([]);
    setSinProfesionalComun(false);
    setErrorEspecialistas(false);
    setCargandoEspecialistas(true);
    try {
      const qs = new URLSearchParams({ servicioIds: parametroServicioIds(ids) });
      const res = await fetch(`/api/reservar/${AMORE_TENANT_ID}/especialistas?${qs.toString()}`);
      const body = await res.json();
      if (solicitud !== solicitudEspecialistasRef.current) return;
      if (!res.ok) {
        setErrorEspecialistas(true);
        return;
      }
      setEspecialistas(body.especialistas ?? []);
      setSinProfesionalComun(body.motivo === "combinacion_sin_profesional");
    } catch {
      if (solicitud === solicitudEspecialistasRef.current) setErrorEspecialistas(true);
    } finally {
      if (solicitud === solicitudEspecialistasRef.current) setCargandoEspecialistas(false);
    }
  }, []);

  // «Continuar» del paso de servicios: busca a las profesionales que hacen TODOS los servicios elegidos.
  const continuarDeServicios = useCallback(() => {
    const ids = serviciosElegidos.map((s) => s.id);
    if (ids.length === 0) return;
    setPaso("profesional");
    // Si vuelve sin haber cambiado nada, se conserva la lista y todo lo que ya había elegido (a menos que la consulta anterior hubiera fallado).
    if (mismosServicios(ids, serviciosDeEspecialistasRef.current) && !errorEspecialistas) return;
    serviciosDeEspecialistasRef.current = ids;
    setSeleccion({ ...SELECCION_VACIA, servicioIds: ids });
    setHorarios([]);
    setErrorHorarios(false);
    void cargarEspecialistas(ids);
  }, [serviciosElegidos, errorEspecialistas, cargarEspecialistas]);

  const elegirEspecialista = useCallback((op: EspecialistaOpcion) => {
    setSeleccion((s) => ({ ...s, especialistaId: op.id, especialistaNombre: op.nombre, fecha: null, hora: null }));
    setHorarios([]);
    setErrorHorarios(false);
    setPaso("horario");
  }, []);

  const cargarHorarios = useCallback(
    async (fecha: string) => {
      if (seleccion.servicioIds.length === 0 || !seleccion.especialistaId) return;
      const solicitud = ++solicitudHorariosRef.current;
      setCargandoHorarios(true);
      setErrorHorarios(false);
      setHorarios([]);
      try {
        const qs = new URLSearchParams({ servicioIds: parametroServicioIds(seleccion.servicioIds), fecha, especialistaId: String(seleccion.especialistaId) });
        const res = await fetch(`/api/reservar/${AMORE_TENANT_ID}/disponibilidad?${qs.toString()}`);
        const body = await res.json();
        if (solicitud !== solicitudHorariosRef.current) return;
        const entrada = (body.especialistas ?? [])[0];
        // Google Calendar no confirmó: nunca se muestra como «sin horarios», porque no es verdad.
        if (!res.ok || entrada?.estado === "no_confirmado") {
          setErrorHorarios(true);
          return;
        }
        setHorarios(entrada?.horarios ?? []);
      } catch {
        if (solicitud === solicitudHorariosRef.current) setErrorHorarios(true);
      } finally {
        if (solicitud === solicitudHorariosRef.current) setCargandoHorarios(false);
      }
    },
    [seleccion.servicioIds, seleccion.especialistaId]
  );

  const elegirFecha = useCallback(
    (fecha: string) => {
      setSeleccion((s) => ({ ...s, fecha, hora: null }));
      void cargarHorarios(fecha);
    },
    [cargarHorarios]
  );

  const elegirHora = useCallback((hora: string) => {
    setSeleccion((s) => ({ ...s, hora }));
    setPaso("datos");
  }, []);

  const irAConfirmar = useCallback(() => {
    if (datos.nombre.trim().length < 2 || !telefonoWhatsappValido(datos.telefono)) return;
    setPaso("confirmar");
  }, [datos]);

  function obtenerIdempotencyKey(): string {
    const firma = JSON.stringify([seleccion.servicioIds, seleccion.especialistaId, seleccion.fecha, seleccion.hora, datos]);
    if (idempotencyRef.current?.firma !== firma) {
      idempotencyRef.current = { firma, clave: crearIdempotencyKey() };
    }
    return idempotencyRef.current.clave;
  }

  const confirmarReserva = useCallback(async () => {
    if (seleccion.servicioIds.length === 0 || !seleccion.especialistaId || !seleccion.fecha || !seleccion.hora) return;
    setEnviando(true);
    setErrorReserva(null);
    try {
      const res = await fetch(`/api/reservar/${AMORE_TENANT_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          servicioIds: seleccion.servicioIds,
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
    if (seleccion.fecha) void cargarHorarios(seleccion.fecha);
  }, [seleccion.fecha, cargarHorarios]);

  if (cargando) {
    return (
      <div className="flex min-h-dvh items-center justify-center" style={{ backgroundColor: AMORE.fondo }}>
        <Loader2 className="size-6 animate-spin" style={{ color: AMORE.textoSecundario }} />
      </div>
    );
  }
  if (errorCarga) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6 text-center" style={{ backgroundColor: AMORE.fondo }}>
        <p className="text-sm" style={{ color: AMORE.textoSecundario }}>
          {errorCarga}
        </p>
      </div>
    );
  }
  if (!disponible) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center" style={{ backgroundColor: AMORE.fondo }}>
        <div className="flex size-14 items-center justify-center rounded-2xl" style={{ backgroundColor: AMORE.doradoSuave, color: AMORE.dorado }}>
          <CalendarClock className="size-7" />
        </div>
        <p className="max-w-sm text-sm leading-relaxed" style={{ color: AMORE.textoSecundario }}>
          AMORE no tiene reservas disponibles en este momento.
        </p>
      </div>
    );
  }

  const pantallaServicios = (
    <PasoSeleccionServicioAmore
      negocio={negocio}
      servicios={servicios}
      seleccionIds={seleccion.servicioIds}
      maxServicios={maxServicios}
      onCambiarSeleccion={cambiarSeleccionServicios}
      onContinuar={continuarDeServicios}
      onVolver={() => setPaso("inicio")}
    />
  );

  switch (paso) {
    case "inicio":
      return <PortalLandingAmore negocio={negocio} telefonoNegocio={telefonoNegocio} onComenzar={() => setPaso("servicio")} />;
    case "servicio":
      return pantallaServicios;
    case "profesional":
      return serviciosElegidos.length > 0 ? (
        <PasoSeleccionProfesionalAmore
          negocio={negocio}
          servicios={serviciosElegidos}
          especialistas={especialistas}
          cargando={cargandoEspecialistas}
          errorCarga={errorEspecialistas}
          sinProfesionalComun={sinProfesionalComun}
          especialistaSeleccionadoId={seleccion.especialistaId}
          onElegir={elegirEspecialista}
          onReintentar={() => void cargarEspecialistas(serviciosDeEspecialistasRef.current)}
          onCambiarServicios={() => setPaso("servicio")}
          onVolver={() => setPaso("servicio")}
        />
      ) : (
        pantallaServicios
      );
    case "horario":
      return serviciosElegidos.length > 0 ? (
        <PasoSeleccionHorarioAmore
          negocio={negocio}
          servicios={serviciosElegidos}
          especialistaNombre={seleccion.especialistaNombre}
          fecha={seleccion.fecha}
          hora={seleccion.hora}
          fechaMinima={hoyISO()}
          fechaMaxima={fechaMaxima()}
          horarios={horarios}
          cargandoHorarios={cargandoHorarios}
          errorHorarios={errorHorarios}
          onSeleccionarFecha={elegirFecha}
          onReintentar={() => seleccion.fecha && void cargarHorarios(seleccion.fecha)}
          onContinuar={elegirHora}
          onVolver={() => setPaso("profesional")}
        />
      ) : (
        pantallaServicios
      );
    case "datos":
      return <PasoDatosClienteAmore negocio={negocio} datos={datos} onCambiar={setDatos} onContinuar={irAConfirmar} onVolver={() => setPaso("horario")} />;
    case "confirmar":
      return serviciosElegidos.length > 0 && seleccion.fecha && seleccion.hora ? (
        <PasoConfirmacionAmore
          negocio={negocio}
          servicios={serviciosElegidos}
          especialistaNombre={seleccion.especialistaNombre ?? ""}
          fecha={seleccion.fecha}
          hora={seleccion.hora}
          datos={datos}
          enviando={enviando}
          error={errorReserva}
          ocupado={errorReserva !== null && errorReserva.includes("acaba de ser reservado")}
          onConfirmar={confirmarReserva}
          onElegirOtroHorario={volverAHorarioTrasOcupado}
          onVolver={() => setPaso("datos")}
        />
      ) : (
        pantallaServicios
      );
    case "exito":
      return exito ? <PasoExitoAmore resultado={exito} negocio={negocio} servicios={serviciosElegidos} /> : null;
    default:
      return null;
  }
}
