"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";
import { PLANES, ORDEN_PLANES, resolverPlanId } from "@/lib/planes";
import { formatearTelefono } from "@/lib/format";
import {
  labelEstadoImplementacion,
  toneEstadoImplementacion,
  labelEstadoOnboarding,
  labelEstadoPago,
  toneEstadoPago,
} from "@/lib/admin-ui";

type ClienteFila = {
  idTenant: string;
  nombre: string | null;
  correo: string | null;
  telefono: string | null;
  plan: string;
  fechaCompra: string;
  estadoPago: string;
  onboarding: { estado: string; estadoImplementacion: string; actualizadoAt: string } | null;
};

const ESTADOS_IMPLEMENTACION = ["PENDIENTE", "EN_CONFIGURACION", "EN_PRUEBAS", "ACTIVO", "REQUIERE_ATENCION"];
const ESTADOS_ONBOARDING = ["menu_enviado", "esperando_negocio", "esperando_idea", "esperando_adicional", "completado", "soporte_solicitado"];
const ESTADOS_PAGO = ["activa", "pendiente_pago", "vencida"];
const ORDENES = [
  { value: "reciente", label: "Más reciente" },
  { value: "antiguo", label: "Más antiguo" },
  { value: "actualizado", label: "Última actualización" },
];

function fechaCorta(fecha: string): string {
  return new Date(fecha).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
}

export default function AdminClientesPage() {
  const { session } = useDashboard();
  const [clientes, setClientes] = useState<ClienteFila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filtroImplementacion, setFiltroImplementacion] = useState("");
  const [filtroPlan, setFiltroPlan] = useState("");
  const [filtroOnboarding, setFiltroOnboarding] = useState("");
  const [filtroPago, setFiltroPago] = useState("");
  const [orden, setOrden] = useState("reciente");

  useEffect(() => {
    if (!session) return;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (filtroImplementacion) params.set("estado_implementacion", filtroImplementacion);
    if (filtroPlan) params.set("plan", filtroPlan);
    if (filtroOnboarding) params.set("estado_onboarding", filtroOnboarding);
    if (filtroPago) params.set("estado_pago", filtroPago);
    params.set("orden", orden);

    const timeout = setTimeout(() => {
      fetch(`/api/dashboard/admin/clientes?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Error cargando clientes");
          setClientes(data.clientes);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, 250); // debounce del buscador
    return () => clearTimeout(timeout);
  }, [session, q, filtroImplementacion, filtroPlan, filtroOnboarding, filtroPago, orden]);

  const selectClass = "rounded-lg border border-edge bg-ink-2 px-3 py-2 text-sm text-fg outline-none focus:border-lime/50";

  const filaVacia = useMemo(() => clientes !== null && clientes.length === 0, [clientes]);

  return (
    <div>
      <PageHeader eyebrow="Panel de Operaciones" title="Clientes" description="Todos los clientes que han pagado un plan de DuLabs." />
      <div className="px-4 py-6 md:px-8">
        {error && <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre, correo o teléfono…"
              className="w-full rounded-lg border border-edge bg-ink-2 py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-lime/50 sm:w-72"
            />
          </div>
          <select className={selectClass} value={filtroImplementacion} onChange={(e) => setFiltroImplementacion(e.target.value)}>
            <option value="">Estado de implementación</option>
            {ESTADOS_IMPLEMENTACION.map((e) => (
              <option key={e} value={e}>
                {labelEstadoImplementacion(e)}
              </option>
            ))}
          </select>
          <select className={selectClass} value={filtroPago} onChange={(e) => setFiltroPago(e.target.value)}>
            <option value="">Estado de pago</option>
            {ESTADOS_PAGO.map((e) => (
              <option key={e} value={e}>
                {labelEstadoPago(e)}
              </option>
            ))}
          </select>
          <select className={selectClass} value={filtroPlan} onChange={(e) => setFiltroPlan(e.target.value)}>
            <option value="">Plan</option>
            {ORDEN_PLANES.map((p) => (
              <option key={p} value={p}>
                {PLANES[p].nombre}
              </option>
            ))}
          </select>
          <select className={selectClass} value={filtroOnboarding} onChange={(e) => setFiltroOnboarding(e.target.value)}>
            <option value="">Estado de onboarding</option>
            {ESTADOS_ONBOARDING.map((e) => (
              <option key={e} value={e}>
                {labelEstadoOnboarding(e)}
              </option>
            ))}
          </select>
          <select className={selectClass} value={orden} onChange={(e) => setOrden(e.target.value)}>
            {ORDENES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Móvil: tarjetas -- una tabla de 7 columnas no cabe en una pantalla chica */}
        <div className="flex flex-col gap-3 md:hidden">
          {(clientes ?? []).map((c) => (
            <Link
              key={c.idTenant}
              href={`/dashboard/admin/clientes/${c.idTenant}`}
              className="block rounded-xl border border-edge bg-card p-4 transition-colors hover:border-lime/30"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{c.nombre ?? "Sin nombre"}</p>
                  {c.correo && <p className="truncate text-xs text-mist">{c.correo}</p>}
                </div>
                {c.onboarding && <Pill tone={toneEstadoImplementacion(c.onboarding.estadoImplementacion)}>{labelEstadoImplementacion(c.onboarding.estadoImplementacion)}</Pill>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-mist">
                <span>{PLANES[resolverPlanId(c.plan)].nombre}</span>
                {c.telefono && <span>{formatearTelefono(c.telefono)}</span>}
                <span>{fechaCorta(c.fechaCompra)}</span>
                <Pill tone={toneEstadoPago(c.estadoPago)}>{labelEstadoPago(c.estadoPago)}</Pill>
              </div>
            </Link>
          ))}
          {filaVacia && <p className="py-8 text-center text-sm text-mist">No hay clientes que coincidan con estos filtros.</p>}
        </div>

        {/* Desktop/tablet: tabla */}
        <div className="hidden overflow-x-auto rounded-xl border border-edge bg-card md:block">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-edge text-left font-mono text-[10.5px] uppercase tracking-widest text-mist">
                <th className="px-5 py-3">Nombre</th>
                <th className="px-5 py-3">Plan</th>
                <th className="px-5 py-3">WhatsApp</th>
                <th className="px-5 py-3">Fecha de compra</th>
                <th className="px-5 py-3">Pago</th>
                <th className="px-5 py-3">Onboarding</th>
                <th className="px-5 py-3">Implementación</th>
                <th className="px-5 py-3">Última actualización</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {(clientes ?? []).map((c) => (
                <tr key={c.idTenant} className="cursor-pointer transition-colors hover:bg-ink">
                  <td className="px-5 py-3">
                    <Link href={`/dashboard/admin/clientes/${c.idTenant}`} className="block font-medium text-fg hover:text-lime-text">
                      {c.nombre ?? "Sin nombre"}
                    </Link>
                    {c.correo && <p className="text-xs text-mist">{c.correo}</p>}
                  </td>
                  <td className="px-5 py-3 text-fg">{PLANES[resolverPlanId(c.plan)].nombre}</td>
                  <td className="px-5 py-3 text-fg">{c.telefono ? formatearTelefono(c.telefono) : "—"}</td>
                  <td className="px-5 py-3 text-mist">{fechaCorta(c.fechaCompra)}</td>
                  <td className="px-5 py-3">
                    <Pill tone={toneEstadoPago(c.estadoPago)}>{labelEstadoPago(c.estadoPago)}</Pill>
                  </td>
                  <td className="px-5 py-3 text-mist">{c.onboarding ? labelEstadoOnboarding(c.onboarding.estado) : "Sin bienvenida enviada"}</td>
                  <td className="px-5 py-3">
                    {c.onboarding && <Pill tone={toneEstadoImplementacion(c.onboarding.estadoImplementacion)}>{labelEstadoImplementacion(c.onboarding.estadoImplementacion)}</Pill>}
                  </td>
                  <td className="px-5 py-3 text-mist">{c.onboarding ? fechaCorta(c.onboarding.actualizadoAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filaVacia && <p className="px-5 py-8 text-center text-sm text-mist">No hay clientes que coincidan con estos filtros.</p>}
        </div>
      </div>
    </div>
  );
}
