"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { CalendarClock, Check, Loader2, XCircle } from "lucide-react";
import { FilaResumenAmore as Fila } from "@/components/reservar-amore/FilaResumenAmore";
import { BotonPrincipalAmore, BotonSecundarioAmore, MarcoPasoAmore } from "@/components/reservar-amore/MarcoPasoAmore";
import { SelectorHorarioAmore } from "@/components/reservar-amore/SelectorHorarioAmore";
import { useHistorialPasos } from "@/components/reservar-amore/useHistorialPasos";
import { formatearDuracion, formatearFechaCorta, formatearFechaLargaDeInstante, formatearHora12h, formatearHoraDeInstante, sumarDias } from "@/components/reservar-amore/formato";
import { AMORE, serifAmore } from "@/components/reservar-amore/tema";

// AMORE — «MI CITA»: la página del enlace personal. Ver la cita, cambiar su fecha/hora y cancelarla. Solo muestra lo que el backend devuelve
// (/api/mi-cita/{token}/…): el id de la cita nunca viaja desde aquí, el servidor lo saca del token; los horarios son los REALES (con Google Calendar) y al
// confirmar el backend los vuelve a comprobar desde cero.
//
// Pensada para el celular, igual que el portal de reservas: encabezado compacto, las acciones SIEMPRE a la vista en la barra pegada abajo (nada de bajar hasta el final
// para poder confirmar) y el botón «atrás» del celular regresa a la pantalla anterior (ver ← modificar / cancelar) en vez de salir de la página.

type Vista = {
  negocio: string;
  servicio: string;
  profesional: string;
  inicio: string;
  fin: string;
  duracionMin: number;
  estado: string;
  puedeCancelar: boolean;
  puedeReprogramar: boolean;
  aviso: string | null;
};

type Carga = "cargando" | "invalido" | "lista";
type Pantalla = "ver" | "reprogramar" | "confirmar_cancelar" | "cancelada" | "reprogramada";

const HORIZONTE_DIAS = 30;
const URL_RESERVA = "/reservar/amore";

const hoyISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const ETIQUETA_ESTADO: Record<string, string> = {
  confirmada: "Confirmada",
  pendiente: "Pendiente de aprobación",
  cancelada: "Cancelada",
  completada: "Realizada",
};

function Cabecera({ icono, titulo, subtitulo }: { icono: ReactNode; titulo: string; subtitulo?: string }) {
  return (
    <div className="flex flex-col items-center pt-4 text-center">
      {icono}
      <h1 className="mt-4 text-[26px] font-semibold leading-tight" style={{ ...serifAmore, color: AMORE.texto }}>
        {titulo}
      </h1>
      {subtitulo && (
        <p className="mt-1 text-[13.5px]" style={{ color: AMORE.textoSecundario }}>
          {subtitulo}
        </p>
      )}
    </div>
  );
}

function Resumen({ v }: { v: Pick<Vista, "servicio" | "profesional" | "inicio" | "duracionMin"> }) {
  return (
    <div className="mt-6 w-full rounded-[28px] p-4 text-left" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
      <Fila label="Servicio" valor={v.servicio} />
      <Fila label="Profesional" valor={v.profesional} />
      <Fila label="Fecha" valor={formatearFechaLargaDeInstante(v.inicio)} />
      <Fila label="Hora" valor={formatearHoraDeInstante(v.inicio)} />
      <Fila label="Duración" valor={formatearDuracion(v.duracionMin)} />
    </div>
  );
}

function AvisoError({ texto }: { texto: string }) {
  return (
    <div role="alert" className="mb-2.5 rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-snug" style={{ backgroundColor: AMORE.rojoSuave, color: AMORE.rojo }}>
      {texto}
    </div>
  );
}

const iconoCirculo = (fondo: string, hijo: ReactNode) => (
  <div className="flex size-16 items-center justify-center rounded-full" style={{ backgroundColor: fondo }}>
    {hijo}
  </div>
);

/** El token también se puede pasar como propiedad (la página lo lee de la dirección con `useParams`). */
export function MiCitaAmore({ token: tokenDelPadre }: { token?: string } = {}) {
  const parametros = useParams<{ token: string }>();
  const token = tokenDelPadre ?? parametros?.token ?? "";

  const [carga, setCarga] = useState<Carga>("cargando");
  const [vista, setVista] = useState<Vista | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [terminada, setTerminada] = useState<"cancelada" | "reprogramada" | null>(null);

  const [fecha, setFecha] = useState<string | null>(null);
  const [horarios, setHorarios] = useState<string[]>([]);
  const [cargandoHorarios, setCargandoHorarios] = useState(false);
  const [errorHorarios, setErrorHorarios] = useState<string | null>(null);
  const [hora, setHora] = useState<string | null>(null);
  const [nueva, setNueva] = useState<{ inicio: string } | null>(null);
  const intento = useRef<{ firma: string; clave: string } | null>(null);
  // Cada consulta de horarios lleva un número: si la clienta cambia de día mientras una respuesta vieja viaja, esa respuesta se descarta.
  const solicitudHorariosRef = useRef(0);

  const base = `/api/mi-cita/${encodeURIComponent(token)}`;

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setCarga("invalido");
        return;
      }
      setVista(body.data as Vista);
      setCarga("lista");
    } catch {
      setErrorCarga("No pudimos cargar tu cita. Verifica tu conexión e intenta de nuevo.");
      setCarga("invalido");
    }
  }, [base]);

  useEffect(() => {
    // Carga inicial: la actualización de estado ocurre cuando responde la API (no de forma síncrona en el efecto).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  // «Atrás» del celular: de modificar o cancelar regresa a «Tu cita». Tras cancelar o reprogramar, volver lleva a «Tu cita» ya actualizada (se vuelve a consultar).
  const { paso: pantalla, irA, volver } = useHistorialPasos<Pantalla>({
    inicial: "ver",
    puedeMostrar: (p) =>
      p === "ver" ||
      (p === "reprogramar" && vista?.puedeReprogramar === true) ||
      (p === "confirmar_cancelar" && vista?.puedeCancelar === true) ||
      (p === "cancelada" && terminada === "cancelada") ||
      (p === "reprogramada" && terminada === "reprogramada" && nueva !== null),
    esFinal: (p) => p === "cancelada" || p === "reprogramada",
    alReiniciar: () => {
      setTerminada(null);
      setNueva(null);
      setError(null);
      void cargar();
    },
  });

  // Cada pantalla nueva arranca desde arriba. `instant` evita el desplazamiento suave global del sitio.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [pantalla]);

  const minima = hoyISO();
  const maxima = sumarDias(minima, HORIZONTE_DIAS);

  async function consultarHorarios(dia: string) {
    const solicitud = ++solicitudHorariosRef.current;
    setErrorHorarios(null);
    setHorarios([]);
    setCargandoHorarios(true);
    try {
      const res = await fetch(`${base}/horarios?fecha=${encodeURIComponent(dia)}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (solicitud !== solicitudHorariosRef.current) return;
      if (!res.ok || !body?.success) setErrorHorarios(body?.error ?? "No pudimos consultar los horarios. Intenta de nuevo.");
      else setHorarios((body.data?.horarios as string[]) ?? []);
    } catch {
      if (solicitud === solicitudHorariosRef.current) setErrorHorarios("No pudimos consultar los horarios. Verifica tu conexión e intenta de nuevo.");
    } finally {
      if (solicitud === solicitudHorariosRef.current) setCargandoHorarios(false);
    }
  }

  function elegirDia(dia: string) {
    if (dia < minima || dia > maxima) return;
    setFecha(dia);
    setHora(null);
    setError(null);
    void consultarHorarios(dia);
  }

  function abrirReprogramar() {
    solicitudHorariosRef.current++;
    setError(null);
    setFecha(null);
    setHora(null);
    setHorarios([]);
    setErrorHorarios(null);
    setCargandoHorarios(false);
    irA("reprogramar");
  }

  function abrirCancelar() {
    setError(null);
    irA("confirmar_cancelar");
  }

  async function confirmarCambio() {
    if (!fecha || !hora) return;
    setTrabajando(true);
    setError(null);
    // Una clave por INTENTO: un doble clic o un reintento de red no ejecuta dos veces; elegir otro horario genera otra.
    const firma = `${fecha}|${hora}`;
    if (intento.current?.firma !== firma) intento.current = { firma, clave: uuid() };
    try {
      const res = await fetch(`${base}/reprogramar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fecha, hora, idempotencyKey: intento.current.clave }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error ?? "No pudimos cambiar tu cita. Intenta de nuevo.");
        if (body?.codigo === "horario_ocupado") {
          // Alguien tomó ese horario: se quita la selección y se actualiza la lista, dejando el aviso a la vista.
          setHora(null);
          void consultarHorarios(fecha);
        }
        return;
      }
      setNueva({ inicio: body.data.inicio as string });
      setTerminada("reprogramada");
      irA("reprogramada");
    } catch {
      setError("No pudimos conectar con el servidor. Verifica tu conexión e intenta de nuevo.");
    } finally {
      setTrabajando(false);
    }
  }

  async function confirmarCancelacion() {
    setTrabajando(true);
    setError(null);
    try {
      const res = await fetch(`${base}/cancelar`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error ?? "No pudimos cancelar tu cita. Intenta de nuevo.");
        volver();
        return;
      }
      setTerminada("cancelada");
      irA("cancelada");
    } catch {
      setError("No pudimos conectar con el servidor. Verifica tu conexión e intenta de nuevo.");
      volver();
    } finally {
      setTrabajando(false);
    }
  }

  if (carga === "cargando") {
    return (
      <div className="flex min-h-dvh items-center justify-center" style={{ backgroundColor: AMORE.fondo }}>
        <Loader2 className="size-6 animate-spin" style={{ color: AMORE.textoSecundario }} />
      </div>
    );
  }

  if (carga === "invalido" || !vista) {
    return (
      <MarcoPasoAmore
        negocio="AMORE"
        accion={
          <BotonPrincipalAmore llena href={URL_RESERVA}>
            Reservar una cita nueva
          </BotonPrincipalAmore>
        }
      >
        <Cabecera icono={<XCircle className="size-12" style={{ color: AMORE.textoSecundario }} strokeWidth={1.4} />} titulo="Enlace no válido" subtitulo={errorCarga ?? "Este enlace no es válido o ya venció."} />
        <p className="mt-4 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>
          Si necesitas ayuda con tu cita, escríbenos por WhatsApp.
        </p>
      </MarcoPasoAmore>
    );
  }

  if (pantalla === "cancelada") {
    return (
      <MarcoPasoAmore
        negocio={vista.negocio}
        accion={
          <BotonPrincipalAmore llena href={URL_RESERVA}>
            Reservar una cita nueva
          </BotonPrincipalAmore>
        }
      >
        <Cabecera icono={iconoCirculo(AMORE.burdeosSuave, <Check className="size-8" style={{ color: AMORE.burdeos }} />)} titulo="Cita cancelada" subtitulo="Tu cita fue cancelada correctamente." />
      </MarcoPasoAmore>
    );
  }

  if (pantalla === "reprogramada" && nueva) {
    return (
      <MarcoPasoAmore negocio={vista.negocio}>
        <Cabecera icono={iconoCirculo(AMORE.verdeSuave, <Check className="size-8" style={{ color: AMORE.verde }} />)} titulo="¡Cita reprogramada!" subtitulo={`Te esperamos en ${vista.negocio}`} />
        <Resumen v={{ ...vista, inicio: nueva.inicio }} />
        <p className="mt-4 text-center text-[12.5px]" style={{ color: AMORE.textoSecundario }}>
          Guarda este enlace: desde aquí puedes volver a modificar o cancelar tu cita.
        </p>
      </MarcoPasoAmore>
    );
  }

  if (pantalla === "confirmar_cancelar") {
    return (
      <MarcoPasoAmore
        negocio={vista.negocio}
        onVolver={volver}
        titulo="¿Cancelar tu cita?"
        subtitulo="Esta acción libera tu horario."
        accion={
          <div>
            {error && <AvisoError texto={error} />}
            <div className="flex flex-col gap-2.5">
              <BotonPrincipalAmore llena onClick={volver} disabled={trabajando}>
                No, conservar mi cita
              </BotonPrincipalAmore>
              <BotonSecundarioAmore peligro onClick={() => void confirmarCancelacion()} disabled={trabajando}>
                {trabajando ? "Cancelando..." : "Sí, cancelar mi cita"}
              </BotonSecundarioAmore>
            </div>
          </div>
        }
      >
        <Resumen v={vista} />
      </MarcoPasoAmore>
    );
  }

  if (pantalla === "reprogramar") {
    return (
      <MarcoPasoAmore
        negocio={vista.negocio}
        onVolver={volver}
        titulo="Elige tu nuevo horario"
        subtitulo={`${vista.servicio} con ${vista.profesional}`}
        accion={
          <div>
            {error && <AvisoError texto={error} />}
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1" aria-live="polite">
                {fecha && hora ? (
                  <>
                    <p className="text-[12px]" style={{ color: AMORE.textoSecundario }}>
                      Nuevo horario
                    </p>
                    <p className="text-[13.5px] font-semibold" style={{ color: AMORE.texto }}>
                      {formatearFechaCorta(fecha)} · {formatearHora12h(hora)}
                    </p>
                  </>
                ) : (
                  <p className="text-[12.5px] leading-snug" style={{ color: AMORE.textoSecundario }}>
                    Elige una fecha y una hora
                  </p>
                )}
              </div>
              <BotonPrincipalAmore onClick={() => void confirmarCambio()} disabled={!fecha || !hora} cargando={trabajando}>
                Confirmar
              </BotonPrincipalAmore>
            </div>
          </div>
        }
      >
        <SelectorHorarioAmore
          fecha={fecha}
          hora={hora}
          fechaMinima={minima}
          fechaMaxima={maxima}
          horarios={horarios}
          cargandoHorarios={cargandoHorarios}
          errorHorarios={errorHorarios}
          onSeleccionarFecha={elegirDia}
          onSeleccionarHora={(h) => {
            setError(null);
            setHora(h);
          }}
          onReintentar={() => fecha && void consultarHorarios(fecha)}
        />
      </MarcoPasoAmore>
    );
  }

  // pantalla === "ver"
  return (
    <MarcoPasoAmore
      negocio={vista.negocio}
      accion={
        <div>
          {error && <AvisoError texto={error} />}
          <div className="flex flex-col gap-2.5">
            {vista.puedeReprogramar && (
              <BotonPrincipalAmore llena onClick={abrirReprogramar}>
                Modificar fecha u hora
              </BotonPrincipalAmore>
            )}
            {vista.puedeCancelar && (
              <BotonSecundarioAmore peligro onClick={abrirCancelar}>
                Cancelar cita
              </BotonSecundarioAmore>
            )}
            {!vista.puedeCancelar && !vista.puedeReprogramar && (
              <BotonPrincipalAmore llena href={URL_RESERVA}>
                Reservar una cita nueva
              </BotonPrincipalAmore>
            )}
          </div>
        </div>
      }
    >
      <Cabecera
        icono={
          <div className="flex size-14 items-center justify-center rounded-2xl" style={{ backgroundColor: AMORE.doradoSuave, color: AMORE.dorado }}>
            <CalendarClock className="size-7" />
          </div>
        }
        titulo="Tu cita"
        subtitulo={ETIQUETA_ESTADO[vista.estado] ?? vista.estado}
      />
      <Resumen v={vista} />
      {vista.aviso && (
        <p className="mt-4 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>
          {vista.aviso}
        </p>
      )}
    </MarcoPasoAmore>
  );
}
