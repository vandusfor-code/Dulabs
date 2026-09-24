"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Pill } from "@/components/dashboard/shell/ui";
import { inputCls, primaryBtn } from "@/components/dashboard/business-agent/ui";
import { useI18n } from "@/lib/i18n";
import { ESTADOS, ETIQUETA_ESTADO, ETIQUETA_TIPO, type Asesor, type Cliente, type EstadoCliente } from "@/lib/publibordados/clientes/modelo";
import { fecha, fechaHora, telefono } from "@/components/dashboard/publibordados/clientes/formato";

export const TONO_ESTADO: Record<EstadoCliente, "info" | "warning" | "success"> = {
  nuevo: "info",
  en_atencion: "warning",
  atendido: "success",
};

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-xs text-mist">{label}</dt>
      <dd className="text-right text-sm text-fg">{children}</dd>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-edge bg-card p-4">
      <h3 className="font-mono text-[11px] uppercase tracking-widest text-mist">{titulo}</h3>
      <dl className="mt-2 divide-y divide-edge">{children}</dl>
    </section>
  );
}

export function FichaCliente({
  cliente,
  asesores,
  puedeEditar,
  onCerrar,
  onGuardar,
}: {
  cliente: Cliente;
  asesores: Asesor[];
  puedeEditar: boolean;
  onCerrar: () => void;
  onGuardar: (cambio: { estado?: EstadoCliente; asesorId?: number | null }) => Promise<string | null>;
}) {
  const { t } = useI18n();
  const [estado, setEstado] = useState<EstadoCliente>(cliente.estado);
  const [asesorId, setAsesorId] = useState<string>(cliente.asesor ? String(cliente.asesor.id) : "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc cierra la ficha.
  useEffect(() => {
    const alPresionar = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, [onCerrar]);

  const asesorOriginal = cliente.asesor ? String(cliente.asesor.id) : "";
  const hayCambios = estado !== cliente.estado || asesorId !== asesorOriginal;
  // Un asesor ya asignado que dejó de estar activo se sigue mostrando como opción.
  const opciones = cliente.asesor && !asesores.some((a) => a.id === cliente.asesor!.id) ? [cliente.asesor, ...asesores] : asesores;

  async function guardar() {
    setGuardando(true);
    setError(null);
    const cambio: { estado?: EstadoCliente; asesorId?: number | null } = {};
    if (estado !== cliente.estado) cambio.estado = estado;
    if (asesorId !== asesorOriginal) cambio.asesorId = asesorId ? Number(asesorId) : null;
    const fallo = await onGuardar(cambio);
    setGuardando(false);
    if (fallo) setError(fallo);
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onCerrar} role="presentation">
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="ficha-cliente-titulo"
        className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-edge bg-ink p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-widest text-mist">{t("Cliente", "Customer")}</p>
            <h2 id="ficha-cliente-titulo" className="mt-1 truncate text-xl font-semibold text-fg">
              {cliente.nombre}
            </h2>
            <div className="mt-2">
              <Pill tone={TONO_ESTADO[cliente.estado]}>{ETIQUETA_ESTADO[cliente.estado]}</Pill>
            </div>
          </div>
          <button onClick={onCerrar} className="rounded-lg border border-edge p-2 text-fg hover:bg-card" aria-label={t("Cerrar", "Close")}>
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <Seccion titulo={t("Datos del cliente", "Customer details")}>
            <Dato label={t("Nombre", "Name")}>{cliente.nombre}</Dato>
            <Dato label={t("Teléfono", "Phone")}>
              <a className="text-lime-text hover:underline" href={`https://wa.me/${cliente.telefono}`} target="_blank" rel="noreferrer">
                {telefono(cliente.telefono)}
              </a>
            </Dato>
            <Dato label={t("Tipo", "Type")}>{cliente.tipo ? ETIQUETA_TIPO[cliente.tipo] : "—"}</Dato>
            <Dato label={t("Empresa", "Company")}>{cliente.nombreEmpresa ?? "—"}</Dato>
            <Dato label={t("Registrado", "Registered")}>{fecha(cliente.registradoEn)}</Dato>
          </Seccion>

          <Seccion titulo={t("Última solicitud", "Latest request")}>
            <Dato label={t("Producto", "Product")}>{cliente.productoEtiqueta ?? "—"}</Dato>
            <Dato label={t("Cantidad", "Quantity")}>{cliente.cantidad ?? "—"}</Dato>
            <Dato label={t("Fecha", "Date")}>{fechaHora(cliente.ultimaSolicitudEn)}</Dato>
          </Seccion>

          <Seccion titulo={t("Estado", "Status")}>
            <div className="space-y-3 py-2">
              <div>
                <label htmlFor="ficha-estado" className="mb-1.5 block text-xs font-medium text-mist">
                  {t("Estado actual", "Current status")}
                </label>
                <select
                  id="ficha-estado"
                  value={estado}
                  disabled={!puedeEditar || guardando}
                  onChange={(e) => setEstado(e.target.value as EstadoCliente)}
                  className={inputCls}
                >
                  {ESTADOS.map((e) => (
                    <option key={e} value={e}>
                      {ETIQUETA_ESTADO[e]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ficha-asesor" className="mb-1.5 block text-xs font-medium text-mist">
                  {t("Asesor asignado", "Assigned advisor")}
                </label>
                <select
                  id="ficha-asesor"
                  value={asesorId}
                  disabled={!puedeEditar || guardando}
                  onChange={(e) => setAsesorId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">{t("Sin asignar", "Unassigned")}</option>
                  {opciones.map((a) => (
                    <option key={a.id} value={String(a.id)}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Dato label={t("Último contacto", "Last contact")}>{fechaHora(cliente.ultimoContactoEn)}</Dato>
          </Seccion>

          {error && <p className="text-xs text-red-400">{error}</p>}
          {puedeEditar ? (
            <button onClick={guardar} disabled={!hayCambios || guardando} className={`${primaryBtn} w-full justify-center`}>
              {guardando ? t("Guardando…", "Saving…") : t("Guardar cambios", "Save changes")}
            </button>
          ) : (
            <p className="text-xs text-mist">{t("Tu rol solo permite ver los clientes.", "Your role can only view customers.")}</p>
          )}
        </div>
      </aside>
    </div>
  );
}
