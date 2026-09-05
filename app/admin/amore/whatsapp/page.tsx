"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Loader2 } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { AdminOnlyDesktop } from "@/components/admin-web/AdminOnlyDesktop";

type EstadoConexion = "desconectado" | "conectando" | "conectado";
type EstadoPublico = {
  estado: EstadoConexion;
  numeroConectado: string | null;
  conectadoEn: string | null;
  qr: string | null;
  codigoVinculacion: string | null;
};
type UsoWhatsApp = { label: string; cantidad: number };
type ModoConexion = "qr" | "codigo";

function formatearCodigo(codigo: string): string {
  return codigo.length === 8 ? `${codigo.slice(0, 4)}-${codigo.slice(4)}` : codigo;
}

// Panel web AMORE (autorizado) — WhatsApp desktop: MISMAS APIs reales del
// worker (Vercel -> Railway -> Baileys -> Supabase) que ya usa el móvil,
// incluida "vincular con número" -- cero infraestructura nueva. Admin-only.
export default function AdminAmoreWhatsappPage() {
  return (
    <AdminOnlyDesktop>
      <WhatsappContenido />
    </AdminOnlyDesktop>
  );
}

function WhatsappContenido() {
  const { token } = useAdminWeb();
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
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">WhatsApp</h1>
        <p className="text-sm text-mist">Conexión con tus clientas</p>
      </div>

      {error && <p className="text-sm text-danger-text">{error}</p>}

      <div className="rounded-2xl border border-edge bg-card p-5 shadow-sm">
        {!estado ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-mist" />
          </div>
        ) : estado.estado === "conectado" ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-success text-success-text">
                <MessageCircle className="size-5" />
              </div>
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium text-fg">
                  <span className="size-2 rounded-full bg-success-text" /> 🟢 WhatsApp conectado
                </p>
                <p className="text-xs text-mist">
                  {estado.numeroConectado ? `+${estado.numeroConectado}` : "Número no disponible"}
                  {estado.conectadoEn && ` · desde ${new Date(estado.conectadoEn).toLocaleString("es-CO")}`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={desconectar}
              disabled={cargando}
              className="rounded-xl bg-danger py-2.5 text-sm font-medium text-danger-text disabled:opacity-50"
            >
              Desconectar
            </button>
          </div>
        ) : estado.estado === "conectando" ? (
          <div className="flex flex-col items-center gap-3 text-center">
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
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL local, no aplica optimización */}
                <img src={estado.qr} alt="Código QR para conectar WhatsApp" className="size-64 rounded-xl border border-edge" />
                <p className="text-xs text-mist">WhatsApp &gt; Dispositivos vinculados &gt; Vincular un dispositivo</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-fg">{modo === "codigo" ? "Generando tu código..." : "Generando el código QR..."}</p>
                <div className="flex size-64 items-center justify-center rounded-xl border border-edge">
                  <Loader2 className="size-6 animate-spin text-mist" />
                </div>
              </>
            )}
            <button
              type="button"
              onClick={conectar}
              disabled={cargando}
              className="w-full rounded-xl bg-lime-soft py-2.5 text-sm font-medium text-lime-text disabled:opacity-50"
            >
              {estado.codigoVinculacion ? "Generar otro código" : "Actualizar código QR"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-ink-2 text-mist">
                <MessageCircle className="size-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-fg">🔴 WhatsApp desconectado</p>
                <p className="text-xs text-mist">Conecta tu WhatsApp para enviar y recibir mensajes</p>
              </div>
            </div>

            <div className="flex rounded-xl border border-edge bg-ink p-1">
              {(["qr", "codigo"] as ModoConexion[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModo(m)}
                  className={`flex-1 rounded-lg py-2 text-sm font-medium ${modo === m ? "bg-lime text-lime-fg" : "text-mist"}`}
                >
                  {m === "qr" ? "Código QR" : "Vincular con número"}
                </button>
              ))}
            </div>

            {modo === "codigo" && (
              <label className="flex items-center gap-2.5 rounded-xl border border-edge bg-ink px-4 py-2.5">
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

            <button
              type="button"
              onClick={conectar}
              disabled={cargando}
              className="rounded-xl bg-lime-soft py-2.5 text-sm font-medium text-lime-text disabled:opacity-50"
            >
              Conectar WhatsApp
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-edge bg-card shadow-sm">
        <h2 className="p-5 pb-2 text-base font-semibold text-fg">Uso de WhatsApp</h2>
        <div className="flex flex-col divide-y divide-edge">
          {(uso ?? []).map((u) => (
            <div key={u.label} className="flex items-center justify-between px-5 py-3">
              <p className="text-sm text-fg">{u.label}</p>
              <p className="text-sm font-semibold text-fg">{u.cantidad}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
