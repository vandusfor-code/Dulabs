"use client";

// Fase 3B.7 — panel operativo "Por aceptar": la lista de los pedidos que el cliente dejó listos (datos + aviso
// obligatorio) y el detalle donde UNA PERSONA autorizada los acepta, rechaza o cancela. Un pedido de aquí NO es una
// venta mientras no se acepta, y la pantalla nunca lo sugiere. El backend decide quién puede y vuelve a validar cada
// acción (sesión, negocio, estado y compare-and-set); esta vista solo muestra y pide. El documento solo aparece
// enmascarado. Los componentes reciben `client`, `t` y `toast` por props para poder probarse sin sesión real.
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, Clock, MessageCircle, RefreshCw, X } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import type { CatalogClient } from "@/lib/catalogo-client";
import type { AccionDecision, CampoFaltante, ConversacionPorAceptar, HistorialPorAceptar, MensajeAlCliente, PedidoPorAceptar, ProcesadoPorAceptar } from "@/lib/catalogo/pedidos/por-aceptar";
import { actionBtn, cn, formatPrice } from "@/components/dashboard/catalogo/ui";
import { ENTREGA, METODO, fecha, hace } from "@/components/dashboard/pedidos/ui";

export type T = (es: string, en: string) => string;
export type Notificar = (mensaje: string, tipo?: "success" | "error") => void;
export type ClientePorAceptar = Pick<CatalogClient, "listPorAceptar" | "getPorAceptar" | "decidirPorAceptar">;

export const RUTA_POR_ACEPTAR = "/dashboard/pedidos/por-aceptar";
/** Forma del número público (el backend lo valida de nuevo): evita pedir al servidor lo que no puede existir. */
const FORMATO_PEDIDO = /^DL-ORD-[A-Za-z0-9]{6}$/;
export const hrefDetalle = (pedido: string) => `${RUTA_POR_ACEPTAR}/${encodeURIComponent(pedido)}`;

/** Abre la conversación en el Inbox que ya existe (no hay otra bandeja). Sin teléfono (rol sin permiso) no hay enlace. */
export function hrefConversacion(c: ConversacionPorAceptar | null): string | null {
  return c?.telefono ? `/dashboard/mensajes?${new URLSearchParams({ phone_number_id: c.numero, telefono_cliente: c.telefono })}` : null;
}

const FALTANTE: Record<CampoFaltante, { es: string; en: string }> = {
  nombre: { es: "nombre", en: "name" },
  telefono: { es: "teléfono", en: "phone" },
  ciudad: { es: "ciudad", en: "city" },
  departamento: { es: "departamento", en: "state" },
  direccion: { es: "dirección", en: "address" },
  barrio: { es: "barrio", en: "neighbourhood" },
  oficina: { es: "oficina de la transportadora", en: "carrier office" },
};

/** Lo que pasó con un pedido que ya salió de "Por aceptar" (el texto nunca llama "venta" a lo que no lo es). */
const PROCESADO: Record<string, { es: string; en: string; tone: string }> = {
  confirmed: { es: "Aceptado: ya es una venta confirmada", en: "Accepted: it is now a confirmed sale", tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" },
  completed: { es: "Aceptado y completado", en: "Accepted and completed", tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" },
  handoff: { es: "Aceptado: lo atiende una asesora", en: "Accepted: handled by an advisor", tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" },
  rejected: { es: "Rechazado: no es una venta", en: "Rejected: not a sale", tone: "border-red-500/40 bg-red-500/10 text-red-400" },
  cancelled: { es: "Cancelado: no es una venta", en: "Cancelled: not a sale", tone: "border-edge bg-card text-mist" },
  expired: { es: "Vencido: nadie lo aceptó a tiempo, no es una venta", en: "Expired: nobody accepted it in time, not a sale", tone: "border-edge bg-card text-mist" },
};

function Dato({ etiqueta, valor, t }: { etiqueta: string; valor: ReactNode; t?: T }) {
  const vacio = valor === null || valor === undefined || valor === "";
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-mist">{etiqueta}</dt>
      <dd className={cn("break-words text-sm", vacio ? "text-mist" : "text-fg")}>{vacio ? (t ? t("No registrado", "Not recorded") : "—") : valor}</dd>
    </div>
  );
}

/**
 * Fase 3B.8 — qué le dice la pantalla a la persona sobre el mensaje al cliente tras su decisión. Sin mensaje configurado (o con las
 * notificaciones apagadas) no dice nada: no hay nada que informar. Nunca afirma que llegó si no se sabe.
 */
export function textoMensajeCliente(m: MensajeAlCliente | null | undefined, t: T): { texto: string; tipo: "success" | "error" } | null {
  if (!m || m.repetida) return null;
  if (m.estado === "enviada") return { texto: t("✓ Se le envió al cliente el mensaje del negocio.", "✓ The business message was sent to the customer."), tipo: "success" };
  if (m.estado === "no_aplica") {
    if (m.motivo === "sin_texto" || m.motivo === "sin_configuracion") return null;
    if (m.motivo === "sin_motivo") return { texto: t("ℹ No se envió mensaje al cliente: faltaba el motivo.", "ℹ No message was sent to the customer: the reason was missing."), tipo: "error" };
    if (m.motivo === "motivo_sensible") return { texto: t("ℹ No se envió mensaje al cliente: el motivo parece incluir un número largo (¿documento o teléfono?). Escríbele desde el Inbox.", "ℹ No message was sent to the customer: the reason seems to include a long number (ID or phone?). Write to them from the Inbox."), tipo: "error" };
    return { texto: t("ℹ No se envió mensaje al cliente. Revisa la conversación en el Inbox.", "ℹ No message was sent to the customer. Check the conversation in the Inbox."), tipo: "error" };
  }
  if (m.estado === "desactivada") return null;
  if (m.estado === "ventana_vencida") return { texto: t("ℹ No se envió el mensaje: la ventana de 24 h de WhatsApp está cerrada. Escríbele desde el Inbox.", "ℹ The message was not sent: the 24 h WhatsApp window is closed. Write to them from the Inbox."), tipo: "error" };
  return { texto: t("⚠ No se pudo confirmar el envío del mensaje al cliente. Revisa la conversación en el Inbox.", "⚠ Could not confirm the message to the customer was sent. Check the conversation in the Inbox."), tipo: "error" };
}

function textoConversacion(c: ConversacionPorAceptar, t: T): string {
  const partes = [
    c.asignada ? t(`Asignada a ${c.asignada}`, `Assigned to ${c.asignada}`) : t("Sin asignar", "Unassigned"),
    c.ia_pausada ? (c.ia_pausada_hasta ? t(`IA pausada hasta ${fecha(c.ia_pausada_hasta)}`, `AI paused until ${fecha(c.ia_pausada_hasta)}`) : t("IA pausada", "AI paused")) : t("IA activa", "AI active"),
    c.estado === "open" ? t("Abierta en el Inbox", "Open in Inbox") : c.estado === "pending" ? t("Pendiente en el Inbox", "Pending in Inbox") : c.estado === "closed" ? t("Cerrada en el Inbox", "Closed in Inbox") : null,
  ];
  return partes.filter(Boolean).join(" · ");
}

const resumenLineas = (p: PedidoPorAceptar, t: T) => {
  const [primera, ...resto] = p.lineas;
  if (!primera) return t("Sin productos", "No products");
  return `${primera.cantidad} × ${primera.nombre}${resto.length ? t(` y ${resto.length} más`, ` and ${resto.length} more`) : ""}`;
};

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

export function ListaPorAceptar({ client, t }: { client: ClientePorAceptar | null; t: T }) {
  const [pedidos, setPedidos] = useState<PedidoPorAceptar[] | null>(null);
  const [siguiente, setSiguiente] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorMas, setErrorMas] = useState<string | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [version, setVersion] = useState(0);
  const generacion = useRef(0);

  useEffect(() => {
    if (!client) return;
    let vivo = true;
    generacion.current += 1;
    void client.listPorAceptar().then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setPedidos(r.data.pedidos);
        setSiguiente(r.data.siguiente);
        setError(null);
        setErrorMas(null);
      } else {
        setError(r.error.message);
        setPedidos((previos) => previos ?? []);
      }
    });
    return () => {
      vivo = false;
    };
  }, [client, version]);

  async function cargarMas() {
    if (!client || !siguiente || cargandoMas) return;
    const mia = generacion.current;
    setCargandoMas(true);
    const r = await client.listPorAceptar({ cursor: siguiente });
    if (mia !== generacion.current) return;
    setCargandoMas(false);
    if (!r.ok) {
      setErrorMas(r.error.message);
      return;
    }
    setErrorMas(null);
    // Un pedido nunca aparece dos veces aunque la lista cambie entre páginas.
    setPedidos((previos) => {
      const ya = new Set((previos ?? []).map((p) => p.pedido));
      return [...(previos ?? []), ...r.data.pedidos.filter((p) => !ya.has(p.pedido))];
    });
    setSiguiente(r.data.siguiente);
  }

  const cargando = pedidos === null && !error;

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow={t("Operación", "Operations")}
        title={t("Por aceptar", "To accept")}
        description={t(
          "Pedidos que tus clientes dejaron listos y recibieron el aviso obligatorio. Todavía NO son ventas: solo cuando una persona autorizada los acepta pasan a Pedidos.",
          "Orders your customers completed after the mandatory notice. They are NOT sales yet: they move to Orders only when an authorised person accepts them.",
        )}
      >
        <button type="button" onClick={() => setVersion((v) => v + 1)} className={actionBtn}>
          <RefreshCw className="size-4" aria-hidden />
          {t("Actualizar", "Refresh")}
        </button>
      </PageHeader>

      <div className="space-y-3 px-4 pt-6 md:px-8">
        {error && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <span>{error}</span>
            <button type="button" onClick={() => setVersion((v) => v + 1)} className={actionBtn}>
              {t("Reintentar", "Retry")}
            </button>
          </div>
        )}
        {cargando && <div role="status" aria-label={t("Cargando pedidos por aceptar", "Loading orders to accept")} className="h-32 animate-pulse rounded-2xl bg-card" />}
        {pedidos && pedidos.length === 0 && !error && (
          <div className="rounded-2xl border border-edge bg-card p-8 text-center text-sm text-mist">{t("No hay pedidos por aceptar.", "No orders waiting for acceptance.")}</div>
        )}
        {pedidos && pedidos.length > 0 && <p className="text-xs text-mist">{t("Los más recientes primero.", "Most recent first.")}</p>}
        {pedidos?.map((p) => (
          <FilaPorAceptar key={p.pedido} p={p} t={t} />
        ))}
        {siguiente && (
          <div className="flex flex-col items-center gap-2 pt-2">
            {errorMas && (
              <p role="alert" className="text-sm text-red-400">
                {errorMas}
              </p>
            )}
            <button type="button" onClick={() => void cargarMas()} disabled={cargandoMas} className={actionBtn}>
              {cargandoMas ? t("Cargando…", "Loading…") : t("Cargar más", "Load more")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FilaPorAceptar({ p, t }: { p: PedidoPorAceptar; t: T }) {
  const ubicacion = [p.cliente.ciudad, p.cliente.departamento].filter(Boolean).join(", ");
  const responsable = p.asignada ?? p.responsable?.principal ?? null;
  return (
    <article className="rounded-2xl border border-edge bg-card px-4 py-4 sm:px-5" aria-label={t(`Pedido ${p.pedido} por aceptar`, `Order ${p.pedido} to accept`)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={hrefDetalle(p.pedido)} className="font-mono text-sm font-semibold text-fg hover:underline">
            {p.pedido}
          </Link>
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-500">{t("Pendiente de aceptación", "Pending acceptance")}</span>
          {p.respuesta_cliente && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-500">{t("El cliente respondió que sí", "Customer replied yes")}</span>}
          {p.faltantes.length > 0 && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-400">{t("Faltan datos", "Missing data")}</span>}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-mist" title={fecha(p.creado)}>
          <Clock className="size-3" aria-hidden />
          {t("Creado", "Created")} {hace(p.creado, t)}
        </div>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Dato etiqueta={t("Cliente", "Customer")} valor={p.cliente.nombre} t={t} />
        <Dato etiqueta={t("Producto", "Product")} valor={resumenLineas(p, t)} t={t} />
        <Dato etiqueta={t("Valor", "Value")} valor={`${formatPrice(p.total)} · ${t(METODO[p.pago].es, METODO[p.pago].en)}`} t={t} />
        <Dato etiqueta={t("Ciudad", "City")} valor={ubicacion} t={t} />
        <Dato etiqueta={t("Aviso enviado", "Notice sent")} valor={p.aviso_enviado ? fecha(p.aviso_enviado) : t("Sin registrar", "Not recorded")} />
        <Dato etiqueta={t("Responsable", "In charge")} valor={responsable} t={t} />
      </dl>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-3">
        <span className="text-xs text-mist">{p.puede_decidir ? t("Tú puedes aceptarlo o rechazarlo.", "You can accept or reject it.") : t("Solo la persona responsable puede decidir.", "Only the person in charge can decide.")}</span>
        <Link href={hrefDetalle(p.pedido)} className={actionBtn}>
          {t("Revisar pedido", "Review order")}
        </Link>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------

type Carga =
  | { tipo: "cargando" }
  | { tipo: "error"; status: number; mensaje: string }
  | { tipo: "pendiente"; pedido: PedidoPorAceptar; historial: HistorialPorAceptar[] }
  | { tipo: "procesado"; procesado: ProcesadoPorAceptar; historial: HistorialPorAceptar[] };

type Panel = { accion: "aceptar" } | { accion: Exclude<AccionDecision, "aceptar">; texto: string } | null;

export function DetallePorAceptar({ client, pedido, t, toast }: { client: ClientePorAceptar | null; pedido: string; t: T; toast: Notificar }) {
  const [carga, setCarga] = useState<Carga>({ tipo: "cargando" });
  const [version, setVersion] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [ocupado, setOcupado] = useState(false);
  const enCurso = useRef(false);
  const invalido = !FORMATO_PEDIDO.test(pedido);

  useEffect(() => {
    if (!client || invalido) return;
    let vivo = true;
    void client.getPorAceptar(pedido).then((r) => {
      if (!vivo) return;
      if (!r.ok) setCarga({ tipo: "error", status: r.error.status, mensaje: r.error.message });
      else if (r.data.pedido) setCarga({ tipo: "pendiente", pedido: r.data.pedido, historial: r.data.historial });
      else if (r.data.procesado) setCarga({ tipo: "procesado", procesado: r.data.procesado, historial: r.data.historial });
      else setCarga({ tipo: "error", status: 404, mensaje: "" });
    });
    return () => {
      vivo = false;
    };
  }, [client, pedido, invalido, version]);

  async function decidir(accion: AccionDecision, texto?: string) {
    if (!client || enCurso.current) return;
    enCurso.current = true;
    setOcupado(true);
    const r = await client.decidirPorAceptar(pedido, accion, texto);
    enCurso.current = false;
    setOcupado(false);
    if (!r.ok) {
      toast(r.error.message, "error");
      setPanel(null);
      // Alguien más decidió (409/404): se vuelve a leer para mostrar el estado actual, no uno viejo.
      if (r.error.status === 409 || r.error.status === 404) setVersion((v) => v + 1);
      return;
    }
    setPanel(null);
    const extra = r.data.repetido ? null : textoMensajeCliente(r.data.mensaje_cliente, t);
    if (r.data.repetido) {
      toast(t(`ℹ El pedido ${pedido} ya estaba procesado: no se repitió nada.`, `ℹ Order ${pedido} was already processed: nothing was repeated.`));
    } else {
      toast(
        accion === "aceptar"
          ? t(`✓ Pedido ${pedido} aceptado: ahora es una venta confirmada.`, `✓ Order ${pedido} accepted: it is now a confirmed sale.`)
          : accion === "rechazar"
            ? t(`Pedido ${pedido} rechazado.`, `Order ${pedido} rejected.`)
            : t(`Pedido ${pedido} cancelado.`, `Order ${pedido} cancelled.`),
      );
    }
    if (extra) toast(extra.texto, extra.tipo);
    setVersion((v) => v + 1);
  }

  return (
    <div className="pb-16">
      <PageHeader eyebrow={t("Por aceptar", "To accept")} title={invalido ? t("Pedido no válido", "Invalid order") : pedido} description={t("Revisa todos los datos antes de decidir.", "Review all the data before deciding.")}>
        <button type="button" onClick={() => setVersion((v) => v + 1)} className={actionBtn}>
          <RefreshCw className="size-4" aria-hidden />
          {t("Actualizar", "Refresh")}
        </button>
      </PageHeader>

      <div className="space-y-4 px-4 pt-6 md:px-8">
        <Link href={RUTA_POR_ACEPTAR} className="inline-flex items-center gap-1.5 text-sm text-mist hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden />
          {t("Volver a Por aceptar", "Back to To accept")}
        </Link>

        {invalido && (
          <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {t("Ese número de pedido no es válido.", "That order number is not valid.")}
          </div>
        )}

        {!invalido && carga.tipo === "cargando" && <div role="status" aria-label={t("Cargando pedido", "Loading order")} className="h-48 animate-pulse rounded-2xl bg-card" />}

        {!invalido && carga.tipo === "error" && (
          <div role="alert" className="space-y-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <p>{carga.status === 404 ? t("No encontramos ese pedido entre los pendientes de tu negocio.", "We could not find that order among your business's pending ones.") : carga.mensaje}</p>
            {carga.status !== 404 && (
              <button type="button" onClick={() => setVersion((v) => v + 1)} className={actionBtn}>
                {t("Reintentar", "Retry")}
              </button>
            )}
          </div>
        )}

        {!invalido && carga.tipo === "procesado" && <Procesado procesado={carga.procesado} historial={carga.historial} t={t} />}

        {!invalido && carga.tipo === "pendiente" && <Pendiente p={carga.pedido} historial={carga.historial} t={t} panel={panel} setPanel={setPanel} ocupado={ocupado} decidir={decidir} />}
      </div>
    </div>
  );
}

function Procesado({ procesado, historial, t }: { procesado: ProcesadoPorAceptar; historial: HistorialPorAceptar[]; t: T }) {
  const e = PROCESADO[procesado.estado] ?? { es: "Este pedido ya salió de Por aceptar", en: "This order already left To accept", tone: "border-edge bg-card text-mist" };
  const esVenta = ["confirmed", "completed", "handoff"].includes(procesado.estado);
  return (
    <>
      <section role="status" aria-label={t("Pedido ya procesado", "Order already processed")} className={cn("space-y-1.5 rounded-xl border px-4 py-3 text-sm", e.tone)}>
        <p className="font-semibold">{t("Este pedido ya fue procesado", "This order has already been processed")}</p>
        <p>{t(e.es, e.en)}</p>
        <p className="text-xs opacity-90">
          {procesado.por ? t(`Por ${procesado.por}`, `By ${procesado.por}`) : t("Por el sistema", "By the system")}
          {procesado.fecha ? ` · ${fecha(procesado.fecha)}` : ""}
          {procesado.motivo ? ` · ${t("Motivo", "Reason")}: ${procesado.motivo}` : ""}
        </p>
        {esVenta && (
          <Link href="/dashboard/pedidos" className="inline-block text-xs underline">
            {t("Gestiónalo en Pedidos", "Manage it in Orders")}
          </Link>
        )}
      </section>
      <Historial historial={historial} t={t} />
    </>
  );
}

type Decidir = (accion: AccionDecision, texto?: string) => Promise<void>;

function Pendiente({ p, historial, t, panel, setPanel, ocupado, decidir }: { p: PedidoPorAceptar; historial: HistorialPorAceptar[]; t: T; panel: Panel; setPanel: (p: Panel) => void; ocupado: boolean; decidir: Decidir }) {
  const chat = hrefConversacion(p.conversacion);
  const c = p.cliente;
  return (
    <>
      <section className="space-y-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-500">
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="size-4" aria-hidden />
          {t("Pendiente de aceptación humana", "Pending human acceptance")}
        </p>
        <p>
          {t("Este pedido NO está confirmado: no es una venta hasta que una persona autorizada lo acepte.", "This order is NOT confirmed: it is not a sale until an authorised person accepts it.")}{" "}
          {p.reserva_minutos !== null ? t(`Mientras espera, el stock queda apartado ${p.reserva_minutos} min.`, `While it waits, stock is held for ${p.reserva_minutos} min.`) : t("Mientras espera, no hay stock apartado.", "While it waits, no stock is held.")}
          {p.vence ? ` ${t(`Vence ${fecha(p.vence)}.`, `Expires ${fecha(p.vence)}.`)}` : ""}
        </p>
      </section>

      {p.faltantes.length > 0 && (
        <section role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {t("Faltan datos del cliente: ", "Missing customer data: ")}
          {p.faltantes.map((f) => t(FALTANTE[f].es, FALTANTE[f].en)).join(", ")}. {t("Confírmalos con el cliente antes de aceptar.", "Confirm them with the customer before accepting.")}
        </section>
      )}

      <section className="rounded-2xl border border-edge bg-card px-4 py-4 sm:px-5">
        <h2 className="text-sm font-semibold text-fg">{t("Producto y valor", "Product and value")}</h2>
        <ul className="mt-3 divide-y divide-edge rounded-xl border border-edge">
          {p.lineas.map((l) => (
            <li key={l.referencia} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                <span className="text-fg">{l.nombre}</span> <span className="font-mono text-xs text-mist">{l.referencia}</span>
              </span>
              <span className="shrink-0 tabular-nums text-fg">
                {l.cantidad} × {l.precio_unitario === null ? "—" : formatPrice(l.precio_unitario)}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between px-3 py-2 text-sm font-semibold">
            <span>{t("Total", "Total")}</span>
            <span className="tabular-nums">{formatPrice(p.total)}</span>
          </li>
        </ul>
        <dl className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <Dato etiqueta={t("Unidades", "Units")} valor={String(p.unidades)} />
          <Dato etiqueta={t("Pago", "Payment")} valor={p.pago === "contra_entrega" ? t("Contra entrega: se paga al recibir; no hay pago registrado", "Cash on delivery: paid on receipt; no payment recorded") : t(METODO[p.pago].es, METODO[p.pago].en)} />
          <Dato etiqueta={t("Envío", "Shipping")} valor={p.envio} t={t} />
        </dl>
      </section>

      <section className="rounded-2xl border border-edge bg-card px-4 py-4 sm:px-5">
        <h2 className="text-sm font-semibold text-fg">{t("Cliente y envío", "Customer and shipping")}</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <Dato etiqueta={t("Nombre", "Name")} valor={c.nombre} t={t} />
          <Dato etiqueta={t("Teléfono", "Phone")} valor={c.telefono ?? (c.telefono_parcial ? `••• ${c.telefono_parcial}` : null)} t={t} />
          <Dato etiqueta={t("Modalidad de entrega", "Delivery")} valor={t(ENTREGA[p.entrega].es, ENTREGA[p.entrega].en)} />
          <Dato etiqueta={t("Ciudad", "City")} valor={c.ciudad} t={t} />
          <Dato etiqueta={t("Departamento", "State")} valor={c.departamento} t={t} />
          <Dato etiqueta={t("Dirección", "Address")} valor={c.direccion} t={t} />
          <Dato etiqueta={t("Barrio", "Neighbourhood")} valor={c.barrio} t={t} />
          <Dato etiqueta={t("Referencia de entrega", "Delivery reference")} valor={c.referencia_entrega} t={t} />
          {p.entrega === "oficina_transportadora" && <Dato etiqueta={t("Oficina de la transportadora", "Carrier office")} valor={c.oficina} t={t} />}
          {p.documento && <Dato etiqueta={t("Documento", "ID document")} valor={`${p.documento.tipo} ${p.documento.enmascarado}`} />}
        </dl>
      </section>

      <section className="rounded-2xl border border-edge bg-card px-4 py-4 sm:px-5">
        <h2 className="text-sm font-semibold text-fg">{t("Seguimiento", "Follow-up")}</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <Dato etiqueta={t("Creado", "Created")} valor={fecha(p.creado)} />
          <Dato etiqueta={t("Aviso enviado", "Notice sent")} valor={p.aviso_enviado ? fecha(p.aviso_enviado) : t("No registrado", "Not recorded")} />
          <Dato etiqueta={t("El cliente respondió que sí", "Customer replied yes")} valor={p.respuesta_cliente ? fecha(p.respuesta_cliente) : t("Todavía no", "Not yet")} />
          <Dato etiqueta={t("Responsable de aceptar", "In charge of accepting")} valor={p.responsable?.principal} t={t} />
          <Dato etiqueta={t("Respaldo", "Backup")} valor={p.responsable?.respaldo} t={t} />
          <Dato
            etiqueta={t("Quién puede aceptar", "Who can accept")}
            valor={p.responsable ? (p.responsable.quien_acepta === "responsable_y_admins" ? t("La responsable, su respaldo y los administradores", "The person in charge, their backup and the admins") : t("Solo la responsable y su respaldo", "Only the person in charge and their backup")) : null}
            t={t}
          />
          <Dato etiqueta={t("Conversación", "Conversation")} valor={p.conversacion ? textoConversacion(p.conversacion, t) : null} t={t} />
        </dl>
        <p className="mt-3 text-xs text-mist">{t("El aviso y la respuesta del cliente no aceptan el pedido: solo lo hace una persona desde aquí.", "The notice and the customer's reply do not accept the order: only a person does, from here.")}</p>
        {chat && (
          <Link href={chat} className="mt-3 inline-flex items-center gap-1.5 text-xs text-emerald-500 hover:text-emerald-400">
            <MessageCircle className="size-3.5" aria-hidden />
            {t("Abrir la conversación en el Inbox", "Open the conversation in the Inbox")}
          </Link>
        )}
      </section>

      <Acciones p={p} t={t} panel={panel} setPanel={setPanel} ocupado={ocupado} decidir={decidir} />
      <Historial historial={historial} t={t} />
    </>
  );
}

function Acciones({ p, t, panel, setPanel, ocupado, decidir }: { p: PedidoPorAceptar; t: T; panel: Panel; setPanel: (p: Panel) => void; ocupado: boolean; decidir: Decidir }) {
  if (!p.puede_decidir) {
    return (
      <p className="rounded-2xl border border-edge bg-card px-4 py-3 text-sm text-mist">
        {p.responsable?.principal
          ? t(`Solo ${p.responsable.principal} (o quien el negocio haya autorizado) puede aceptar o rechazar este pedido.`, `Only ${p.responsable.principal} (or whoever the business authorised) can accept or reject this order.`)
          : t("Solo la persona responsable de estos pedidos (o quien el negocio haya autorizado) puede aceptarlos o rechazarlos.", "Only the person in charge of these orders (or whoever the business authorised) can accept or reject them.")}
      </p>
    );
  }
  return (
    <section className="space-y-3 rounded-2xl border border-edge bg-card px-4 py-4 sm:px-5" aria-label={t("Decisión", "Decision")}>
      <h2 className="text-sm font-semibold text-fg">{t("Decisión", "Decision")}</h2>
      {panel?.accion === "aceptar" ? (
        <div className="space-y-2" role="group" aria-label={t("Confirmar aceptación", "Confirm acceptance")}>
          <p className="text-sm text-fg">
            {t(`¿Aceptar el pedido ${p.pedido}? Pasa a ser una venta confirmada y se aparta el stock según la política del negocio.`, `Accept order ${p.pedido}? It becomes a confirmed sale and stock is reserved per the business policy.`)}
          </p>
          {p.avisa_al_cliente?.aceptar && <p className="text-xs text-mist">{t("Al aceptar, se le enviará al cliente el mensaje de aceptación que configuró el negocio (solo si las notificaciones del negocio están activas y la conversación sigue abierta).", "On accepting, the customer is sent the acceptance message the business configured (only if the business notifications are on and the conversation is still open).")}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={ocupado} onClick={() => void decidir("aceptar")} className="inline-flex items-center gap-1.5 rounded-xl bg-lime px-4 py-2 text-sm font-medium text-lime-fg disabled:opacity-50">
              <Check className="size-4" aria-hidden />
              {t("Sí, aceptar pedido", "Yes, accept order")}
            </button>
            <button type="button" disabled={ocupado} onClick={() => setPanel(null)} className={actionBtn}>
              {t("Volver", "Back")}
            </button>
          </div>
        </div>
      ) : panel ? (
        <div className="space-y-2" role="group" aria-label={panel.accion === "rechazar" ? t("Confirmar rechazo", "Confirm rejection") : t("Confirmar cancelación", "Confirm cancellation")}>
          <label className="block text-xs text-mist" htmlFor={`motivo-${p.pedido}`}>
            {panel.accion === "rechazar" ? t("Motivo del rechazo (obligatorio)", "Reason for rejecting (required)") : t("Motivo de la cancelación (obligatorio)", "Reason for cancelling (required)")}
          </label>
          <textarea
            id={`motivo-${p.pedido}`}
            value={panel.texto}
            maxLength={300}
            rows={2}
            onChange={(e) => setPanel({ accion: panel.accion, texto: e.target.value })}
            className="w-full rounded-xl border border-edge bg-card px-3 py-2 text-sm text-fg"
          />
          {p.avisa_al_cliente?.[panel.accion] && <p className="text-xs text-mist">{t("Se le enviará al cliente el mensaje que configuró el negocio (solo si las notificaciones del negocio están activas y la conversación sigue abierta).", "The customer is sent the message the business configured (only if the business notifications are on and the conversation is still open).")}</p>}
          {p.avisa_al_cliente?.motivo_al_cliente[panel.accion] && (
            <p role="note" className="text-xs font-medium text-amber-500">
              {t("⚠ El motivo que escribas lo leerá el cliente. Escríbelo pensando en que él lo va a ver (sin documentos, teléfonos ni datos internos).", "⚠ The customer will read the reason you write. Write it knowing they will see it (no IDs, phone numbers or internal data).")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={ocupado || panel.texto.trim().length < 3} onClick={() => void decidir(panel.accion, panel.texto.trim())} className={actionBtn}>
              {panel.accion === "rechazar" ? t("Confirmar rechazo", "Confirm rejection") : t("Confirmar cancelación", "Confirm cancellation")}
            </button>
            <button type="button" disabled={ocupado} onClick={() => setPanel(null)} className={actionBtn}>
              {t("Volver", "Back")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={ocupado} onClick={() => setPanel({ accion: "aceptar" })} className="inline-flex items-center gap-1.5 rounded-xl bg-lime px-4 py-2 text-sm font-medium text-lime-fg disabled:opacity-50">
            <Check className="size-4" aria-hidden />
            {t("Aceptar pedido", "Accept order")}
          </button>
          <button type="button" disabled={ocupado} onClick={() => setPanel({ accion: "rechazar", texto: "" })} className={actionBtn}>
            <X className="size-4" aria-hidden />
            {t("Rechazar", "Reject")}
          </button>
          <button type="button" disabled={ocupado} onClick={() => setPanel({ accion: "cancelar", texto: "" })} className={actionBtn}>
            {t("Cancelar pedido", "Cancel order")}
          </button>
        </div>
      )}
      <p className="text-xs text-mist">
        {p.avisa_al_cliente && (p.avisa_al_cliente.aceptar || p.avisa_al_cliente.rechazar || p.avisa_al_cliente.cancelar)
          ? t("Rechazar y cancelar no crean venta ni apartan stock.", "Rejecting and cancelling create no sale and hold no stock.")
          : t("Rechazar y cancelar no crean venta ni apartan stock. No se le escribe nada al cliente desde aquí.", "Rejecting and cancelling create no sale and hold no stock. Nothing is sent to the customer from here.")}
      </p>
    </section>
  );
}

const TIPO_HISTORIAL: Record<string, { es: string; en: string }> = {
  "order.status_changed": { es: "Cambio de estado", en: "Status change" },
};

function Historial({ historial, t }: { historial: HistorialPorAceptar[]; t: T }) {
  if (historial.length === 0) return null;
  return (
    <section className="rounded-2xl border border-edge bg-card px-4 py-4 sm:px-5" aria-label={t("Historial", "History")}>
      <h2 className="text-sm font-semibold text-fg">{t("Historial", "History")}</h2>
      <ol className="mt-3 space-y-2">
        {historial.map((h, i) => (
          <li key={`${h.fecha}-${i}`} className="text-xs text-mist">
            <span className="text-fg">{t(TIPO_HISTORIAL[h.tipo]?.es ?? h.tipo, TIPO_HISTORIAL[h.tipo]?.en ?? h.tipo)}</span>
            {h.desde || h.hacia ? ` · ${h.desde ?? "—"} → ${h.hacia ?? "—"}` : ""}
            {h.miembro ? ` · ${h.miembro}` : h.actor ? ` · ${h.actor}` : ""}
            {h.motivo ? ` · ${h.motivo}` : ""}
            {` · ${fecha(h.fecha)}`}
          </li>
        ))}
      </ol>
    </section>
  );
}
