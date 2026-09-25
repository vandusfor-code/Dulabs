"use client";

// Bloque 27 — detalle de un pedido del módulo "Pedidos": cliente, productos (foto, referencia,
// cantidad, precio y subtotal), total, entrega, pago, estado, asesora e historial inmutable.
// Las acciones las valida el backend y la BD (sobre el estado que la persona VIO); aquí solo se
// piden, con confirmación y motivo cuando corresponde. Nunca se editan productos, precios ni stock.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Hand, MessageCircle, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import type { AccionPedido, HistorialEntrada, PedidoGestion } from "@/lib/catalogo/pedidos/gestion";
import { ProductImage, actionBtn, cn, formatPrice, primaryBtn, useCatalogAccess, useCatalogToast } from "@/components/dashboard/catalogo/ui";
import { CANAL_LABEL, inboxHref } from "@/components/dashboard/catalogo/PedidoDetalle";
import { ACCION, ENTREGA, ESTADO_VISIBLE, EstadoBadge, METODO, fecha, nombreCliente, telefonoCliente } from "@/components/dashboard/pedidos/ui";

const ESTADO_MOTOR: Record<string, { es: string; en: string }> = {
  draft: { es: "Borrador", en: "Draft" },
  validated: { es: "Validado", en: "Validated" },
  pending_confirmation: { es: "Esperando confirmación", en: "Awaiting confirmation" },
  confirmed: { es: "Confirmado", en: "Confirmed" },
  handoff: { es: "Con asesora", en: "With advisor" },
  completed: { es: "Completado", en: "Completed" },
  cancelled: { es: "Cancelado", en: "Cancelled" },
  expired: { es: "Vencido", en: "Expired" },
  rejected: { es: "Rechazado", en: "Rejected" },
};
const ACTOR: Record<string, { es: string; en: string }> = {
  system: { es: "Sistema", en: "System" },
  agent: { es: "Asistente (cliente)", en: "Assistant (customer)" },
  human: { es: "Equipo", en: "Team" },
};

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-edge bg-card p-4 sm:p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-mist">{titulo}</h2>
      <div className="mt-2 text-sm text-fg">{children}</div>
    </section>
  );
}

function etiquetaEstado(valor: string | null, t: (es: string, en: string) => string): string {
  if (!valor) return "—";
  const v = ESTADO_VISIBLE[valor as keyof typeof ESTADO_VISIBLE] ?? ESTADO_MOTOR[valor];
  return v ? t(v.es, v.en) : valor;
}

export default function PedidoGestionPage() {
  const { t } = useI18n();
  const toast = useCatalogToast();
  const { pedido: id } = useParams<{ pedido: string }>();
  const { client, canManageOrders } = useCatalogAccess();
  const [p, setP] = useState<PedidoGestion | null>(null);
  const [historial, setHistorial] = useState<HistorialEntrada[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const cargar = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!client) return;
    let vivo = true;
    void client.getManagedOrder(id).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setP(r.data.pedido);
        setHistorial(r.data.historial);
        setError(null);
      } else setError(r.error.message);
    });
    return () => {
      vivo = false;
    };
  }, [client, id, version]);

  async function actuar(accion: AccionPedido) {
    if (!client || !p || enCurso) return;
    let motivo: string | undefined;
    const texto = t(ACCION[accion].confirmar.es, ACCION[accion].confirmar.en);
    if (accion === "cancelar" || accion === "rechazar") {
      const m = window.prompt(`${p.pedido}\n\n${texto}`);
      if (m === null) return;
      if (m.trim().length < 3) return toast(t("Escribe el motivo (mínimo 3 caracteres).", "Write the reason (at least 3 characters)."), "error");
      motivo = m.trim().slice(0, 300);
    } else if (!window.confirm(`${p.pedido}\n\n${texto}`)) return;
    setEnCurso(accion);
    const r = await client.actOnOrder(p.pedido, { accion, esperado: p.version, ...(motivo ? { motivo } : {}) });
    setEnCurso(null);
    if (!r.ok) {
      toast(r.error.message, "error");
      cargar();
      return;
    }
    toast(r.data.repetido ? t("Ese cambio ya estaba registrado.", "That change was already recorded.") : t(`${p.pedido}: ${ESTADO_VISIBLE[r.data.pedido.estado_visible].es}.`, `${p.pedido}: ${ESTADO_VISIBLE[r.data.pedido.estado_visible].en}.`));
    cargar();
  }

  async function tomar() {
    const c = p?.contacto;
    if (!client || !c?.telefono) return;
    setEnCurso("tomar");
    const r = await client.takeConversation(c.numero, c.telefono);
    setEnCurso(null);
    if (!r.ok) return toast(r.error.message, "error");
    toast(t("Conversación tomada: el asistente deja de responder en ese chat.", "Conversation taken: the assistant stops replying in that chat."));
    cargar();
  }

  const c = p?.checkout ?? null;
  const inbox = p?.contacto ? inboxHref(p.contacto) : null;

  return (
    <div className="pb-16">
      <PageHeader eyebrow={t("Pedidos", "Orders")} title={p?.pedido ?? id} description={p ? t(`Pedido ${CANAL_LABEL[p.canal].es.toLowerCase()}`, `${CANAL_LABEL[p.canal].en} order`) : undefined}>
        <Link href="/dashboard/pedidos" className={actionBtn}>
          <ArrowLeft className="size-4" />
          {t("Pedidos", "Orders")}
        </Link>
        <button type="button" onClick={cargar} className={actionBtn}>
          <RefreshCw className="size-4" />
          {t("Actualizar", "Refresh")}
        </button>
      </PageHeader>

      <div className="grid gap-3 px-4 pt-6 md:px-8 lg:grid-cols-2">
        {error && <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400 lg:col-span-2">{error}</p>}
        {!p && !error && <div className="h-40 animate-pulse rounded-2xl bg-card lg:col-span-2" aria-hidden />}
        {p && (
          <>
            <Seccion titulo={t("Estado", "Status")}>
              <div className="flex flex-wrap items-center gap-2">
                <EstadoBadge estado={p.estado_visible} t={t} />
                <span className="text-xs text-mist">
                  {t("Confirmado", "Confirmed")} {fecha(p.confirmado_en)} · {t("actualizado", "updated")} {fecha(p.actualizado)}
                </span>
              </div>
              {canManageOrders && p.acciones.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {p.acciones.map((a) => (
                    <button
                      key={a}
                      type="button"
                      disabled={enCurso !== null}
                      onClick={() => void actuar(a)}
                      className={a === "cancelar" || a === "rechazar" ? actionBtn : primaryBtn}
                    >
                      {enCurso === a ? t("Guardando…", "Saving…") : t(ACCION[a].es, ACCION[a].en)}
                    </button>
                  ))}
                </div>
              )}
              {!canManageOrders && <p className="mt-2 text-xs text-mist">{t("Solo lectura.", "Read only.")}</p>}
            </Seccion>

            <Seccion titulo={t("Cliente", "Customer")}>
              <p className="font-medium">{nombreCliente(p, t)}</p>
              <p className="text-xs text-mist">
                {telefonoCliente(p) ?? "—"} · {t(CANAL_LABEL[p.canal].es, CANAL_LABEL[p.canal].en)}
              </p>
              {canManageOrders && p.contacto?.telefono && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {inbox && (
                    <Link href={inbox} className={actionBtn}>
                      <MessageCircle className="size-4" />
                      {t("Abrir en Inbox", "Open in Inbox")}
                    </Link>
                  )}
                  <button type="button" disabled={enCurso !== null} onClick={() => void tomar()} className={actionBtn}>
                    <Hand className="size-4" />
                    {t("Tomar conversación", "Take conversation")}
                  </button>
                </div>
              )}
            </Seccion>

            <Seccion titulo={t("Productos", "Products")}>
              <ul className="space-y-2">
                {p.lineas.map((l) => (
                  <li key={l.referencia} className="flex items-center gap-3">
                    <ProductImage src={l.foto ?? null} alt={l.nombre} className="size-12 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{l.nombre}</p>
                      <p className="font-mono text-xs text-mist">{l.referencia}</p>
                    </div>
                    <div className="text-right text-xs tabular-nums text-mist">
                      <p>
                        {l.cantidad} × {l.precio_unitario === null ? t("a consultar", "on request") : formatPrice(l.precio_unitario)}
                      </p>
                      <p className="text-sm font-medium text-fg">{l.subtotal === null ? "—" : formatPrice(l.subtotal)}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex justify-between border-t border-edge pt-3 font-semibold">
                <span>{t("Total", "Total")}</span>
                <span className="tabular-nums">{formatPrice(p.total)}</span>
              </div>
              {p.sin_precio > 0 && <p className="mt-1 text-xs text-mist">{t(`${p.sin_precio} unidad(es) con precio a consultar.`, `${p.sin_precio} unit(s) priced on request.`)}</p>}
            </Seccion>

            <Seccion titulo={t("Entrega y pago", "Delivery & payment")}>
              {c ? (
                <dl className="grid gap-1 text-sm">
                  <div>
                    <dt className="inline text-mist">{t("Entrega: ", "Delivery: ")}</dt>
                    <dd className="inline">{t(ENTREGA[c.entrega].es, ENTREGA[c.entrega].en)}</dd>
                  </div>
                  {c.entrega === "domicilio" && (
                    <>
                      <div>
                        <dt className="inline text-mist">{t("Dirección: ", "Address: ")}</dt>
                        <dd className="inline">
                          {c.direccion}, {c.ciudad}
                        </dd>
                      </div>
                      {c.referencia_entrega && (
                        <div>
                          <dt className="inline text-mist">{t("Referencia: ", "Landmark: ")}</dt>
                          <dd className="inline">{c.referencia_entrega}</dd>
                        </div>
                      )}
                    </>
                  )}
                  <div>
                    <dt className="inline text-mist">{t("Método de pago: ", "Payment method: ")}</dt>
                    <dd className="inline">{t(METODO[c.metodo_pago].es, METODO[c.metodo_pago].en)}</dd>
                  </div>
                  <div>
                    <dt className="inline text-mist">{t("Pago: ", "Payment: ")}</dt>
                    <dd className={cn("inline font-medium", c.estado_pago === "recibido" ? "text-lime-text" : "text-amber-500")}>
                      {c.estado_pago === "recibido" ? t("Recibido", "Received") : t("Pendiente", "Pending")}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-mist">{t("Pedido anterior al checkout: sin datos de entrega ni de pago.", "Pre-checkout order: no delivery or payment data.")}</p>
              )}
            </Seccion>

            <Seccion titulo={t("Asesora", "Advisor")}>
              <p>{p.asesora?.asignada ?? t("Sin asignar", "Unassigned")}</p>
              {p.asesora?.motivo && <p className="text-xs text-mist">{t("Motivo", "Reason")}: {p.asesora.motivo}</p>}
            </Seccion>

            <Seccion titulo={t("Historial", "History")}>
              {historial.length === 0 ? (
                <p className="text-mist">—</p>
              ) : (
                <ol className="space-y-2">
                  {historial.map((h, i) => (
                    <li key={i} className="text-xs">
                      <span className="text-mist">{fecha(h.fecha)}</span> ·{" "}
                      <span className="text-fg">
                        {h.desde ? `${etiquetaEstado(h.desde, t)} → ` : ""}
                        {etiquetaEstado(h.hacia, t)}
                      </span>{" "}
                      · <span className="text-mist">{h.miembro ?? (h.actor ? t(ACTOR[h.actor].es, ACTOR[h.actor].en) : "—")}</span>
                      {h.motivo && <span className="text-mist"> · {h.motivo}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </Seccion>
          </>
        )}
      </div>
    </div>
  );
}
