"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";
import { inputCls } from "@/components/dashboard/business-agent/ui";
import { FichaCliente } from "@/components/dashboard/publibordados/clientes/FichaCliente";
import { FichaSolicitud } from "@/components/dashboard/publibordados/clientes/FichaSolicitud";
import { fecha, fechaHora, telefono } from "@/components/dashboard/publibordados/clientes/formato";
import { Aviso, cn, EstadoPill, Paginacion, Pestanas, useAccesoPb, useConsulta } from "@/components/dashboard/publibordados/clientes/ui";
import { useI18n } from "@/lib/i18n";
import { ETIQUETA_TIPO, type Asesor, type Cliente, type Solicitud, type TipoCliente } from "@/lib/publibordados/clientes/modelo";

type Listado = { filas: Cliente[]; total: number; pagina: number; paginas: number; asesores: Asesor[] };
type Abierto = { tipo: "cliente"; id: number } | { tipo: "solicitud"; solicitud: Solicitud; asesores: Asesor[]; desdeCliente: number | null };

export default function ClientesPage() {
  const { t } = useI18n();
  const { token, habilitado, listo, puedeEditar } = useAccesoPb();
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState<"todos" | TipoCliente>("todos");
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
    if (tipo !== "todos") p.set("tipo", tipo);
    return `/api/dashboard/publibordados/clientes?${p}`;
  }, [habilitado, pagina, q, tipo]);
  const { data, error, cargando } = useConsulta<Listado>(url, token, recarga);

  const filtros: Array<{ id: "todos" | TipoCliente; label: string }> = [
    { id: "todos", label: t("Todos", "All") },
    { id: "persona_natural", label: ETIQUETA_TIPO.persona_natural },
    { id: "empresa", label: ETIQUETA_TIPO.empresa },
  ];

  if (listo && !habilitado) {
    return (
      <div className="pb-12">
        <PageHeader title={t("Clientes", "Customers")} />
        <p className="px-4 pt-6 text-sm text-mist md:px-8">{t("El módulo Clientes no está habilitado para tu cuenta.", "The Customers module isn't enabled for your account.")}</p>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Publi Bordados"
        title={t("Clientes", "Customers")}
        description={t(
          "Cada cliente una sola vez, con el historial de todas sus solicitudes.",
          "Each customer once, with the history of all their requests.",
        )}
      >
        <Pestanas activa="clientes" />
      </PageHeader>

      <div className="px-4 pt-6 md:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={t("Buscar por nombre, empresa o teléfono", "Search by name, company or phone")}
              aria-label={t("Buscar clientes", "Search customers")}
              className={cn(inputCls, "pl-9")}
            />
          </div>
          <div className="flex rounded-lg border border-edge p-0.5" role="group" aria-label={t("Tipo de cliente", "Customer type")}>
            {filtros.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setTipo(f.id);
                  setPagina(1);
                }}
                aria-pressed={tipo === f.id}
                className={cn("rounded-md px-3 py-1.5 text-sm transition-colors", tipo === f.id ? "bg-card font-medium text-fg" : "text-mist hover:text-fg")}
              >
                {f.label}
              </button>
            ))}
          </div>
          {data && (
            <Pill>
              {data.total} {data.total === 1 ? t("cliente", "customer") : t("clientes", "customers")}
            </Pill>
          )}
        </div>

        <section className="mt-5 overflow-hidden rounded-xl border border-edge bg-card">
          {error && <Aviso tipo="error">{error}</Aviso>}
          {!data ? (
            !error && <Aviso tipo="cargando">{t("Cargando…", "Loading…")}</Aviso>
          ) : data.filas.length === 0 ? (
            <Aviso tipo="vacio">
              {q || tipo !== "todos"
                ? t("Ningún cliente coincide con la búsqueda.", "No customers match your search.")
                : t("Todavía no hay clientes. Aparecen aquí cuando alguien completa la conversación del bot.", "No customers yet. They appear here when someone completes the bot conversation.")}
            </Aviso>
          ) : (
            <div className={cn("overflow-x-auto", cargando && "opacity-60")}>
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b border-edge text-xs text-mist">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t("Cliente", "Customer")}</th>
                    <th className="px-4 py-3 font-medium">{t("Teléfono", "Phone")}</th>
                    <th className="px-4 py-3 text-right font-medium">{t("Solicitudes", "Requests")}</th>
                    <th className="px-4 py-3 font-medium">{t("Última solicitud", "Latest request")}</th>
                    <th className="px-4 py-3 font-medium">{t("Estado", "Status")}</th>
                    <th className="px-4 py-3 font-medium">{t("Asesor", "Advisor")}</th>
                    <th className="px-4 py-3 font-medium">{t("Primer registro", "First registered")}</th>
                    <th className="px-4 py-3 font-medium">{t("Último contacto", "Last contact")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                  {data.filas.map((c) => (
                    <tr
                      key={c.id}
                      tabIndex={0}
                      onClick={() => setAbierto({ tipo: "cliente", id: c.id })}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setAbierto({ tipo: "cliente", id: c.id }))}
                      className="cursor-pointer transition-colors hover:bg-ink focus:bg-ink focus:outline-none"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-fg">{c.nombre}</p>
                        <p className="text-xs text-mist">
                          {c.tipoCliente ? ETIQUETA_TIPO[c.tipoCliente] : "—"}
                          {c.nombreEmpresa ? ` · ${c.nombreEmpresa}` : ""}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-fg">{telefono(c.telefono)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg">{c.totalSolicitudes}</td>
                      <td className="px-4 py-3 text-fg">
                        {c.ultimaSolicitud ? (
                          <>
                            {c.ultimaSolicitud.productoEtiqueta} · {c.ultimaSolicitud.cantidad}
                            <p className="text-xs text-mist">{fechaHora(c.ultimaSolicitudAt)}</p>
                          </>
                        ) : (
                          <span className="text-mist">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{c.ultimaSolicitud ? <EstadoPill estado={c.ultimaSolicitud.estado} /> : <span className="text-mist">—</span>}</td>
                      <td className="px-4 py-3 text-fg">{c.ultimaSolicitud?.asesor?.nombre ?? <span className="text-mist">—</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-mist">{fecha(c.registradoAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-mist">{fechaHora(c.ultimoContactoAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {data && <Paginacion pagina={data.pagina} paginas={data.paginas} cargando={cargando} onCambiar={setPagina} />}
      </div>

      {abierto?.tipo === "cliente" && (
        <FichaCliente
          clienteId={abierto.id}
          token={token}
          recarga={recarga}
          onCerrar={() => setAbierto(null)}
          onAbrirSolicitud={(s, asesores) => setAbierto({ tipo: "solicitud", solicitud: s, asesores, desdeCliente: abierto.id })}
        />
      )}
      {abierto?.tipo === "solicitud" && (
        <FichaSolicitud
          key={abierto.solicitud.id}
          solicitud={abierto.solicitud}
          asesores={abierto.asesores}
          puedeEditar={puedeEditar}
          token={token}
          onCerrar={() => setAbierto(abierto.desdeCliente ? { tipo: "cliente", id: abierto.desdeCliente } : null)}
          onGuardada={() => setRecarga((v) => v + 1)}
        />
      )}
    </div>
  );
}
