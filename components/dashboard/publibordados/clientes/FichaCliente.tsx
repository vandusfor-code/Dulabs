"use client";

import { useI18n } from "@/lib/i18n";
import { ETIQUETA_TIPO, type Asesor, type ClienteDetalle, type Solicitud } from "@/lib/publibordados/clientes/modelo";
import { fecha, fechaHora, telefono } from "@/components/dashboard/publibordados/clientes/formato";
import { Aviso, Dato, EstadoPill, Panel, Seccion, useConsulta } from "@/components/dashboard/publibordados/clientes/ui";

/**
 * Ficha del cliente: datos del cliente (informativos, vienen del Flow) + historial de solicitudes,
 * de la más reciente a la más antigua. Cada solicitud se abre y se edita por separado.
 */
export function FichaCliente({
  clienteId,
  token,
  recarga,
  onCerrar,
  onAbrirSolicitud,
}: {
  clienteId: number;
  token: string | null;
  recarga: number;
  onCerrar: () => void;
  onAbrirSolicitud: (s: Solicitud, asesores: Asesor[]) => void;
}) {
  const { t } = useI18n();
  const { data, error, cargando } = useConsulta<ClienteDetalle & { asesores: Asesor[] }>(`/api/dashboard/publibordados/clientes/${clienteId}`, token, recarga);
  const c = data?.cliente;

  return (
    <Panel titulo={c?.nombre ?? t("Cliente", "Customer")} subtitulo={t("Cliente", "Customer")} onCerrar={onCerrar}>
      {!data && cargando && <Aviso tipo="cargando">{t("Cargando…", "Loading…")}</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {c && data && (
        <>
          <Seccion titulo={t("Datos del cliente", "Customer details")}>
            <dl>
              <Dato label={t("Nombre", "Name")}>{c.nombre}</Dato>
              <Dato label={t("Teléfono", "Phone")}>
                <a className="text-lime-text hover:underline" href={`https://wa.me/${c.telefono}`} target="_blank" rel="noreferrer">
                  {telefono(c.telefono)}
                </a>
              </Dato>
              <Dato label={t("Tipo", "Type")}>{c.tipoCliente ? ETIQUETA_TIPO[c.tipoCliente] : "—"}</Dato>
              <Dato label={t("Empresa", "Company")}>{c.nombreEmpresa ?? "—"}</Dato>
              <Dato label={t("Primer registro", "First registered")}>{fecha(c.registradoAt)}</Dato>
              <Dato label={t("Último contacto", "Last contact")}>{fechaHora(c.ultimoContactoAt)}</Dato>
              <Dato label={t("Solicitudes", "Requests")}>{c.totalSolicitudes}</Dato>
            </dl>
          </Seccion>

          <Seccion titulo={t("Historial de solicitudes", "Request history")}>
            {data.solicitudes.length === 0 ? (
              <div className="py-2 text-sm text-mist">
                <p>{t("Este cliente todavía no tiene solicitudes registradas.", "This customer has no recorded requests yet.")}</p>
                {c.datosAnteriores && (
                  <p className="mt-1 text-xs">
                    {t("Dato anterior al historial:", "Data from before the history:")} {c.datosAnteriores.producto ?? "—"} · {c.datosAnteriores.cantidad ?? "—"}
                  </p>
                )}
              </div>
            ) : (
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-sm">
                  <thead className="text-xs text-mist">
                    <tr>
                      <th className="px-1 py-2 font-medium">#</th>
                      <th className="px-1 py-2 font-medium">{t("Fecha", "Date")}</th>
                      <th className="px-1 py-2 font-medium">{t("Producto", "Product")}</th>
                      <th className="px-1 py-2 text-right font-medium">{t("Cant.", "Qty")}</th>
                      <th className="px-1 py-2 font-medium">{t("Estado", "Status")}</th>
                      <th className="px-1 py-2 font-medium">{t("Asesor", "Advisor")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-edge">
                    {data.solicitudes.map((s) => (
                      <tr
                        key={s.id}
                        tabIndex={0}
                        onClick={() => onAbrirSolicitud(s, data.asesores)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onAbrirSolicitud(s, data.asesores))}
                        className="cursor-pointer hover:bg-ink focus:bg-ink focus:outline-none"
                      >
                        <td className="px-1 py-2 text-mist">{s.id}</td>
                        <td className="whitespace-nowrap px-1 py-2 text-mist">{fecha(s.createdAt)}</td>
                        <td className="px-1 py-2 text-fg">{s.productoEtiqueta}</td>
                        <td className="px-1 py-2 text-right tabular-nums text-fg">{s.cantidad}</td>
                        <td className="px-1 py-2">
                          <EstadoPill estado={s.estado} />
                        </td>
                        <td className="px-1 py-2 text-fg">{s.asesor?.nombre ?? <span className="text-mist">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Seccion>
        </>
      )}
    </Panel>
  );
}
