"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, CalendarClock, Check, ChevronLeft, Clock, User } from "lucide-react";
import { Button, Field, inputClass } from "@/components/spa-panel/ui";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { PortalLandingDaniela } from "@/components/reservar/PortalLandingDaniela";
import { PasoSeleccionServicio } from "@/components/reservar/PasoSeleccionServicio";
import { PasoSeleccionHorario } from "@/components/reservar/PasoSeleccionHorario";

// Portal público de reservas (Fase 4) — consumidor puro del núcleo de
// reservas existente (lib/disponibilidad-servicio.ts vía las rutas de
// app/api/reservar/[tenant]/*). Ninguna disponibilidad ni precio ni
// duración se calcula aquí: todo lo que se ve es lo que el backend
// devolvió; al confirmar, el backend vuelve a validar todo desde cero.
//
// Horizonte de fechas: 30 días -- no hay ninguna regla de negocio existente
// que limite cuánto a futuro se puede agendar (ventanaAtencion no impone
// límite), así que este es un valor razonable elegido para esta fase, no
// una regla derivada del sistema. Documentado para Fase 5 si el negocio
// pide algo distinto.
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

type Paso = "inicio" | "servicio" | "profesional" | "fecha" | "horario" | "datos" | "confirmar" | "exito";

type Seleccion = {
  servicioId: string | null;
  especialistaId: number | null;
  especialistaNombre: string | null;
  fecha: string | null;
  hora: string | null;
};

type DatosCliente = { nombre: string; telefono: string; correo: string };

type ResultadoExito = {
  codigo: string;
  servicio: string;
  profesional: string;
  inicio: string;
  fin: string;
  duracionMin: number;
};

const SELECCION_VACIA: Seleccion = { servicioId: null, especialistaId: null, especialistaNombre: null, fecha: null, hora: null };

function hoyISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

function fechaMaxima(): string {
  const d = new Date();
  d.setDate(d.getDate() + HORIZONTE_DIAS);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(d);
}

function formatearHora12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const periodo = h >= 12 ? "p. m." : "a. m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${periodo}`;
}

function formatearFechaLarga(fechaISO: string): string {
  const [y, m, d] = fechaISO.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", weekday: "long", timeZone: "America/Bogota" }).format(
    new Date(Date.UTC(y, m - 1, d, 12))
  );
}

function crearIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

export default function PortalReservasPage() {
  const { tenant } = useParams<{ tenant: string }>();

  const [cargando, setCargando] = useState(true);
  const [disponible, setDisponible] = useState(true);
  const [negocio, setNegocio] = useState("");
  const [telefonoNegocio, setTelefonoNegocio] = useState<string | null>(null);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [paso, setPaso] = useState<Paso>("inicio");
  const [seleccion, setSeleccion] = useState<Seleccion>(SELECCION_VACIA);
  const [datos, setDatos] = useState<DatosCliente>({ nombre: "", telefono: "", correo: "" });

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
        const res = await fetch(`/api/reservar/${tenant}`);
        const body = await res.json();
        if (cancelado) return;
        if (!res.ok) {
          setErrorCarga("No pudimos cargar esta página. Intenta de nuevo más tarde.");
          return;
        }
        setDisponible(body.disponible !== false);
        setNegocio(body.negocio ?? "");
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
  }, [tenant]);

  const servicioElegido = useMemo(() => servicios.find((s) => s.id === seleccion.servicioId) ?? null, [servicios, seleccion.servicioId]);

  const elegirServicio = useCallback(
    async (servicio: Servicio) => {
      setSeleccion({ ...SELECCION_VACIA, servicioId: servicio.id });
      setEspecialistas([]);
      setHorarios([]);
      setCargandoEspecialistas(true);
      setPaso("profesional");
      try {
        const res = await fetch(`/api/reservar/${tenant}/especialistas?servicioId=${encodeURIComponent(servicio.id)}`);
        const body = await res.json();
        const opciones: EspecialistaOpcion[] = body.especialistas ?? [];
        setEspecialistas(opciones);
        if (opciones.length === 1) {
          setSeleccion((s) => ({ ...s, especialistaId: opciones[0]!.id, especialistaNombre: opciones[0]!.nombre }));
          setPaso("fecha");
        }
      } finally {
        setCargandoEspecialistas(false);
      }
    },
    [tenant]
  );

  const elegirEspecialista = useCallback((op: EspecialistaOpcion) => {
    setSeleccion((s) => ({ ...s, especialistaId: op.id, especialistaNombre: op.nombre, fecha: null, hora: null }));
    setPaso("fecha");
  }, []);

  const cargarHorarios = useCallback(
    async (fecha: string) => {
      if (!seleccion.servicioId || !seleccion.especialistaId) return;
      setCargandoHorarios(true);
      setHorarios([]);
      try {
        const qs = new URLSearchParams({
          servicioId: seleccion.servicioId,
          fecha,
          especialistaId: String(seleccion.especialistaId),
        });
        const res = await fetch(`/api/reservar/${tenant}/disponibilidad?${qs.toString()}`);
        const body = await res.json();
        const entrada = (body.especialistas ?? [])[0];
        setHorarios(entrada?.horarios ?? []);
      } finally {
        setCargandoHorarios(false);
      }
    },
    [tenant, seleccion.servicioId, seleccion.especialistaId]
  );

  const elegirFecha = useCallback(
    (fecha: string) => {
      setSeleccion((s) => ({ ...s, fecha, hora: null }));
      setPaso("horario");
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

  // Misma clave mientras la combinación (servicio+especialista+fecha+hora+
  // datos de la clienta) no cambie -- un reintento en la misma pantalla
  // reutiliza la MISMA solicitud (ver lib/idempotencia-reserva.ts). Si algo
  // cambió (volvió atrás y ajustó algo), se genera una clave nueva: es una
  // solicitud genuinamente distinta.
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
      const res = await fetch(`/api/reservar/${tenant}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          servicioId: seleccion.servicioId,
          especialistaId: seleccion.especialistaId,
          fecha: seleccion.fecha,
          hora: seleccion.hora,
          nombreCliente: datos.nombre.trim(),
          telefonoCliente: datos.telefono.trim(),
          correoCliente: datos.correo.trim() || undefined,
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
  }, [tenant, seleccion, datos]);

  const volverAHorarioTrasOcupado = useCallback(() => {
    setSeleccion((s) => ({ ...s, hora: null }));
    setErrorReserva(null);
    setPaso("horario");
    // Ocupado real: la lista vieja de horarios en pantalla ya no es
    // confiable (justo lo que pasó) -- se refresca directo aquí, no en un
    // efecto, para no depender del estado viejo del frontend (ver Fase 4,
    // sección 15 del pedido).
    if (seleccion.fecha) cargarHorarios(seleccion.fecha);
  }, [seleccion.fecha, cargarHorarios]);

  if (cargando) {
    return (
      <div className="spa-scope flex min-h-screen items-center justify-center bg-ink">
        <Loader2 className="size-6 animate-spin text-mist" />
      </div>
    );
  }

  if (errorCarga) {
    return (
      <div className="spa-scope flex min-h-screen items-center justify-center bg-ink px-6 text-center">
        <p className="text-sm text-mist">{errorCarga}</p>
      </div>
    );
  }

  if (!disponible) {
    return (
      <div className="spa-scope flex min-h-screen flex-col items-center justify-center gap-4 bg-ink px-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-warning text-warning-text">
          <CalendarClock className="size-7" />
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-mist">Este negocio no tiene reservas disponibles en este momento.</p>
      </div>
    );
  }

  if (paso === "inicio") {
    return <PortalLandingDaniela negocio={negocio} telefonoNegocio={telefonoNegocio} onComenzar={() => setPaso("servicio")} />;
  }

  if (paso === "servicio") {
    return <PasoSeleccionServicio servicios={servicios} onElegir={elegirServicio} onVolver={() => setPaso("inicio")} />;
  }

  if ((paso === "fecha" || paso === "horario") && servicioElegido) {
    return (
      <PasoSeleccionHorario
        servicio={servicioElegido}
        especialistaNombre={seleccion.especialistaNombre}
        fecha={seleccion.fecha}
        fechaMinima={hoyISO()}
        fechaMaxima={fechaMaxima()}
        horarios={horarios}
        cargandoHorarios={cargandoHorarios}
        onSeleccionarFecha={elegirFecha}
        onContinuar={elegirHora}
        onVolver={() => irAtras("fecha", setPaso)}
      />
    );
  }

  return (
    <div className="spa-scope min-h-screen bg-ink">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-10 pt-6 sm:max-w-lg">
        <header className="mb-6 flex items-center gap-3">
          {paso !== "exito" && (
            <button
              type="button"
              onClick={() => irAtras(paso, setPaso)}
              aria-label="Volver"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-edge bg-card text-fg"
            >
              <ChevronLeft className="size-5" />
            </button>
          )}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-mist">Agendar cita</p>
            <h1 className="text-lg font-semibold text-fg">{negocio}</h1>
          </div>
        </header>

        {paso === "profesional" && (
          <PasoProfesional
            cargando={cargandoEspecialistas}
            especialistas={especialistas}
            onElegir={elegirEspecialista}
          />
        )}

        {paso === "datos" && (
          <PasoDatos
            datos={datos}
            onCambiar={setDatos}
            onContinuar={irAConfirmar}
          />
        )}

        {paso === "confirmar" && servicioElegido && (
          <PasoConfirmar
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
          />
        )}

        {paso === "exito" && exito && <PasoExito resultado={exito} negocio={negocio} />}
      </div>
    </div>
  );
}

function irAtras(paso: Paso, setPaso: (p: Paso) => void) {
  const anterior: Partial<Record<Paso, Paso>> = {
    servicio: "inicio",
    profesional: "servicio",
    fecha: "profesional",
    horario: "fecha",
    datos: "horario",
    confirmar: "datos",
  };
  setPaso(anterior[paso] ?? "inicio");
}

function PasoProfesional({
  cargando,
  especialistas,
  onElegir,
}: {
  cargando: boolean;
  especialistas: EspecialistaOpcion[];
  onElegir: (e: EspecialistaOpcion) => void;
}) {
  if (cargando) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-mist" />
      </div>
    );
  }
  if (especialistas.length === 0) {
    return <p className="text-sm text-mist">No hay profesionales disponibles para este servicio en este momento.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-mist">¿Con quién prefieres tu cita?</p>
      {especialistas.map((e) => (
        <button
          key={e.id}
          onClick={() => onElegir(e)}
          className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-4 text-left transition-colors hover:border-lime/50"
        >
          <div className="flex size-10 items-center justify-center rounded-full bg-lime-soft text-lime-text">
            <User className="size-5" />
          </div>
          <span className="font-medium text-fg">{e.nombre}</span>
        </button>
      ))}
    </div>
  );
}


function PasoDatos({
  datos,
  onCambiar,
  onContinuar,
}: {
  datos: DatosCliente;
  onCambiar: (d: DatosCliente) => void;
  onContinuar: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-mist">Tus datos</p>
      <Field label="Nombre completo">
        <input
          className={inputClass}
          value={datos.nombre}
          onChange={(e) => onCambiar({ ...datos, nombre: e.target.value })}
          placeholder="Ej. Laura Gómez"
        />
      </Field>
      <Field label="WhatsApp">
        <input
          className={inputClass}
          value={datos.telefono}
          onChange={(e) => onCambiar({ ...datos, telefono: e.target.value })}
          placeholder="Ej. 3001234567"
          inputMode="tel"
        />
      </Field>
      <Field label="Correo (opcional)">
        <input
          className={inputClass}
          value={datos.correo}
          onChange={(e) => onCambiar({ ...datos, correo: e.target.value })}
          placeholder="tucorreo@ejemplo.com"
          inputMode="email"
        />
      </Field>
      <Button disabled={!datos.nombre.trim() || !datos.telefono.trim()} onClick={onContinuar}>
        Continuar
      </Button>
    </div>
  );
}

function PasoConfirmar({
  servicio,
  especialistaNombre,
  fecha,
  hora,
  datos,
  enviando,
  error,
  ocupado,
  onConfirmar,
  onElegirOtroHorario,
}: {
  servicio: Servicio;
  especialistaNombre: string;
  fecha: string;
  hora: string;
  datos: DatosCliente;
  enviando: boolean;
  error: string | null;
  ocupado: boolean;
  onConfirmar: () => void;
  onElegirOtroHorario: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-mist">Confirma tu cita</p>
      <div className="flex flex-col gap-2 rounded-2xl border border-edge bg-card p-4 text-sm">
        <Fila label="Servicio" valor={servicio.nombre} />
        <Fila label="Profesional" valor={especialistaNombre} />
        <Fila label="Fecha" valor={formatearFechaLarga(fecha)} />
        <Fila label="Hora" valor={formatearHora12h(hora)} />
        <Fila label="Duración" valor={`${servicio.duracion_min} min`} />
        {servicio.precio != null && <Fila label="Precio" valor={formatearPrecioCop(servicio.precio)} />}
        <Fila label="Nombre" valor={datos.nombre} />
      </div>
      {error && (
        <div className="rounded-xl bg-danger px-3.5 py-2.5 text-sm text-danger-text">
          {error}
          {ocupado && (
            <button onClick={onElegirOtroHorario} className="mt-1.5 block font-medium underline">
              Elegir otro horario
            </button>
          )}
        </div>
      )}
      <Button loading={enviando} onClick={onConfirmar}>
        Confirmar reserva
      </Button>
    </div>
  );
}

function Fila({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-mist">{label}</span>
      <span className="font-medium text-fg">{valor}</span>
    </div>
  );
}

function PasoExito({ resultado, negocio }: { resultado: ResultadoExito; negocio: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-success text-success-text">
        <Check className="size-8" />
      </div>
      <div>
        <p className="text-lg font-semibold text-fg">¡Cita confirmada!</p>
        <p className="mt-1 text-sm text-mist">Te esperamos en {negocio}</p>
      </div>
      <div className="flex w-full flex-col gap-2 rounded-2xl border border-edge bg-card p-4 text-left text-sm">
        <Fila label="Servicio" valor={resultado.servicio} />
        <Fila label="Profesional" valor={resultado.profesional} />
        <Fila label="Fecha" valor={formatearFechaLarga(resultado.inicio.slice(0, 10))} />
        <Fila
          label="Hora"
          valor={new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Bogota" }).format(
            new Date(resultado.inicio)
          )}
        />
        <Fila label="Duración" valor={`${resultado.duracionMin} min`} />
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-edge pt-2">
          <span className="flex items-center gap-1.5 text-mist">
            <Clock className="size-3.5" /> Código
          </span>
          <span className="font-mono font-medium text-fg">{resultado.codigo}</span>
        </div>
      </div>
    </div>
  );
}
