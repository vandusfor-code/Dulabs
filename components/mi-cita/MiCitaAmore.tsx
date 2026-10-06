"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CalendarClock, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, Loader2, XCircle } from "lucide-react";
import { PortalHeaderAmore } from "@/components/reservar-amore/PortalHeaderAmore";
import { AMORE, serifAmore } from "@/components/reservar-amore/tema";
import { playfairDisplay } from "@/lib/fonts-portal-amore";

// AMORE — «MI CITA»: la página del enlace personal. Ver la cita, cambiar su fecha/hora y cancelarla. Solo muestra lo que el backend devuelve
// (/api/mi-cita/{token}/…): el id de la cita nunca viaja desde aquí, el servidor lo saca del token; los horarios son los REALES (con Google Calendar) y al
// confirmar el backend los vuelve a comprobar desde cero.

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

type Pantalla = "cargando" | "invalido" | "ver" | "reprogramar" | "confirmar_cancelar" | "cancelada" | "reprogramada";

const HORIZONTE_DIAS = 30;
const DIAS_LABEL = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];
const URL_RESERVA = "/reservar/amore";

const hoyISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
const fechaDesdeISO = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};
const sumarDias = (iso: string, n: number) => {
  const f = fechaDesdeISO(iso);
  f.setUTCDate(f.getUTCDate() + n);
  return f.toISOString().slice(0, 10);
};
const mayus = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const fechaLarga = (iso: string) => mayus(new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" }).format(new Date(iso)));
const horaDe = (iso: string) => new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Bogota" }).format(new Date(iso));
const hora12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":");
  const n = Number(h);
  return `${n % 12 === 0 ? 12 : n % 12}:${m} ${n >= 12 ? "p. m." : "a. m."}`;
};
const duracion = (min: number) => (min < 60 ? `${min} min` : min % 60 === 0 ? `${min / 60} h` : `${Math.floor(min / 60)} h ${min % 60} min`);
const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const ETIQUETA_ESTADO: Record<string, string> = {
  confirmada: "Confirmada",
  pendiente: "Pendiente de aprobación",
  cancelada: "Cancelada",
  completada: "Realizada",
};

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className={`relative min-h-screen w-full ${playfairDisplay.variable}`} style={{ backgroundColor: AMORE.fondo }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-6 pb-9 pt-8">{children}</div>
    </div>
  );
}

function Fila({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2" style={{ borderColor: AMORE.borde }}>
      <span className="text-[12.5px]" style={{ color: AMORE.textoSecundario }}>
        {label}
      </span>
      <span className="text-right text-[13.5px] font-semibold" style={{ color: AMORE.texto }}>
        {valor}
      </span>
    </div>
  );
}

function Boton({ children, onClick, disabled, variante = "principal" }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; variante?: "principal" | "borde" | "peligro" }) {
  const estilos = {
    principal: { backgroundColor: AMORE.burdeos, color: "#fff", border: `1.5px solid ${AMORE.burdeos}` },
    borde: { backgroundColor: "#fff", color: AMORE.burdeos, border: `1.5px solid ${AMORE.burdeos}` },
    peligro: { backgroundColor: "#fff", color: AMORE.rojo, border: `1.5px solid ${AMORE.rojo}` },
  }[variante];
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex w-full items-center justify-center gap-2 py-3.5 text-[15px] font-semibold disabled:opacity-40" style={{ ...estilos, borderRadius: 999 }}>
      {children}
    </button>
  );
}

function Titulo({ icono, titulo, subtitulo }: { icono?: React.ReactNode; titulo: string; subtitulo?: string }) {
  return (
    <div className="mt-8 flex flex-col items-center text-center">
      {icono}
      <h1 className="mt-4 text-[26px] font-semibold" style={{ ...serifAmore, color: AMORE.texto }}>
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

export function MiCitaAmore() {
  const { token } = useParams<{ token: string }>();
  const [pantalla, setPantalla] = useState<Pantalla>("cargando");
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const [fecha, setFecha] = useState<string | null>(null);
  const [inicioSemana, setInicioSemana] = useState(hoyISO());
  const [horarios, setHorarios] = useState<string[]>([]);
  const [cargandoHorarios, setCargandoHorarios] = useState(false);
  const [hora, setHora] = useState<string | null>(null);
  const [nueva, setNueva] = useState<{ inicio: string } | null>(null);
  const intento = useRef<{ firma: string; clave: string } | null>(null);

  const base = `/api/mi-cita/${encodeURIComponent(token)}`;

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setPantalla("invalido");
        return;
      }
      setVista(body.data as Vista);
      setPantalla("ver");
    } catch {
      setError("No pudimos cargar tu cita. Verifica tu conexión e intenta de nuevo.");
      setPantalla("invalido");
    }
  }, [base]);

  useEffect(() => {
    // Carga inicial: la actualización de estado ocurre cuando responde la API (no de forma síncrona en el efecto).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  const minima = hoyISO();
  const maxima = sumarDias(minima, HORIZONTE_DIAS);
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(inicioSemana, i)), [inicioSemana]);

  async function elegirDia(dia: string) {
    if (dia < minima || dia > maxima) return;
    setFecha(dia);
    setHora(null);
    setError(null);
    setHorarios([]);
    setCargandoHorarios(true);
    try {
      const res = await fetch(`${base}/horarios?fecha=${encodeURIComponent(dia)}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) setError(body?.error ?? "No pudimos consultar los horarios. Intenta de nuevo.");
      else setHorarios((body.data?.horarios as string[]) ?? []);
    } catch {
      setError("No pudimos consultar los horarios. Verifica tu conexión e intenta de nuevo.");
    } finally {
      setCargandoHorarios(false);
    }
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
          setHora(null);
          void elegirDia(fecha);
        }
        return;
      }
      setNueva({ inicio: body.data.inicio as string });
      setPantalla("reprogramada");
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
        setPantalla("ver");
        return;
      }
      setPantalla("cancelada");
    } catch {
      setError("No pudimos conectar con el servidor. Verifica tu conexión e intenta de nuevo.");
      setPantalla("ver");
    } finally {
      setTrabajando(false);
    }
  }

  if (pantalla === "cargando") {
    return (
      <Marco>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin" style={{ color: AMORE.textoSecundario }} />
        </div>
      </Marco>
    );
  }

  if (pantalla === "invalido" || !vista) {
    return (
      <Marco>
        <PortalHeaderAmore negocio="AMORE" />
        <Titulo icono={<XCircle className="size-12" style={{ color: AMORE.textoSecundario }} strokeWidth={1.4} />} titulo="Enlace no válido" subtitulo={error ?? "Este enlace no es válido o ya venció."} />
        <p className="mt-4 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>
          Si necesitas ayuda con tu cita, escríbenos por WhatsApp.
        </p>
        <div className="mt-6">
          <a href={URL_RESERVA} className="flex w-full items-center justify-center py-3.5 text-[15px] font-semibold text-white" style={{ backgroundColor: AMORE.burdeos, borderRadius: 999 }}>
            Reservar una cita nueva
          </a>
        </div>
      </Marco>
    );
  }

  const resumen = (v: Pick<Vista, "servicio" | "profesional" | "inicio" | "duracionMin">) => (
    <div className="mt-6 w-full rounded-[28px] p-5 text-left" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
      <div className="divide-y" style={{ borderColor: AMORE.borde }}>
        <Fila label="Servicio" valor={v.servicio} />
        <Fila label="Profesional" valor={v.profesional} />
        <Fila label="Fecha" valor={fechaLarga(v.inicio)} />
        <Fila label="Hora" valor={horaDe(v.inicio)} />
        <Fila label="Duración" valor={duracion(v.duracionMin)} />
      </div>
    </div>
  );

  if (pantalla === "cancelada") {
    return (
      <Marco>
        <PortalHeaderAmore negocio={vista.negocio} />
        <Titulo icono={<div className="flex size-16 items-center justify-center rounded-full" style={{ backgroundColor: AMORE.burdeosSuave }}><Check className="size-8" style={{ color: AMORE.burdeos }} /></div>} titulo="Cita cancelada" subtitulo="Tu cita fue cancelada correctamente." />
        <div className="mt-8">
          <a href={URL_RESERVA} className="flex w-full items-center justify-center py-3.5 text-[15px] font-semibold text-white" style={{ backgroundColor: AMORE.burdeos, borderRadius: 999 }}>
            Reservar una cita nueva
          </a>
        </div>
      </Marco>
    );
  }

  if (pantalla === "reprogramada" && nueva) {
    return (
      <Marco>
        <PortalHeaderAmore negocio={vista.negocio} />
        <Titulo icono={<div className="flex size-16 items-center justify-center rounded-full" style={{ backgroundColor: AMORE.verdeSuave }}><Check className="size-8" style={{ color: AMORE.verde }} /></div>} titulo="¡Cita reprogramada!" subtitulo={`Te esperamos en ${vista.negocio}`} />
        {resumen({ ...vista, inicio: nueva.inicio })}
        <p className="mt-4 text-center text-[12.5px]" style={{ color: AMORE.textoSecundario }}>
          Guarda este enlace: desde aquí puedes volver a modificar o cancelar tu cita.
        </p>
      </Marco>
    );
  }

  if (pantalla === "confirmar_cancelar") {
    return (
      <Marco>
        <PortalHeaderAmore negocio={vista.negocio} onVolver={() => setPantalla("ver")} />
        <Titulo titulo="¿Cancelar tu cita?" subtitulo="Esta acción libera tu horario." />
        {resumen(vista)}
        {error && <p className="mt-4 text-center text-[13px]" style={{ color: AMORE.rojo }}>{error}</p>}
        <div className="mt-6 flex flex-col gap-3">
          <Boton variante="peligro" onClick={confirmarCancelacion} disabled={trabajando}>
            {trabajando ? <Loader2 className="size-5 animate-spin" /> : "Sí, cancelar mi cita"}
          </Boton>
          <Boton variante="borde" onClick={() => setPantalla("ver")} disabled={trabajando}>
            No, conservar mi cita
          </Boton>
        </div>
      </Marco>
    );
  }

  if (pantalla === "reprogramar") {
    return (
      <Marco>
        <PortalHeaderAmore negocio={vista.negocio} onVolver={() => { setError(null); setPantalla("ver"); }} />
        <h1 className="mt-7 text-center text-[26px] font-semibold" style={{ ...serifAmore, color: AMORE.texto }}>
          Elige tu nuevo horario
        </h1>
        <p className="mt-1 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>
          {vista.servicio} con {vista.profesional}
        </p>

        <div className="mt-5 rounded-[28px] p-5" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
          <div className="flex items-center gap-2">
            <CalendarPlus className="size-5" style={{ color: AMORE.burdeos }} strokeWidth={1.6} />
            <span className="text-[13.5px] font-semibold" style={{ color: AMORE.texto }}>Selecciona una fecha</span>
          </div>
          <div className="mt-3 flex items-center gap-1">
            <button type="button" aria-label="Semana anterior" disabled={sumarDias(inicioSemana, -7) < sumarDias(minima, -6)} onClick={() => setInicioSemana(sumarDias(inicioSemana, -7))} className="flex size-7 shrink-0 items-center justify-center disabled:opacity-25" style={{ color: AMORE.burdeos }}>
              <ChevronLeft className="size-5" />
            </button>
            <div className="grid flex-1 grid-cols-7 gap-1">
              {dias.map((dia) => {
                const fuera = dia < minima || dia > maxima;
                const sel = dia === fecha;
                const d = fechaDesdeISO(dia);
                return (
                  <button key={dia} type="button" disabled={fuera} onClick={() => void elegirDia(dia)} className="flex flex-col items-center gap-1 rounded-xl py-2 disabled:opacity-30" style={{ backgroundColor: sel ? AMORE.burdeosSuave : "transparent" }}>
                    <span className="text-[10px] font-semibold uppercase" style={{ color: sel ? AMORE.burdeos : AMORE.textoSecundario }}>{DIAS_LABEL[d.getUTCDay()]}</span>
                    <span className="flex size-7 items-center justify-center rounded-full text-[13px] font-semibold" style={sel ? { backgroundColor: AMORE.burdeos, color: "#fff" } : { color: AMORE.texto }}>{d.getUTCDate()}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" aria-label="Semana siguiente" disabled={sumarDias(inicioSemana, 7) > maxima} onClick={() => setInicioSemana(sumarDias(inicioSemana, 7))} className="flex size-7 shrink-0 items-center justify-center disabled:opacity-25" style={{ color: AMORE.burdeos }}>
              <ChevronRight className="size-5" />
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-[28px] p-5" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
          <div className="flex items-center gap-2">
            <Clock className="size-5" style={{ color: AMORE.burdeos }} strokeWidth={1.6} />
            <p className="text-[13.5px] font-semibold" style={{ color: AMORE.texto }}>Horarios disponibles</p>
          </div>
          {!fecha ? (
            <p className="mt-4 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>Elige una fecha para ver los horarios reales.</p>
          ) : cargandoHorarios ? (
            <p className="mt-4 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>Consultando horarios reales...</p>
          ) : horarios.length === 0 ? (
            <p className="mt-4 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>No encontramos horarios disponibles para esta fecha. Elige otra.</p>
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {horarios.map((h) => (
                <button key={h} type="button" onClick={() => setHora(h)} className="flex flex-col items-center gap-1 rounded-xl py-2.5" style={{ backgroundColor: h === hora ? AMORE.burdeosSuave : "#fff", border: `1.5px solid ${h === hora ? AMORE.burdeos : AMORE.borde}` }}>
                  <span className="text-[13px] font-medium" style={{ color: AMORE.texto }}>{hora12(h)}</span>
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: h === hora ? AMORE.burdeos : AMORE.verde }} />
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <p className="mt-4 text-center text-[13px]" style={{ color: AMORE.rojo }}>{error}</p>}
        <div className="mt-5">
          <Boton onClick={confirmarCambio} disabled={!fecha || !hora || trabajando}>
            {trabajando ? <Loader2 className="size-5 animate-spin" /> : "Confirmar nuevo horario"}
          </Boton>
        </div>
      </Marco>
    );
  }

  // pantalla === "ver"
  return (
    <Marco>
      <PortalHeaderAmore negocio={vista.negocio} />
      <Titulo icono={<div className="flex size-14 items-center justify-center rounded-2xl" style={{ backgroundColor: AMORE.doradoSuave, color: AMORE.dorado }}><CalendarClock className="size-7" /></div>} titulo="Tu cita" subtitulo={ETIQUETA_ESTADO[vista.estado] ?? vista.estado} />
      {resumen(vista)}
      {vista.aviso && <p className="mt-4 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>{vista.aviso}</p>}
      {error && <p className="mt-4 text-center text-[13px]" style={{ color: AMORE.rojo }}>{error}</p>}
      <div className="mt-6 flex flex-col gap-3">
        {vista.puedeReprogramar && (
          <Boton onClick={() => { setError(null); setFecha(null); setHora(null); setHorarios([]); setInicioSemana(hoyISO()); setPantalla("reprogramar"); }}>
            Modificar fecha u hora
          </Boton>
        )}
        {vista.puedeCancelar && (
          <Boton variante="peligro" onClick={() => { setError(null); setPantalla("confirmar_cancelar"); }}>
            Cancelar cita
          </Boton>
        )}
        {!vista.puedeCancelar && !vista.puedeReprogramar && (
          <a href={URL_RESERVA} className="flex w-full items-center justify-center py-3.5 text-[15px] font-semibold text-white" style={{ backgroundColor: AMORE.burdeos, borderRadius: 999 }}>
            Reservar una cita nueva
          </a>
        )}
      </div>
    </Marco>
  );
}
