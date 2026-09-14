"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";
import { useDashboard } from "@/lib/dashboard-session";
import { PLANES, ORDEN_PLANES_ADMIN, resolverPlanId, familiaDePlan } from "@/lib/planes";
import { labelEstadoPago, toneEstadoPago } from "@/lib/admin-ui";
import { formatearTelefono } from "@/lib/format";

type Detalle = {
  cliente: { idTenant: string; nombre: string | null; correo: string | null; telefono: string | null; plan: string; fechaCompra: string; estadoPago: string };
  onboarding: { estado: string } | null;
  implementacion: { estado: string } | null;
};

type Suscripcion = { plan: string; estado: string; precio_cop: number; fecha_proximo_cobro: string; cancelar_al_vencer: boolean } | null;
type Pago = { id: number; monto_cop: number; estado: string; tipo: string; plan: string | null; created_at: string };
type CambioPlan = { plan_anterior: string | null; plan_nuevo: string; precio_nuevo_cop: number; motivo: string | null; created_at: string };
type NumeroWA = { phoneNumberId: string; nombreNegocio: string; telefonoNegocio: string; estadoConexion: string };
type NumeroFlow = { phoneNumberId: string; nombreNegocio: string; flowActivo: boolean; flowId: string | null; flow: { name: string; status: string } | null; ultimaEjecucion: { status: string; last_activity_at: string } | null; iaPausada: boolean };
type Miembro = { id: number; email: string; nombre: string | null; rol: string; estado: string };

function Seccion({ titulo, children, accion }: { titulo: string; children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">{titulo}</h2>
        {accion}
      </div>
      {children}
    </div>
  );
}

function Boton({ onClick, children, variante = "default", disabled }: { onClick: () => void; children: React.ReactNode; variante?: "default" | "peligro"; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        variante === "peligro" ? "border-red-500/40 text-red-400 hover:bg-red-500/10" : "border-edge text-fg hover:bg-ink"
      }`}
    >
      {children}
    </button>
  );
}

export default function AdminClienteDetallePage() {
  const { session } = useDashboard();
  const params = useParams<{ idTenant: string }>();
  const idTenant = params.idTenant;

  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [suscripcion, setSuscripcion] = useState<Suscripcion>(null);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [historialPlanes, setHistorialPlanes] = useState<CambioPlan[]>([]);
  const [numerosWA, setNumerosWA] = useState<NumeroWA[]>([]);
  const [numerosFlow, setNumerosFlow] = useState<NumeroFlow[]>([]);
  const [equipo, setEquipo] = useState<Miembro[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planSeleccionado, setPlanSeleccionado] = useState("");

  const auth = useCallback((): Record<string, string> => (session ? { Authorization: `Bearer ${session.access_token}` } : {}), [session]);

  const cargarTodo = useCallback(async () => {
    if (!session) return;
    const headers = auth();
    const [detalleRes, susRes, waRes, flowRes, equipoRes] = await Promise.all([
      fetch(`/api/dashboard/admin/clientes/${idTenant}`, { headers }),
      fetch(`/api/dashboard/admin/clientes/${idTenant}/suscripcion`, { headers }),
      fetch(`/api/dashboard/admin/clientes/${idTenant}/whatsapp`, { headers }),
      fetch(`/api/dashboard/admin/clientes/${idTenant}/flow`, { headers }),
      fetch(`/api/dashboard/admin/clientes/${idTenant}/equipo`, { headers }),
    ]);
    const [detalleData, susData, waData, flowData, equipoData] = await Promise.all([detalleRes.json(), susRes.json(), waRes.json(), flowRes.json(), equipoRes.json()]);
    if (detalleRes.ok) setDetalle(detalleData);
    if (susRes.ok) {
      setSuscripcion(susData.suscripcion);
      setPagos(susData.pagos ?? []);
      setHistorialPlanes(susData.historialPlanes ?? []);
    }
    if (waRes.ok) setNumerosWA(waData.numeros ?? []);
    if (flowRes.ok) setNumerosFlow(flowData.numeros ?? []);
    if (equipoRes.ok) setEquipo(equipoData.miembros ?? []);
  }, [session, idTenant, auth]);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        await cargarTodo();
      } catch (err) {
        if (!cancelado) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [cargarTodo]);

  async function ejecutar(url: string, body: unknown, exito: string) {
    if (!session) return;
    setError(null);
    setMensaje(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "La acción falló");
      setMensaje(exito);
      await cargarTodo();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!detalle) {
    return (
      <div>
        <PageHeader eyebrow="Centro de Operaciones" title="Cliente" />
        {error ? <p className="p-8 text-sm text-red-400">{error}</p> : <p className="p-8 text-sm text-mist">Cargando…</p>}
      </div>
    );
  }

  const { cliente } = detalle;
  const planActualId = resolverPlanId(cliente.plan);
  const opcionesPlan = (familiaDePlan(planActualId) ?? []).filter((id) => id !== planActualId);
  const cuentaBloqueada = equipo.length > 0 && equipo.every((m) => m.estado === "suspendido");

  return (
    <div>
      <PageHeader eyebrow="Centro de Operaciones" title={cliente.nombre ?? "Sin nombre"} description={cliente.correo ?? undefined}>
        <Pill tone={toneEstadoPago(cliente.estadoPago)}>{labelEstadoPago(cliente.estadoPago)}</Pill>
        {cuentaBloqueada && <Pill tone="danger">Cuenta bloqueada</Pill>}
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 px-4 py-6 md:grid-cols-2 md:px-8">
        {mensaje && <p className="rounded-lg border border-lime/40 bg-lime/10 p-3 text-sm text-lime-text md:col-span-2">{mensaje}</p>}
        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400 md:col-span-2">{error}</p>}

        <Seccion titulo="Información">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-mist">Tenant</dt><dd className="font-mono text-xs text-fg">{cliente.idTenant}</dd></div>
            <div><dt className="text-xs text-mist">Correo</dt><dd className="text-fg">{cliente.correo ?? "—"}</dd></div>
            <div><dt className="text-xs text-mist">Teléfono</dt><dd className="text-fg">{cliente.telefono ? formatearTelefono(cliente.telefono) : "—"}</dd></div>
            <div><dt className="text-xs text-mist">Alta</dt><dd className="text-fg">{new Date(cliente.fechaCompra).toLocaleDateString("es-CO")}</dd></div>
          </dl>
        </Seccion>

        <Seccion
          titulo="Cuenta"
          accion={
            cuentaBloqueada ? (
              <Boton onClick={() => ejecutar(`/api/dashboard/admin/clientes/${idTenant}/cuenta`, { accion: "desbloquear" }, "Cuenta desbloqueada.")}>Desbloquear cuenta</Boton>
            ) : (
              <Boton variante="peligro" onClick={() => confirm("¿Bloquear el acceso de todos los miembros de este equipo?") && ejecutar(`/api/dashboard/admin/clientes/${idTenant}/cuenta`, { accion: "bloquear" }, "Cuenta bloqueada.")}>
                Bloquear cuenta
              </Boton>
            )
          }
        >
          <p className="text-sm text-mist">{cuentaBloqueada ? "Todos los miembros del equipo están suspendidos: nadie puede iniciar sesión." : "Acceso normal."}</p>
          <div className="mt-3">
            <Boton onClick={() => ejecutar(`/api/dashboard/admin/clientes/${idTenant}/acceso`, { accion: "reset_password" }, "Correo de restablecimiento de contraseña enviado.")}>Enviar reset de contraseña</Boton>
          </div>
        </Seccion>

        <Seccion titulo="Suscripción">
          {suscripcion ? (
            <>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-mist">Plan</dt><dd className="text-fg">{PLANES[resolverPlanId(suscripcion.plan)].nombre}</dd></div>
                <div><dt className="text-xs text-mist">Precio</dt><dd className="text-fg">${suscripcion.precio_cop.toLocaleString("es-CO")} COP</dd></div>
                <div><dt className="text-xs text-mist">Estado</dt><dd><Pill tone={toneEstadoPago(suscripcion.estado)}>{labelEstadoPago(suscripcion.estado)}</Pill></dd></div>
                <div><dt className="text-xs text-mist">Próximo cobro</dt><dd className="text-fg">{new Date(suscripcion.fecha_proximo_cobro + "T00:00:00").toLocaleDateString("es-CO")}</dd></div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-edge pt-4">
                {suscripcion.estado === "activa" && !suscripcion.cancelar_al_vencer && (
                  <Boton variante="peligro" onClick={() => confirm("¿Cancelar la suscripción? Conserva el servicio hasta el próximo cobro.") && ejecutar(`/api/dashboard/admin/clientes/${idTenant}/suscripcion`, { accion: "cancelar" }, "Suscripción cancelada.")}>
                    Cancelar
                  </Boton>
                )}
                {suscripcion.cancelar_al_vencer && (
                  <Boton onClick={() => ejecutar(`/api/dashboard/admin/clientes/${idTenant}/suscripcion`, { accion: "reactivar" }, "Suscripción reactivada.")}>Reactivar</Boton>
                )}
                {suscripcion.estado !== "activa" && (
                  <Boton onClick={() => ejecutar(`/api/dashboard/admin/clientes/${idTenant}/suscripcion`, { accion: "activar", plan: suscripcion.plan }, "Suscripción activada manualmente.")}>Activar manualmente</Boton>
                )}
              </div>

              {opcionesPlan.length > 0 && suscripcion.estado === "activa" && (
                <div className="mt-4 flex items-center gap-2 border-t border-edge pt-4">
                  <select value={planSeleccionado} onChange={(e) => setPlanSeleccionado(e.target.value)} className="rounded-lg border border-edge bg-ink-2 px-3 py-1.5 text-xs text-fg">
                    <option value="">Cambiar a…</option>
                    {opcionesPlan.map((id) => (
                      <option key={id} value={id}>{PLANES[id].nombre}</option>
                    ))}
                  </select>
                  <Boton
                    disabled={!planSeleccionado}
                    onClick={() => {
                      ejecutar(`/api/dashboard/admin/clientes/${idTenant}/suscripcion`, { accion: "cambiar_plan", plan: planSeleccionado, motivo: "Cambio manual desde el Panel de Operaciones" }, "Plan cambiado.");
                      setPlanSeleccionado("");
                    }}
                  >
                    Confirmar cambio
                  </Boton>
                </div>
              )}
            </>
          ) : (
            <div>
              <p className="mb-3 text-sm text-mist">Sin suscripción todavía.</p>
              <div className="flex items-center gap-2">
                <select value={planSeleccionado} onChange={(e) => setPlanSeleccionado(e.target.value)} className="rounded-lg border border-edge bg-ink-2 px-3 py-1.5 text-xs text-fg">
                  <option value="">Elegir plan…</option>
                  {ORDEN_PLANES_ADMIN.filter((p) => PLANES[p].precioCop !== null).map((p) => (
                    <option key={p} value={p}>{PLANES[p].nombre}</option>
                  ))}
                </select>
                <Boton disabled={!planSeleccionado} onClick={() => ejecutar(`/api/dashboard/admin/clientes/${idTenant}/suscripcion`, { accion: "activar", plan: planSeleccionado }, "Suscripción activada.")}>
                  Activar
                </Boton>
              </div>
            </div>
          )}
        </Seccion>

        <Seccion titulo="WhatsApp">
          {numerosWA.length === 0 && <p className="text-sm text-mist">Sin números conectados.</p>}
          <div className="flex flex-col gap-3">
            {numerosWA.map((n) => (
              <div key={n.phoneNumberId} className="flex items-center justify-between border-b border-edge pb-2 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm text-fg">{n.nombreNegocio}</p>
                  <p className="text-xs text-mist">{formatearTelefono(n.telefonoNegocio)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={n.estadoConexion === "conectado" ? "success" : "danger"}>{n.estadoConexion}</Pill>
                  {n.estadoConexion !== "desconectado" && (
                    <Boton variante="peligro" onClick={() => confirm(`¿Desconectar ${n.nombreNegocio} de WhatsApp?`) && ejecutar(`/api/dashboard/admin/clientes/${idTenant}/whatsapp`, { phone_number_id: n.phoneNumberId, accion: "desconectar" }, "Número desconectado.")}>
                      Desconectar
                    </Boton>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Seccion>

        <Seccion titulo="Bot & Flow">
          {numerosFlow.length === 0 && <p className="text-sm text-mist">Sin números configurados.</p>}
          <div className="flex flex-col gap-3">
            {numerosFlow.map((n) => (
              <div key={n.phoneNumberId} className="border-b border-edge pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-fg">{n.nombreNegocio}</p>
                    <Pill tone={n.iaPausada ? "warning" : "success"}>{n.iaPausada ? "bot pausado" : "bot activo"}</Pill>
                  </div>
                  <Boton
                    onClick={() =>
                      ejecutar(
                        `/api/dashboard/admin/clientes/${idTenant}/bot`,
                        { phone_number_id: n.phoneNumberId, accion: n.iaPausada ? "reactivar" : "pausar" },
                        n.iaPausada ? "Bot reactivado." : "Bot pausado.",
                      )
                    }
                  >
                    {n.iaPausada ? "Reactivar bot" : "Pausar bot"}
                  </Boton>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-mist">
                  <span>Flow: {n.flow?.name ?? "sin Flow"}</span>
                  {n.flowActivo && <Pill tone="success">activo</Pill>}
                  {n.ultimaEjecucion?.status === "failed" && <Pill tone="danger">última ejecución con error</Pill>}
                </div>
                {n.flowId && (
                  <div className="mt-2">
                    <Boton onClick={() => ejecutar(`/api/dashboard/admin/clientes/${idTenant}/flow`, { phone_number_id: n.phoneNumberId, flow_id: n.flowId, accion: n.flowActivo ? "desactivar" : "activar" }, n.flowActivo ? "Flow desactivado." : "Flow activado.")}>
                      {n.flowActivo ? "Desactivar Flow" : "Activar Flow"}
                    </Boton>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Seccion>

        <Seccion titulo="Equipo">
          {equipo.length === 0 && <p className="text-sm text-mist">Sin miembros.</p>}
          <div className="flex flex-col gap-2">
            {equipo.map((m) => (
              <div key={m.id} className="flex items-center justify-between border-b border-edge pb-2 text-sm last:border-0 last:pb-0">
                <div>
                  <p className="text-fg">{m.nombre ?? m.email}</p>
                  <p className="text-xs text-mist">{m.rol}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={m.estado === "activo" ? "success" : m.estado === "suspendido" ? "danger" : "neutral"}>{m.estado}</Pill>
                  {m.estado !== "suspendido" ? (
                    <Boton variante="peligro" onClick={() => ejecutar(`/api/dashboard/admin/clientes/${idTenant}/equipo`, { miembro_id: m.id, estado: "suspendido" }, "Miembro suspendido.")}>Suspender</Boton>
                  ) : (
                    <Boton onClick={() => ejecutar(`/api/dashboard/admin/clientes/${idTenant}/equipo`, { miembro_id: m.id, estado: "activo" }, "Miembro reactivado.")}>Reactivar</Boton>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Seccion>

        <Seccion titulo="Historial de pagos">
          {pagos.length === 0 && <p className="text-sm text-mist">Sin pagos todavía.</p>}
          <div className="flex flex-col gap-1.5 text-sm">
            {pagos.slice(0, 8).map((p) => (
              <div key={p.id} className="flex items-center justify-between">
                <span className="text-mist">{new Date(p.created_at).toLocaleDateString("es-CO")}</span>
                <span className="text-fg">${p.monto_cop.toLocaleString("es-CO")}</span>
                <Pill tone={p.estado === "APPROVED" ? "success" : p.estado === "DECLINED" ? "danger" : "warning"}>{p.estado}</Pill>
              </div>
            ))}
          </div>
        </Seccion>

        <Seccion titulo="Historial de plan">
          {historialPlanes.length === 0 && <p className="text-sm text-mist">Sin cambios de plan registrados.</p>}
          <div className="flex flex-col gap-1.5 text-sm">
            {historialPlanes.slice(0, 8).map((h, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-mist">{new Date(h.created_at).toLocaleDateString("es-CO")}</span>
                <span className="text-fg">{h.plan_anterior ? `${h.plan_anterior} → ${h.plan_nuevo}` : `Alta: ${h.plan_nuevo}`}</span>
              </div>
            ))}
          </div>
        </Seccion>
      </div>
    </div>
  );
}
