"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";
import { actionBtn, inputCls } from "@/components/dashboard/business-agent/ui";
import { FichaCliente, TONO_ESTADO } from "@/components/dashboard/clientes/FichaCliente";
import { fecha, fechaHora, telefono } from "@/components/dashboard/clientes/formato";
import { useDashboard } from "@/lib/dashboard-session";
import { useI18n } from "@/lib/i18n";
import {
  ESTADOS,
  ETIQUETA_ESTADO,
  ETIQUETA_TIPO,
  type Asesor,
  type Cliente,
  type EstadoCliente,
  type FiltroTipo,
} from "@/lib/clientes-modulo/modelo";

type Listado = { clientes: Cliente[]; total: number; pagina: number; paginas: number; asesores: Asesor[] };

function cn(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
}

export default function ClientesPage() {
  const { t } = useI18n();
  const { session, rol, modulos, negocios } = useDashboard();
  const token = session?.access_token ?? null;
  const habilitado = modulos.includes("clientes");
  const puedeEditar = rol === "admin" || rol === "agente";

  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState<FiltroTipo>("todos");
  const [estado, setEstado] = useState<EstadoCliente | "todos">("todos");
  const [pagina, setPagina] = useState(1);
  const [version, setVersion] = useState(0);
  const [resultado, setResultado] = useState<{ clave: string; listado: Listado | null; error: string | null } | null>(null);
  const [abierto, setAbierto] = useState<Cliente | null>(null);

  // Búsqueda con debounce: una consulta por pausa de escritura, no por tecla.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(busqueda.trim());
      setPagina(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [busqueda]);

  const consulta = useMemo(() => {
    const p = new URLSearchParams({ tipo, estado, pagina: String(pagina) });
    if (q) p.set("q", q);
    return p.toString();
  }, [q, tipo, estado, pagina]);

  const clave = `${consulta}#${version}`;

  useEffect(() => {
    if (!token || !habilitado) return;
    let vivo = true;
    fetch(`/api/dashboard/clientes?${consulta}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("No se pudieron cargar los clientes.", "Couldn't load customers."));
        if (vivo) setResultado({ clave, listado: data as Listado, error: null });
      })
      .catch((err) => {
        // Se conserva el último listado bueno y se muestra el error.
        if (vivo) setResultado((prev) => ({ clave, listado: prev?.listado ?? null, error: err instanceof Error ? err.message : String(err) }));
      });
    return () => {
      vivo = false; // respuesta vieja: nunca pisa a la actual
    };
  }, [token, habilitado, consulta, clave, t]);

  const listado = resultado?.listado ?? null;
  const error = resultado?.error ?? null;
  const cargando = resultado?.clave !== clave;

  const guardar = useCallback(
    async (id: number, cambio: { estado?: EstadoCliente; asesorId?: number | null }): Promise<string | null> => {
      if (!token) return t("Sesión vencida.", "Session expired.");
      try {
        const res = await fetch(`/api/dashboard/clientes/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(cambio),
        });
        const data = await res.json();
        if (!res.ok) return data.error ?? t("No se pudo guardar.", "Couldn't save.");
        setAbierto(data.cliente as Cliente);
        setVersion((v) => v + 1);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    [token, t],
  );

  const filtrosTipo: Array<{ id: FiltroTipo; label: string }> = [
    { id: "todos", label: t("Todos", "All") },
    { id: "persona_natural", label: ETIQUETA_TIPO.persona_natural },
    { id: "empresa", label: ETIQUETA_TIPO.empresa },
  ];

  if (negocios !== null && !habilitado) {
    return (
      <div className="pb-12">
        <PageHeader title={t("Clientes", "Customers")} />
        <p className="px-4 pt-6 text-sm text-mist md:px-8">
          {t("El módulo Clientes no está habilitado para tu cuenta.", "The Customers module isn't enabled for your account.")}
        </p>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow={t("Operar", "Operate")}
        title={t("Clientes", "Customers")}
        description={t(
          "Clientes que completaron la calificación por WhatsApp. Se registran y actualizan solos al pasar con una asesora.",
          "Customers who completed the WhatsApp qualification. They're created and updated automatically when handed to an advisor.",
        )}
      >
        {listado && (
          <Pill>
            {listado.total} {listado.total === 1 ? t("cliente", "customer") : t("clientes", "customers")}
          </Pill>
        )}
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
            {filtrosTipo.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setTipo(f.id);
                  setPagina(1);
                }}
                aria-pressed={tipo === f.id}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  tipo === f.id ? "bg-card font-medium text-fg" : "text-mist hover:text-fg",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <select
            value={estado}
            onChange={(e) => {
              setEstado(e.target.value as EstadoCliente | "todos");
              setPagina(1);
            }}
            aria-label={t("Estado", "Status")}
            className={cn(inputCls, "lg:w-44")}
          >
            <option value="todos">{t("Todos los estados", "All statuses")}</option>
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO[e]}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <section className="mt-5 overflow-hidden rounded-xl border border-edge bg-card">
          {listado === null ? (
            <p className="p-5 text-sm text-mist">{t("Cargando…", "Loading…")}</p>
          ) : listado.clientes.length === 0 ? (
            <p className="p-5 text-sm text-mist">
              {q || tipo !== "todos" || estado !== "todos"
                ? t("Ningún cliente coincide con la búsqueda.", "No customers match your search.")
                : t(
                    "Todavía no hay clientes. Aparecerán aquí cuando alguien complete la conversación del bot.",
                    "No customers yet. They'll appear here when someone completes the bot conversation.",
                  )}
            </p>
          ) : (
            <div className={cn("overflow-x-auto", cargando && "opacity-60")}>
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="border-b border-edge text-xs text-mist">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t("Nombre", "Name")}</th>
                    <th className="px-4 py-3 font-medium">{t("Teléfono", "Phone")}</th>
                    <th className="px-4 py-3 font-medium">{t("Producto", "Product")}</th>
                    <th className="px-4 py-3 text-right font-medium">{t("Cantidad", "Qty")}</th>
                    <th className="px-4 py-3 font-medium">{t("Estado", "Status")}</th>
                    <th className="px-4 py-3 font-medium">{t("Asesor", "Advisor")}</th>
                    <th className="px-4 py-3 font-medium">{t("Registro", "Registered")}</th>
                    <th className="px-4 py-3 font-medium">{t("Última solicitud", "Latest request")}</th>
                    <th className="px-4 py-3 font-medium">{t("Último contacto", "Last contact")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                  {listado.clientes.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => setAbierto(c)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setAbierto(c))}
                      tabIndex={0}
                      className="cursor-pointer transition-colors hover:bg-ink focus:bg-ink focus:outline-none"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-fg">{c.nombre}</p>
                        <p className="text-xs text-mist">
                          {c.tipo ? ETIQUETA_TIPO[c.tipo] : "—"}
                          {c.nombreEmpresa ? ` · ${c.nombreEmpresa}` : ""}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-fg">{telefono(c.telefono)}</td>
                      <td className="px-4 py-3 text-fg">{c.productoEtiqueta ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg">{c.cantidad ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Pill tone={TONO_ESTADO[c.estado]}>{ETIQUETA_ESTADO[c.estado]}</Pill>
                      </td>
                      <td className="px-4 py-3 text-fg">{c.asesor?.nombre ?? <span className="text-mist">—</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-mist">{fecha(c.registradoEn)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-mist">{fechaHora(c.ultimaSolicitudEn)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-mist">{fechaHora(c.ultimoContactoEn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {listado && listado.paginas > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-mist">
            <span>
              {t("Página", "Page")} {listado.pagina} / {listado.paginas}
            </span>
            <div className="flex gap-2">
              <button className={actionBtn} disabled={listado.pagina <= 1 || cargando} onClick={() => setPagina(listado.pagina - 1)}>
                <ChevronLeft className="size-4" />
                {t("Anterior", "Previous")}
              </button>
              <button
                className={actionBtn}
                disabled={listado.pagina >= listado.paginas || cargando}
                onClick={() => setPagina(listado.pagina + 1)}
              >
                {t("Siguiente", "Next")}
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {abierto && listado && (
        <FichaCliente
          key={`${abierto.id}:${abierto.estado}:${abierto.asesor?.id ?? ""}`}
          cliente={abierto}
          asesores={listado.asesores}
          puedeEditar={puedeEditar}
          onCerrar={() => setAbierto(null)}
          onGuardar={(cambio) => guardar(abierto.id, cambio)}
        />
      )}
    </div>
  );
}
