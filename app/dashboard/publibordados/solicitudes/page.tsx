"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";
import { inputCls } from "@/components/dashboard/business-agent/ui";
import { FichaCliente } from "@/components/dashboard/publibordados/clientes/FichaCliente";
import { FichaSolicitud } from "@/components/dashboard/publibordados/clientes/FichaSolicitud";
import { fechaHora, telefono } from "@/components/dashboard/publibordados/clientes/formato";
import { Aviso, cn, EstadoPill, Paginacion, Pestanas, useAccesoPb, useConsulta } from "@/components/dashboard/publibordados/clientes/ui";
import { useI18n } from "@/lib/i18n";
import {
  ESTADOS,
  ETIQUETA_ESTADO,
  ETIQUETA_PRODUCTO,
  ETIQUETA_TIPO,
  PRODUCTOS,
  TIPOS,
  type Asesor,
  type Solicitud,
} from "@/lib/publibordados/clientes/modelo";

type Listado = { filas: Solicitud[]; total: number; pagina: number; paginas: number; asesores: Asesor[] };
type Abierto = { tipo: "solicitud"; solicitud: Solicitud } | { tipo: "cliente"; id: number };

export default function SolicitudesPage() {
  const { t } = useI18n();
  const { token, habilitado, listo, puedeEditar } = useAccesoPb();
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [filtros, setFiltros] = useState({ estado: "", tipo: "", producto: "", asesor: "", desde: "", hasta: "" });
  const [pagina, setPagina] = useState(1);
  const [recarga, setRecarga] = useState(0);
  const [abierto, setAbierto] = useState<Abierto | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(busqueda.trim());
      setPagina(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [busqueda]);

  const url = useMemo(() => {
    if (!habilitado) return null;
    const p = new URLSearchParams({ pagina: String(pagina) });
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(filtros)) if (v) p.set(k, v);
    return `/api/dashboard/publibordados/solicitudes?${p}`;
  }, [habilitado, pagina, q, filtros]);
  const { data, error, cargando } = useConsulta<Listado>(url, token, recarga);

  const cambiarFiltro = (k: keyof typeof filtros, v: string) => {
    setFiltros((f) => ({ ...f, [k]: v }));
    setPagina(1);
  };
  const hayFiltros = Boolean(q) || Object.values(filtros).some(Boolean);

  if (listo && !habilitado) {
    return (
      <div className="pb-12">
        <PageHeader title={t("Solicitudes", "Requests")} />
        <p className="px-4 pt-6 text-sm text-mist md:px-8">{t("El módulo Clientes no está habilitado para tu cuenta.", "The Customers module isn't enabled for your account.")}</p>
      </div>
    );
  }

  const select = (id: string, label: string, valor: string, onChange: (v: string) => void, opciones: Array<[string, string]>) => (
    <select id={id} aria-label={label} value={valor} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, "lg:w-44")}>
      {opciones.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Publi Bordados"
        title={t("Solicitudes", "Requests")}
        description={t(
          "Cada conversación completada por el bot crea una solicitud. Cambia su estado y asesor sin afectar las demás.",
          "Each conversation completed by the bot creates a request. Change its status and advisor without affecting the others.",
        )}
      >
        <Pestanas activa="solicitudes" />
      </PageHeader>

      <div className="px-4 pt-6 md:px-8">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={t("Buscar por nombre, empresa o teléfono", "Search by name, company or phone")}
              aria-label={t("Buscar solicitudes", "Search requests")}
              className={cn(inputCls, "pl-9")}
            />
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
            {select("f-estado", t("Estado", "Status"), filtros.estado, (v) => cambiarFiltro("estado", v), [["", t("Todos los estados", "All statuses")], ...ESTADOS.map((e): [string, string] => [e, ETIQUETA_ESTADO[e]])])}
            {select("f-tipo", t("Tipo de cliente", "Customer type"), filtros.tipo, (v) => cambiarFiltro("tipo", v), [["", t("Todos los tipos", "All types")], ...TIPOS.map((x): [string, string] => [x, ETIQUETA_TIPO[x]])])}
            {select("f-producto", t("Producto", "Product"), filtros.producto, (v) => cambiarFiltro("producto", v), [["", t("Todos los productos", "All products")], ...PRODUCTOS.map((x): [string, string] => [x, ETIQUETA_PRODUCTO[x]])])}
            {select("f-asesor", t("Asesor", "Advisor"), filtros.asesor, (v) => cambiarFiltro("asesor", v), [
              ["", t("Todos los asesores", "All advisors")],
              ["ninguno", t("Sin asignar", "Unassigned")],
              ...(data?.asesores ?? []).map((a): [string, string] => [String(a.id), a.nombre]),
            ])}
            <label className="flex items-center gap-2 text-xs text-mist">
              {t("Desde", "From")}
              <input type="date" value={filtros.desde} onChange={(e) => cambiarFiltro("desde", e.target.value)} className={cn(inputCls, "lg:w-40")} />
            </label>
            <label className="flex items-center gap-2 text-xs text-mist">
              {t("Hasta", "To")}
              <input type="date" value={filtros.hasta} onChange={(e) => cambiarFiltro("hasta", e.target.value)} className={cn(inputCls, "lg:w-40")} />
            </label>
            {data && (
              <Pill>
                {data.total} {data.total === 1 ? t("solicitud", "request") : t("solicitudes", "requests")}
              </Pill>
            )}
          </div>
        </div>

        <section className="mt-5 overflow-hidden rounded-xl border border-edge bg-card">
          {error && <Aviso tipo="error">{error}</Aviso>}
          {!data ? (
            !error && <Aviso tipo="cargando">{t("Cargando…", "Loading…")}</Aviso>
          ) : data.filas.length === 0 ? (
            <Aviso tipo="vacio">
              {hayFiltros
                ? t("Ninguna solicitud coincide con los filtros.", "No requests match the filters.")
                : t("Todavía no hay solicitudes. Aparecen aquí cuando alguien completa la conversación del bot.", "No requests yet. They appear here when someone completes the bot conversation.")}
            </Aviso>
          ) : (
            <div className={cn("overflow-x-auto", cargando && "opacity-60")}>
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-edge text-xs text-mist">
                  <tr>
                    <th className="px-4 py-3 font-medium">#</th>
                    <th className="px-4 py-3 font-medium">{t("Fecha", "Date")}</th>
                    <th className="px-4 py-3 font-medium">{t("Cliente", "Customer")}</th>
                    <th className="px-4 py-3 font-medium">{t("Producto", "Product")}</th>
                    <th className="px-4 py-3 text-right font-medium">{t("Cantidad", "Qty")}</th>
                    <th className="px-4 py-3 font-medium">{t("Estado", "Status")}</th>
                    <th className="px-4 py-3 font-medium">{t("Asesor", "Advisor")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                  {data.filas.map((s) => (
                    <tr
                      key={s.id}
                      tabIndex={0}
                      onClick={() => setAbierto({ tipo: "solicitud", solicitud: s })}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setAbierto({ tipo: "solicitud", solicitud: s }))}
                      className="cursor-pointer transition-colors hover:bg-ink focus:bg-ink focus:outline-none"
                    >
                      <td className="px-4 py-3 text-mist">{s.id}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-mist">{fechaHora(s.createdAt)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-fg">{s.nombre}</p>
                        <p className="text-xs text-mist">
                          {ETIQUETA_TIPO[s.tipoCliente]}
                          {s.nombreEmpresa ? ` · ${s.nombreEmpresa}` : ""} · {telefono(s.telefono)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-fg">{s.productoEtiqueta}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg">{s.cantidad}</td>
                      <td className="px-4 py-3">
                        <EstadoPill estado={s.estado} />
                      </td>
                      <td className="px-4 py-3 text-fg">{s.asesor?.nombre ?? <span className="text-mist">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {data && <Paginacion pagina={data.pagina} paginas={data.paginas} cargando={cargando} onCambiar={setPagina} />}
      </div>

      {abierto?.tipo === "solicitud" && data && (
        <FichaSolicitud
          key={abierto.solicitud.id}
          solicitud={abierto.solicitud}
          asesores={data.asesores}
          puedeEditar={puedeEditar}
          token={token}
          onCerrar={() => setAbierto(null)}
          onGuardada={() => setRecarga((v) => v + 1)}
          onVerCliente={(id) => setAbierto({ tipo: "cliente", id })}
        />
      )}
      {abierto?.tipo === "cliente" && (
        <FichaCliente
          clienteId={abierto.id}
          token={token}
          recarga={recarga}
          onCerrar={() => setAbierto(null)}
          onAbrirSolicitud={(s) => setAbierto({ tipo: "solicitud", solicitud: s })}
        />
      )}
    </div>
  );
}
