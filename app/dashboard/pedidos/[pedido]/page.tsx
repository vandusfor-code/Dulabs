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
import type { AccionPedido, HistorialEntrada, NotificacionVista, PedidoGestion } from "@/lib/catalogo/pedidos/gestion";
import type { ResultadoNotificacion, TipoNotificacion } from "@/lib/catalogo/pedidos/notificaciones";
import { ProductImage, actionBtn, cn, formatPrice, primaryBtn, useCatalogAccess, useCatalogToast } from "@/components/dashboard/catalogo/ui";
import { CANAL_LABEL, inboxHref } from "@/components/dashboard/catalogo/PedidoDetalle";
import { ACCION, ENTREGA, ESTADO_VISIBLE, EstadoBadge, METODO, PAGO, PagoBadge, fecha, nombreCliente, telefonoCliente } from "@/components/dashboard/pedidos/ui";

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
// Bloque 31: notificaciones al cliente por WhatsApp.
const TIPO_NOTIF: Record<TipoNotificacion, { es: string; en: string }> = {
  pago_recibido: { es: "Pago recibido", en: "Payment received" },
  en_preparacion: { es: "En preparación", en: "Preparing" },
  enviado: { es: "Enviado", en: "Shipped" },
  entregado: { es: "Entregado", en: "Delivered" },
  completado: { es: "Completado", en: "Completed" },
  cancelado: { es: "Cancelado", en: "Cancelled" },
  rechazado: { es: "Rechazado", en: "Rejected" },
};
const ESTADO_NOTIF: Record<NotificacionVista["estado"], { es: string; en: string; tono: string }> = {
  pendiente: { es: "Pendiente", en: "Pending", tono: "text-mist" },
  enviando: { es: "Enviando…", en: "Sending…", tono: "text-mist" },
  enviada: { es: "Enviada", en: "Sent", tono: "text-lime" },
  fallida: { es: "Fallida", en: "Failed", tono: "text-red-400" },
  ventana_vencida: { es: "Ventana de 24 h vencida", en: "24 h window expired", tono: "text-amber-400" },
  desconocido: { es: "Resultado desconocido", en: "Unknown result", tono: "text-amber-400" },
  omitida: { es: "No enviada", en: "Not sent", tono: "text-mist" },
};
const MOTIVO_NOTIF: Record<string, { es: string; en: string }> = {
  sin_contacto: { es: "el pedido no tiene contacto de WhatsApp", en: "the order has no WhatsApp contact" },
  telefono_invalido: { es: "el teléfono del cliente no es válido", en: "invalid customer phone" },
  sin_canal: { es: "el número de WhatsApp no es de este negocio", en: "the WhatsApp number does not belong to this business" },
  sin_token: { es: "el número no tiene conexión con Meta", en: "the number has no Meta connection" },
  ventana_vencida: { es: "el cliente no escribió en las últimas 24 h", en: "the customer did not write in the last 24 h" },
  meta_ventana_cerrada: { es: "Meta indicó que la ventana de 24 h está cerrada", en: "Meta reported the 24 h window is closed" },
};

/** Mensaje del panel según lo que pasó con la notificación (nunca "todo bien" si WhatsApp falló). */
function avisoNotificacion(n: ResultadoNotificacion | null | undefined, t: (es: string, en: string) => string): { texto: string; tipo: "success" | "error" } | null {
  if (!n || n.estado === "desactivada") return null;
  if (n.estado === "no_disponible") return { texto: t("⚠ El pedido fue actualizado, pero las notificaciones no están disponibles en este momento.", "⚠ Order updated, but notifications are unavailable right now."), tipo: "error" };
  if (n.estado === "enviada") return { texto: n.repetida ? t("ℹ La notificación de este cambio ya se había enviado.", "ℹ This change was already notified.") : t("✓ Notificación enviada al cliente por WhatsApp.", "✓ Customer notified on WhatsApp."), tipo: "success" };
  if (n.estado === "ventana_vencida") return { texto: t("ℹ La ventana de conversación de WhatsApp estaba vencida. No se envió mensaje.", "ℹ The WhatsApp conversation window had expired. No message was sent."), tipo: "error" };
  if (n.estado === "omitida") return { texto: t(`ℹ No se envió notificación: ${MOTIVO_NOTIF[n.motivo ?? ""]?.es ?? n.motivo ?? ""}.`, `ℹ No notification sent: ${MOTIVO_NOTIF[n.motivo ?? ""]?.en ?? n.motivo ?? ""}.`), tipo: "error" };
  if (n.estado === "desconocido") return { texto: t("⚠ No se sabe si la notificación llegó (sin respuesta de WhatsApp). Revisa el chat.", "⚠ Unknown whether the notification arrived. Check the chat."), tipo: "error" };
  if (n.estado === "enviando") return { texto: t("ℹ La notificación se está enviando.", "ℹ The notification is being sent."), tipo: "success" };
  return { texto: t("⚠ El pedido fue actualizado, pero no fue posible enviar la notificación por WhatsApp.", "⚠ Order updated, but the WhatsApp notification could not be sent."), tipo: "error" };
}

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
  const v = ESTADO_VISIBLE[valor as keyof typeof ESTADO_VISIBLE] ?? PAGO[valor as keyof typeof PAGO] ?? ESTADO_MOTOR[valor];
  return v ? t(v.es, v.en) : valor;
}

export default function PedidoGestionPage() {
  const { t } = useI18n();
  const toast = useCatalogToast();
  const { pedido: id } = useParams<{ pedido: string }>();
  const { client, canManageOrders } = useCatalogAccess();
  const [p, setP] = useState<PedidoGestion | null>(null);
  const [historial, setHistorial] = useState<HistorialEntrada[]>([]);
  const [notificaciones, setNotificaciones] = useState<NotificacionVista[]>([]);
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
        setNotificaciones(r.data.notificaciones ?? []);
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
    toast(r.data.repetido ? t("Ese cambio ya estaba registrado.", "That change was already recorded.") : t(`✓ Pedido actualizado: ${ESTADO_VISIBLE[r.data.pedido.estado_visible].es}.`, `✓ Order updated: ${ESTADO_VISIBLE[r.data.pedido.estado_visible].en}.`));
    const aviso = avisoNotificacion(r.data.notificacion, t);
    if (aviso) toast(aviso.texto, aviso.tipo);
    cargar();
  }

  async function reintentar(tipo: TipoNotificacion) {
    if (!client || !p || enCurso) return;
    if (!window.confirm(t("¿Reintentar el aviso por WhatsApp al cliente?", "Retry the WhatsApp notification to the customer?"))) return;
    setEnCurso(`notif-${tipo}`);
    const r = await client.retryOrderNotification(p.pedido, tipo);
    setEnCurso(null);
    if (!r.ok) toast(r.error.message, "error");
    else {
      const aviso = avisoNotificacion(r.data.notificacion, t);
      if (aviso) toast(aviso.texto, aviso.tipo);
    }
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
            <Seccion titulo={t("Estado del pedido y del pago", "Order and payment status")}>
              <div className="flex flex-wrap items-center gap-2">
                <EstadoBadge estado={p.estado_visible} t={t} />
                <PagoBadge pago={p.estado_pago} t={t} />
              </div>
              <p className="mt-2 text-xs text-mist">
                {t("Creado", "Created")} {fecha(p.creado)} · {t("confirmado", "confirmed")} {fecha(p.confirmado_en)} · {t("actualizado", "updated")} {fecha(p.actualizado)}
              </p>
              <p className="mt-1 text-xs text-mist">
                {p.vence_reserva
                  ? t(`La reserva vence ${fecha(p.vence_reserva)} si nadie lo gestiona.`, `Reservation expires ${fecha(p.vence_reserva)} unless handled.`)
                  : t("La reserva no vence (el pedido ya está en gestión o cerrado).", "The reservation does not expire (order in progress or closed).")}
              </p>
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

            <Seccion titulo={t("Atención de la conversación", "Conversation handling")}>
              <p className="text-xs text-mist">{t("Es de la conversación, no del pedido: no cambia su estado.", "Belongs to the conversation, not the order: it does not change its status.")}</p>
              <dl className="mt-2 grid gap-1 text-sm">
                <div>
                  <dt className="inline text-mist">{t("Asesora: ", "Advisor: ")}</dt>
                  <dd className="inline">{p.atencion?.asignada ?? t("Sin asignar", "Unassigned")}</dd>
                </div>
                <div>
                  <dt className="inline text-mist">{t("Asistente: ", "Assistant: ")}</dt>
                  <dd className="inline">{p.atencion?.ia_pausada_hasta ? t(`pausado hasta ${fecha(p.atencion.ia_pausada_hasta)}`, `paused until ${fecha(p.atencion.ia_pausada_hasta)}`) : t("activo", "active")}</dd>
                </div>
                {p.atencion?.conversacion && (
                  <div>
                    <dt className="inline text-mist">{t("Inbox: ", "Inbox: ")}</dt>
                    <dd className="inline">{p.atencion.conversacion === "pending" ? t("pendiente", "pending") : p.atencion.conversacion === "closed" ? t("cerrada", "closed") : t("abierta", "open")}</dd>
                  </div>
                )}
                {p.motivo_traspaso && (
                  <div>
                    <dt className="inline text-mist">{t("Motivo del traspaso: ", "Handoff reason: ")}</dt>
                    <dd className="inline">{p.motivo_traspaso}</dd>
                  </div>
                )}
              </dl>
            </Seccion>

            {notificaciones.length > 0 && (
              <Seccion titulo={t("Notificaciones al cliente (WhatsApp)", "Customer notifications (WhatsApp)")}>
                <ol className="space-y-2">
                  {notificaciones.map((n) => (
                    <li key={n.tipo} className="text-xs">
                      <span className="text-mist">{fecha(n.enviada_at ?? n.actualizada)}</span> · <span className="text-fg">{t(TIPO_NOTIF[n.tipo].es, TIPO_NOTIF[n.tipo].en)}</span> ·{" "}
                      <span className={ESTADO_NOTIF[n.estado].tono}>{t(ESTADO_NOTIF[n.estado].es, ESTADO_NOTIF[n.estado].en)}</span>
                      {n.motivo && MOTIVO_NOTIF[n.motivo] && <span className="text-mist"> · {t(MOTIVO_NOTIF[n.motivo].es, MOTIVO_NOTIF[n.motivo].en)}</span>}
                      {n.error_codigo && <span className="text-mist"> · {t("error", "error")} {n.error_codigo}{n.error_mensaje ? `: ${n.error_mensaje}` : ""}</span>}
                      {n.intentos > 1 && <span className="text-mist"> · {t(`${n.intentos} intentos`, `${n.intentos} attempts`)}</span>}
                      {canManageOrders && ["fallida", "ventana_vencida", "omitida", "desconocido"].includes(n.estado) && (
                        <button type="button" onClick={() => reintentar(n.tipo)} disabled={enCurso !== null} className="ml-2 text-lime underline-offset-2 hover:underline disabled:opacity-50">
                          {t("Reintentar", "Retry")}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </Seccion>
            )}

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
