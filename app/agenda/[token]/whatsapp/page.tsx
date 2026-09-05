"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Loader2 } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import {
  AmoreCard,
  AmoreScreenTitle,
  AmoreSectionTitle,
  AmoreSecondaryButton,
  AmoreDivider,
  AmoreSegmentedTabs,
} from "@/components/spa-panel/amore/ui";

type EstadoConexion = "desconectado" | "conectando" | "conectado";
type EstadoPublico = {
  estado: EstadoConexion;
  numeroConectado: string | null;
  conectadoEn: string | null;
  qr: string | null;
  /** Código de 8 caracteres para "Vincular con número" -- alternativa real al QR, mutuamente excluyente con `qr`. */
  codigoVinculacion: string | null;
};
type UsoWhatsApp = { label: string; cantidad: number };
type ModoConexion = "qr" | "codigo";

function formatearCodigo(codigo: string): string {
  return codigo.length === 8 ? `${codigo.slice(0, 4)}-${codigo.slice(4)}` : codigo;
}

// AMORE (Fase 9A, autorizado) — MISMO Design System de la Fase 5 (AmoreCard,
// AmoreScreenTitle, AmoreSecondaryButton...), ahora conectado a la
// infraestructura real de WhatsApp por QR (ver app/api/agenda/[token]/
// whatsapp-qr/* y lib/whatsapp-qr/). No se rediseñó nada: se agregaron los
// 3 estados reales (desconectado/conectando/conectado) sobre los mismos
// componentes que ya existían. "Uso de WhatsApp" ahora es real (ver
// app/api/agenda/[token]/whatsapp-qr/uso) -- cuenta filas reales de las
// tablas de idempotencia de cada motor, nunca un número inventado.
export default function WhatsappPage() {
  return (
    <AmoreOnlyScreen>
      <WhatsappContenido />
    </AmoreOnlyScreen>
  );
}

function WhatsappContenido() {
  const { token } = useAgenda();
  const [estado, setEstado] = useState<EstadoPublico | null>(null);
  const [uso, setUso] = useState<UsoWhatsApp[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<ModoConexion>("qr");
  const [telefono, setTelefono] = useState("");
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const consultarEstado = useCallback(() => {
    fetch(`/api/agenda/${token}/whatsapp-qr`)
      .then((r) => r.json())
      .then((body) => (body.error ? setError(body.error) : setEstado(body)))
      .catch(() => setError("No se pudo consultar el estado de WhatsApp"));
  }, [token]);

  useEffect(() => {
    consultarEstado();
    fetch(`/api/agenda/${token}/whatsapp-qr/uso`)
      .then((r) => r.json())
      .then((body) => body.uso && setUso(body.uso))
      .catch(() => {});
  }, [token, consultarEstado]);

  // Mientras se espera el escaneo del QR, refresca el estado cada 3s (el QR
  // y la confirmación de conexión llegan de forma asíncrona del lado del
  // servidor). Se detiene apenas deja de estar "conectando".
  useEffect(() => {
    if (estado?.estado === "conectando") {
      intervaloRef.current = setInterval(consultarEstado, 3000);
    } else if (intervaloRef.current) {
      clearInterval(intervaloRef.current);
      intervaloRef.current = null;
    }
    return () => {
      if (intervaloRef.current) clearInterval(intervaloRef.current);
    };
  }, [estado?.estado, consultarEstado]);

  async function conectar() {
    if (modo === "codigo" && !/^\d{8,15}$/.test(telefono.replace(/\D/g, ""))) {
      setError("Escribe un teléfono válido (solo dígitos, con indicativo de país)");
      return;
    }
    setCargando(true);
    setError(null);
    try {
      const r = await fetch(`/api/agenda/${token}/whatsapp-qr/iniciar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(modo === "codigo" ? { telefono: telefono.replace(/\D/g, "") } : {}),
      });
      const body = await r.json();
      if (body.error) setError(body.error);
      else setEstado(body);
    } catch {
      setError("No se pudo iniciar la conexión");
    } finally {
      setCargando(false);
    }
  }

  async function desconectar() {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch(`/api/agenda/${token}/whatsapp-qr/desconectar`, { method: "POST" });
      const body = await r.json();
      if (body.error) setError(body.error);
      else setEstado(body);
    } catch {
      setError("No se pudo desconectar");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle title="WhatsApp" subtitle="Conexión con tus clientas" />

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {!estado ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : estado.estado === "conectado" ? (
        <>
          <AmoreCard className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-success text-success-text">
              <MessageCircle className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium text-fg">
                <span className="size-2 rounded-full bg-success-text" /> 🟢 WhatsApp conectado
              </p>
              <p className="truncate text-xs text-mist">
                {estado.numeroConectado ? `+${estado.numeroConectado}` : "Número no disponible"}
                {estado.conectadoEn && ` · desde ${new Date(estado.conectadoEn).toLocaleString("es-CO")}`}
              </p>
            </div>
          </AmoreCard>
          <AmoreSecondaryButton onClick={desconectar} disabled={cargando} className="!bg-danger !text-danger-text">
            Desconectar
          </AmoreSecondaryButton>
        </>
      ) : estado.estado === "conectando" ? (
        <AmoreCard className="flex flex-col items-center gap-3 text-center">
          {estado.codigoVinculacion ? (
            <>
              <p className="text-sm font-medium text-fg">Escribe este código en tu WhatsApp</p>
              <p className="rounded-xl border border-edge bg-ink px-6 py-4 text-3xl font-bold tracking-[0.2em] text-fg">
                {formatearCodigo(estado.codigoVinculacion)}
              </p>
              <p className="text-xs text-mist">
                WhatsApp &gt; Dispositivos vinculados &gt; Vincular un dispositivo &gt; Vincular con número de teléfono
              </p>
            </>
          ) : estado.qr ? (
            <>
              <p className="text-sm font-medium text-fg">Escanea el código QR con tu WhatsApp</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL local, no aplica optimización de imagen */}
              <img src={estado.qr} alt="Código QR para conectar WhatsApp" className="size-56 rounded-xl border border-edge" />
              <p className="text-xs text-mist">WhatsApp &gt; Dispositivos vinculados &gt; Vincular un dispositivo</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-fg">
                {modo === "codigo" ? "Generando tu código..." : "Generando el código QR..."}
              </p>
              <div className="flex size-56 items-center justify-center rounded-xl border border-edge">
                <Loader2 className="size-6 animate-spin text-mist" />
              </div>
            </>
          )}
          <AmoreSecondaryButton onClick={conectar} disabled={cargando} className="w-full">
            {estado.codigoVinculacion ? "Generar otro código" : "Actualizar código QR"}
          </AmoreSecondaryButton>
        </AmoreCard>
      ) : (
        <>
          <AmoreCard className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-ink-2 text-mist">
              <MessageCircle className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">🔴 WhatsApp desconectado</p>
              <p className="truncate text-xs text-mist">Conecta tu WhatsApp para enviar y recibir mensajes</p>
            </div>
          </AmoreCard>

          <AmoreSegmentedTabs
            opciones={[
              { valor: "qr", etiqueta: "Código QR" },
              { valor: "codigo", etiqueta: "Vincular con número" },
            ]}
            activo={modo}
            onChange={setModo}
          />

          {modo === "codigo" && (
            <label className="flex items-center gap-2.5 rounded-2xl border border-edge bg-card px-4 py-2.5">
              <span className="text-sm text-mist">+</span>
              <input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="Ej. 573001234567"
                inputMode="tel"
                className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-mist"
              />
            </label>
          )}

          <AmoreSecondaryButton onClick={conectar} disabled={cargando}>
            Conectar WhatsApp
          </AmoreSecondaryButton>
        </>
      )}

      <div>
        <AmoreSectionTitle title="Uso de WhatsApp" />
        <AmoreCard className="mt-2.5 !p-0">
          {(uso ?? []).map((u, i) => (
            <div key={u.label}>
              <div className="flex items-center justify-between p-3.5">
                <p className="text-sm text-fg">{u.label}</p>
                <p className="text-sm font-semibold text-fg">{u.cantidad}</p>
              </div>
              {i < (uso?.length ?? 0) - 1 && <AmoreDivider />}
            </div>
          ))}
        </AmoreCard>
      </div>
    </div>
  );
}
