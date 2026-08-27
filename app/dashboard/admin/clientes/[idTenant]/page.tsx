"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";
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
};

const ESTADOS_IMPLEMENTACION = ["PENDIENTE", "EN_CONFIGURACION", "EN_PRUEBAS", "ACTIVO", "REQUIERE_ATENCION"];

// Fase 5/8 del brief: "¿qué tengo que hacer con este cliente AHORA?" -- una
// sola acción principal según el estado actual, no una lista de botones
// genéricos. REQUIERE_ATENCION no tiene "siguiente paso" (ya es el caso
// especial), así que no aparece aquí -- sigue disponible como pill manual.
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

export default function DetalleClientePage() {
  const params = useParams<{ idTenant: string }>();
  const { session } = useDashboard();
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

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
  if (!detalle) {
    return (
      <div>
        <PageHeader eyebrow="Panel de Operaciones" title="Cliente" />
        <div className="px-4 py-6 md:px-8">
          <p className="text-sm text-mist">Cargando…</p>
        </div>
      </div>
    );
  }

  const { cliente, onboarding, implementacion } = detalle;

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

      <div className="grid grid-cols-1 gap-5 px-4 py-6 md:grid-cols-2 md:px-8">
        {error && (
          <p className="md:col-span-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>
        )}

        <section className="rounded-xl border border-edge bg-card p-5">
          <p className="mb-4 text-sm font-semibold text-fg">Información del cliente</p>
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
        </section>

        <section className="rounded-xl border border-edge bg-card p-5">
          <p className="mb-4 text-sm font-semibold text-fg">Implementación</p>

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
                <button
                  key={e}
                  disabled={guardando || !implementacion || implementacion.estado === e}
                  onClick={() => cambiarEstado(e)}
                  className="disabled:cursor-not-allowed"
                >
                  <Pill
                    tone={toneEstadoImplementacion(e)}
                    className={
                      !implementacion
                        ? "opacity-40"
                        : implementacion.estado === e
                          ? "ring-1 ring-lime/60"
                          : "opacity-60 hover:opacity-100"
                    }
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
        </section>

        <section className="rounded-xl border border-edge bg-card p-5 md:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-fg">Onboarding</p>
            {onboarding && <Pill tone="info">{labelEstadoOnboarding(onboarding.estado)}</Pill>}
          </div>
          {onboarding ? (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              <Bloque label="Descripción del negocio" texto={onboarding.businessDescription} />
              <Bloque label="Qué quiere implementar" texto={onboarding.implementationIdea} />
              <Bloque label="Información adicional" texto={onboarding.additionalInformation} />
            </div>
          ) : (
            <p className="text-sm text-mist">Sin onboarding todavía.</p>
          )}
        </section>
      </div>
    </div>
  );
}
