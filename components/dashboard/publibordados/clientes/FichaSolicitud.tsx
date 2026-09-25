"use client";

import { useState } from "react";
import { inputCls, primaryBtn } from "@/components/dashboard/business-agent/ui";
import { useI18n } from "@/lib/i18n";
import { ESTADOS, ETIQUETA_ESTADO, ETIQUETA_TIPO, type Asesor, type EstadoSolicitud, type Solicitud } from "@/lib/publibordados/clientes/modelo";
import { fechaHora, telefono } from "@/components/dashboard/publibordados/clientes/formato";
import { Dato, EstadoPill, Panel, Seccion } from "@/components/dashboard/publibordados/clientes/ui";

/**
 * Ficha de UNA solicitud. Lo único editable es estado y asesor (de esta solicitud); el resto es
 * lo que el cliente declaró en el Flow. Guarda con la versión leída: si otra persona la cambió
 * antes, la API responde 409 y se muestra la versión actual.
 */
export function FichaSolicitud({
  solicitud,
  asesores,
  puedeEditar,
  token,
  onCerrar,
  onGuardada,
  onVerCliente,
}: {
  solicitud: Solicitud;
  asesores: Asesor[];
  puedeEditar: boolean;
  token: string | null;
  onCerrar: () => void;
  onGuardada: (s: Solicitud) => void;
  onVerCliente?: (clienteId: number) => void;
}) {
  const { t } = useI18n();
  const [actual, setActual] = useState(solicitud);
  const [estado, setEstado] = useState<EstadoSolicitud>(solicitud.estado);
  const [asesorId, setAsesorId] = useState(solicitud.asesor ? String(solicitud.asesor.id) : "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const asesorOriginal = actual.asesor ? String(actual.asesor.id) : "";
  const hayCambios = estado !== actual.estado || asesorId !== asesorOriginal;
  // Un asesor ya asignado que dejó de estar activo se sigue mostrando como opción.
  const opciones = actual.asesor && !asesores.some((a) => a.id === actual.asesor!.id) ? [actual.asesor, ...asesores] : asesores;

  const aplicar = (s: Solicitud) => {
    setActual(s);
    setEstado(s.estado);
    setAsesorId(s.asesor ? String(s.asesor.id) : "");
  };

  async function recargar() {
    if (!token) return;
    const res = await fetch(`/api/dashboard/publibordados/solicitudes/${actual.id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) aplicar(((await res.json()) as { solicitud: Solicitud }).solicitud);
  }

  async function guardar() {
    if (!token) return;
    setGuardando(true);
    setError(null);
    const cambio: Record<string, unknown> = { version: actual.version };
    if (estado !== actual.estado) cambio.estado = estado;
    if (asesorId !== asesorOriginal) cambio.asesorId = asesorId ? Number(asesorId) : null;
    try {
      const res = await fetch(`/api/dashboard/publibordados/solicitudes/${actual.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(cambio),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("No se pudo guardar.", "Couldn't save."));
        if (res.status === 409) await recargar();
        return;
      }
      aplicar(data.solicitud as Solicitud);
      onGuardada(data.solicitud as Solicitud);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Panel titulo={`${t("Solicitud", "Request")} #${actual.id}`} subtitulo={actual.nombre} encabezado={<EstadoPill estado={actual.estado} />} onCerrar={onCerrar}>
      <Seccion titulo={t("Solicitud", "Request")}>
        <dl>
          <Dato label={t("Producto", "Product")}>{actual.productoEtiqueta}</Dato>
          <Dato label={t("Cantidad", "Quantity")}>{actual.cantidad}</Dato>
          <Dato label={t("Fecha", "Date")}>{fechaHora(actual.createdAt)}</Dato>
        </dl>
      </Seccion>

      <Seccion titulo={t("Cliente", "Customer")}>
        <dl>
          <Dato label={t("Nombre", "Name")}>{actual.nombre}</Dato>
          <Dato label={t("Tipo", "Type")}>{ETIQUETA_TIPO[actual.tipoCliente]}</Dato>
          {actual.nombreEmpresa && <Dato label={t("Empresa", "Company")}>{actual.nombreEmpresa}</Dato>}
          <Dato label={t("Teléfono", "Phone")}>
            <a className="text-lime-text hover:underline" href={`https://wa.me/${actual.telefono}`} target="_blank" rel="noreferrer">
              {telefono(actual.telefono)}
            </a>
          </Dato>
        </dl>
        {onVerCliente && (
          <button onClick={() => onVerCliente(actual.clienteId)} className="mt-2 text-xs font-medium text-lime-text hover:underline">
            {t("Ver cliente e historial", "View customer and history")}
          </button>
        )}
      </Seccion>

      <Seccion titulo={t("Atención", "Handling")}>
        <div className="space-y-3 py-2">
          <div>
            <label htmlFor="sol-estado" className="mb-1.5 block text-xs font-medium text-mist">
              {t("Estado", "Status")}
            </label>
            <select id="sol-estado" value={estado} disabled={!puedeEditar || guardando} onChange={(e) => setEstado(e.target.value as EstadoSolicitud)} className={inputCls}>
              {ESTADOS.map((e) => (
                <option key={e} value={e}>
                  {ETIQUETA_ESTADO[e]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sol-asesor" className="mb-1.5 block text-xs font-medium text-mist">
              {t("Asesor asignado", "Assigned advisor")}
            </label>
            <select id="sol-asesor" value={asesorId} disabled={!puedeEditar || guardando} onChange={(e) => setAsesorId(e.target.value)} className={inputCls}>
              <option value="">{t("Sin asignar", "Unassigned")}</option>
              {opciones.map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
        <dl>
          <Dato label={t("Asignada", "Assigned")}>{fechaHora(actual.asignadoAt)}</Dato>
          <Dato label={t("Atendida", "Handled")}>{fechaHora(actual.atendidoAt)}</Dato>
          <Dato label={t("Última actualización", "Last update")}>{fechaHora(actual.updatedAt)}</Dato>
        </dl>
      </Seccion>

      <Seccion titulo={t("Trazabilidad", "Traceability")}>
        <dl>
          <Dato label={t("Ejecución del flow", "Flow execution")}>
            <span className="font-mono text-xs">{actual.flowExecutionId}</span>
          </Dato>
          <Dato label={t("Mensaje de WhatsApp", "WhatsApp message")}>
            <span className="break-all font-mono text-xs">{actual.eventoId ?? "—"}</span>
          </Dato>
        </dl>
      </Seccion>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {puedeEditar ? (
        <button onClick={guardar} disabled={!hayCambios || guardando} className={`${primaryBtn} w-full justify-center`}>
          {guardando ? t("Guardando…", "Saving…") : t("Guardar cambios", "Save changes")}
        </button>
      ) : (
        <p className="text-xs text-mist">{t("Tu rol solo permite ver.", "Your role can only view.")}</p>
      )}
    </Panel>
  );
}
