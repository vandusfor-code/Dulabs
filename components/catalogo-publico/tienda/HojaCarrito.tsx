"use client";

/**
 * "Tu selección": revisar y pedir. Hoja inferior en móvil, panel lateral en
 * escritorio (diálogo nativo). El carrito del navegador nunca es la fuente de
 * verdad:
 *   - al abrirse, el backend confirma cada referencia (precio vigente,
 *     disponibilidad, máximo pedible) y entrega una COTIZACIÓN FIRMADA de los
 *     precios que el cliente está viendo;
 *   - "Enviar pedido por WhatsApp" pide al servidor preparar la SOLICITUD
 *     (POST …/pedido) con referencias, cantidades, esa cotización y la clave
 *     de idempotencia del intento. Solo si todo es posible y los precios no
 *     cambiaron se abre WhatsApp, con el mensaje armado allá. Si algo cambió,
 *     se muestra exactamente qué y el cliente confirma de nuevo.
 *   - El mismo carrito enviado dos veces (doble toque, volver de WhatsApp)
 *     produce la MISMA solicitud (mismo DL-ORD): la clave vive con el carrito.
 */
import { useEffect, useRef, useState } from "react";
import { ImageOff, Loader2, MessageCircle, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { formatCop } from "@/lib/business-agent-quote";
import {
  cartTotal,
  currentRequest,
  lineSubtotal,
  orderableLines,
  quantityLimit,
  reconcileWithChanges,
  requestFingerprint,
  selectionSnapshot,
  type CartChange,
  type CartProduct,
  type CartState,
} from "@/lib/catalogo/carrito";
import type { OrderAdjustment } from "@/lib/catalogo/pedido";
import { Dialogo } from "@/components/catalogo-publico/tienda/Dialogo";
import { useCarrito, useTienda } from "@/components/catalogo-publico/tienda/TiendaContext";

const stepBtn =
  "flex size-10 items-center justify-center rounded-full text-fg transition-[background-color,transform] duration-150 hover:bg-fg/5 active:scale-90 disabled:opacity-30";

interface Seleccion {
  items: CartProduct[];
  unknown: string[];
  quote?: string | null;
}

interface RespuestaPedido {
  status: "ready" | "adjusted" | "review" | "no_whatsapp";
  whatsappUrl: string | null;
  request: { requestId: string } | null;
  adjustments: OrderAdjustment[];
  quote: string | null;
  selection: Seleccion;
}

/** Verdad del servidor sobre las referencias del carrito (solo referencias viajan). */
async function resolverSeleccion(basePath: string, state: CartState, signal: AbortSignal): Promise<Seleccion | null> {
  const params = new URLSearchParams();
  for (const l of state.lines) params.append("ref", l.reference);
  try {
    const res = await fetch(`${basePath}/seleccion?${params}`, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as Seleccion;
  } catch {
    return null; // sin red: se conserva lo que el cliente ya tenía, nada se inventa
  }
}

const precio = (p: number | null) => (p === null ? "precio a consultar" : formatCop(p));

function textoCambio(c: CartChange): string {
  if (c.kind === "removed") return `«${c.name}» ya no está disponible y se retiró de tu selección.`;
  if (c.kind === "sold_out") return `«${c.name}» se agotó y no se incluirá en tu pedido.`;
  if (c.kind === "price_changed") return `El precio de «${c.name}» cambió: ahora ${precio(c.to)}.`;
  return c.to === 1 ? `Solo queda 1 unidad de «${c.name}»; ajustamos tu selección.` : `Solo quedan ${c.to} unidades de «${c.name}»; ajustamos tu selección.`;
}

/** Lo que dijo el servidor, en palabras del cliente (el nombre de lo retirado sale del carrito: el servidor ya no lo conoce). */
function textoAjuste(a: OrderAdjustment, nombres: ReadonlyMap<string, string>): string {
  switch (a.kind) {
    case "not_found":
      return `«${nombres.get(a.reference) ?? a.reference}» ya no está disponible y se retiró de tu selección.`;
    case "sold_out":
      return `«${a.name}» se agotó y no se incluirá en tu pedido.`;
    case "quantity_reduced":
      return a.granted === 1 ? `Solo queda 1 unidad de «${a.name}»; ajustamos tu selección.` : `Solo quedan ${a.granted} unidades de «${a.name}»; ajustamos tu selección.`;
    case "price_changed":
      return `El precio de «${a.name}» cambió: antes ${precio(a.before)}, ahora ${precio(a.after)}.`;
  }
}

/** Clave opaca de idempotencia del intento de envío. */
function nuevaClave(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function HojaCarrito() {
  const { carritoAbierto, cerrarCarrito, whatsapp, basePath, store } = useTienda();
  const { state, items, dispatch } = useCarrito();
  const [avisos, setAvisos] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Última cotización firmada que el backend entregó para lo que el cliente está viendo. */
  const cotizacion = useRef<string | null>(null);

  /** Aplica la verdad del servidor y devuelve los avisos de lo que cambió. */
  const aplicar = (s: Seleccion): string[] => {
    const { changes } = reconcileWithChanges(store.getSnapshot(), s.items, s.unknown);
    store.dispatch({ type: "reconcile", resolved: s.items, unknown: s.unknown });
    if (s.quote !== undefined) cotizacion.current = s.quote;
    return changes.map(textoCambio);
  };

  // Reconciliación: UNA consulta por apertura, con las referencias de ese momento.
  useEffect(() => {
    if (!carritoAbierto) return;
    const actual = store.getSnapshot();
    if (actual.lines.length === 0) return;
    const controller = new AbortController();
    void resolverSeleccion(basePath, actual, controller.signal).then((r) => {
      if (!r || controller.signal.aborted) return;
      const nuevos = aplicar(r);
      if (nuevos.length > 0) setAvisos(nuevos);
    });
    return () => controller.abort();
    // aplicar solo usa `store` (estable): la consulta es por apertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carritoAbierto, basePath, store]);

  const cerrar = () => {
    setAvisos([]);
    setError(null);
    cerrarCarrito();
  };

  /** Prepara la solicitud en el servidor; solo abre WhatsApp si todo lo pedido es posible y los precios no cambiaron. */
  const pedir = async () => {
    if (enviando) return; // doble toque: una sola petición en vuelo
    setEnviando(true);
    setError(null);
    setAvisos([]);
    const actual = store.getSnapshot();
    const nombres = new Map(actual.lines.map((l) => [l.reference, l.name]));
    let intento = currentRequest(actual);
    if (!intento) {
      intento = { key: nuevaClave(), items: requestFingerprint(actual.lines) };
      store.dispatch({ type: "setRequest", request: intento });
    }
    try {
      const res = await fetch(`${basePath}/pedido`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ items: selectionSnapshot(actual).items, quote: cotizacion.current ?? undefined, requestKey: intento.key }),
      });
      if (!res.ok) {
        setError("No pudimos preparar tu pedido. Intenta de nuevo en un momento.");
        return;
      }
      const data = (await res.json()) as RespuestaPedido;
      const cambios = aplicar({ ...data.selection, quote: data.quote });
      if (data.status === "ready" && data.whatsappUrl && data.request) {
        store.dispatch({ type: "setRequest", request: { ...intento, requestId: data.request.requestId, whatsappUrl: data.whatsappUrl } });
        window.location.assign(data.whatsappUrl);
        return;
      }
      if (data.status === "no_whatsapp") setError("Este catálogo todavía no tiene un WhatsApp de pedidos configurado.");
      else if (data.status === "adjusted") {
        const textos = data.adjustments.map((a) => textoAjuste(a, nombres));
        setAvisos(textos.length > 0 ? textos : cambios.length > 0 ? cambios : ["Actualizamos tu selección con el inventario actual. Revísala y confirma tu pedido."]);
      } else {
        setAvisos(cambios.length > 0 ? [...cambios, "Revisa tu selección y vuelve a tocar «Enviar pedido por WhatsApp»."] : ["Confirmamos los precios vigentes de tu selección. Revísala y vuelve a tocar «Enviar pedido por WhatsApp»."]);
      }
    } catch {
      setError("Sin conexión. Revisa tu internet e intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  };

  const { total, unpricedItems } = cartTotal(state);
  const hayPedibles = orderableLines(state).length > 0;
  const solicitud = currentRequest(state);
  const whatsappValido = (whatsapp ?? "").replace(/\D/g, "").length >= 8;

  return (
    <Dialogo
      open={carritoAbierto}
      onClose={cerrar}
      labelledBy="tienda-seleccion-titulo"
      className="tienda-hoja fixed inset-x-0 bottom-0 top-auto m-0 max-h-[88dvh] w-full max-w-none flex-col rounded-t-[28px] bg-ink p-0 text-fg shadow-2xl backdrop:bg-fg/40 backdrop:backdrop-blur-[2px] open:flex md:inset-y-0 md:left-auto md:right-0 md:h-dvh md:max-h-none md:w-[420px] md:rounded-none"
    >
      <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-fg/15 md:hidden" aria-hidden />
      <header className="flex shrink-0 items-center justify-between px-5 pb-2 pt-3 md:pt-5">
        <div>
          <h2 id="tienda-seleccion-titulo" className="font-serif-tienda text-[26px] font-medium leading-tight text-fg">
            Tu selección
          </h2>
          <p className="text-xs text-mist" aria-live="polite">
            {items === 0 ? "Aún no has elegido piezas" : items === 1 ? "1 producto" : `${items} productos`}
          </p>
        </div>
        <button type="button" onClick={cerrar} className={stepBtn} aria-label="Cerrar tu selección">
          <X className="size-5" strokeWidth={1.6} aria-hidden />
        </button>
      </header>

      {avisos.length > 0 && (
        <div role="status" className="mx-5 mb-1 space-y-1 rounded-2xl bg-[var(--tienda-oro-suave)] px-4 py-2.5 text-[13px] text-fg">
          {avisos.map((a) => (
            <p key={a}>{a}</p>
          ))}
        </div>
      )}

      {state.lines.length === 0 ? (
        <div className="flex flex-col items-center px-8 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-8 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-[var(--tienda-oro-suave)] text-[var(--tienda-oro)]">
            <ShoppingBag className="size-7" strokeWidth={1.5} aria-hidden />
          </div>
          <p className="mt-4 text-[15px] font-medium text-fg">Tu selección está vacía</p>
          <p className="mt-1 max-w-xs text-sm text-mist">Toca «+» en las piezas que te gusten y pídelas todas juntas por WhatsApp.</p>
          <button type="button" onClick={cerrar} className="mt-6 h-12 rounded-full border border-edge px-6 text-sm font-medium text-fg transition-colors hover:bg-fg/5">
            Seguir explorando
          </button>
        </div>
      ) : (
        <>
          <ul className="min-h-0 flex-1 divide-y divide-edge overflow-y-auto overscroll-contain px-5">
            {state.lines.map((l) => {
              const subtotal = lineSubtotal(l);
              const limite = quantityLimit(l);
              const enTope = l.quantity >= limite;
              return (
                <li key={l.reference} className="flex gap-3.5 py-4">
                  <div className="size-[76px] shrink-0 overflow-hidden rounded-2xl bg-ink-2">
                    {l.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- miniatura pública ya optimizada (WebP) del catálogo
                      <img src={l.imageUrl} alt="" loading="lazy" decoding="async" width={76} height={76} className={"size-full object-cover" + (l.available ? "" : " opacity-50 grayscale")} />
                    ) : (
                      <div className="flex size-full items-center justify-center text-mist/60">
                        <ImageOff className="size-5" aria-hidden />
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-[14.5px] font-medium leading-snug text-fg">{l.name}</p>
                        <p className="mt-0.5 font-mono text-[11px] tracking-tight text-mist">Ref. {l.reference}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => dispatch({ type: "remove", reference: l.reference })}
                        className="-mr-2 -mt-1.5 flex size-10 shrink-0 items-center justify-center rounded-full text-mist transition-colors hover:bg-fg/5 hover:text-fg active:scale-90"
                        aria-label={`Quitar ${l.name}`}
                      >
                        <Trash2 className="size-[17px]" strokeWidth={1.6} aria-hidden />
                      </button>
                    </div>
                    {l.available ? (
                      <>
                        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                          <div className="flex items-center rounded-full border border-edge bg-card" role="group" aria-label={`Cantidad de ${l.name}`}>
                            <button
                              type="button"
                              className={stepBtn}
                              onClick={() => dispatch({ type: "setQuantity", reference: l.reference, quantity: l.quantity - 1 })}
                              aria-label={l.quantity === 1 ? `Quitar ${l.name}` : `Una unidad menos de ${l.name}`}
                            >
                              <Minus className="size-4" strokeWidth={1.8} aria-hidden />
                            </button>
                            <output className="w-7 text-center text-sm font-semibold tabular-nums text-fg" aria-live="polite">
                              {l.quantity}
                            </output>
                            <button
                              type="button"
                              className={stepBtn}
                              disabled={enTope}
                              onClick={() => dispatch({ type: "setQuantity", reference: l.reference, quantity: l.quantity + 1 })}
                              aria-label={`Una unidad más de ${l.name}`}
                            >
                              <Plus className="size-4" strokeWidth={1.8} aria-hidden />
                            </button>
                          </div>
                          <div className="text-right">
                            {subtotal === null ? (
                              <p className="text-sm text-mist">Precio a consultar</p>
                            ) : (
                              <>
                                <p className="text-[15px] font-semibold tabular-nums text-fg">{formatCop(subtotal)}</p>
                                {l.quantity > 1 && <p className="text-[11px] tabular-nums text-mist">{formatCop(l.unitPrice as number)} c/u</p>}
                              </>
                            )}
                          </div>
                        </div>
                        {enTope && l.maxQuantity !== null && (
                          <p className="mt-1.5 text-[12px] font-medium text-[var(--tienda-oro)]">
                            {limite === 1 ? "Solo queda 1 unidad disponible." : `Solo quedan ${limite} unidades disponibles.`}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="mt-auto pt-2 text-[13px] font-medium text-mist">Agotado · no se incluirá en tu pedido</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <footer className="shrink-0 border-t border-edge bg-ink px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-mist">Total de la selección</span>
              <span className="text-xl font-semibold tabular-nums text-fg">{formatCop(total)}</span>
            </div>
            {unpricedItems > 0 && (
              <p className="mt-1 text-right text-xs text-mist">
                {unpricedItems === 1 ? "+ 1 producto con precio a consultar" : `+ ${unpricedItems} productos con precio a consultar`}
              </p>
            )}
            {error && (
              <p role="alert" className="mt-3 rounded-2xl bg-ink-2 px-4 py-2.5 text-center text-[13px] text-fg">
                {error}
              </p>
            )}
            {!whatsappValido ? (
              <p className="mt-4 rounded-2xl bg-ink-2 px-4 py-3 text-center text-sm text-mist">Este catálogo todavía no tiene un WhatsApp de pedidos configurado.</p>
            ) : !hayPedibles ? (
              <p className="mt-4 rounded-2xl bg-ink-2 px-4 py-3 text-center text-sm text-mist">No hay piezas disponibles para pedir en tu selección.</p>
            ) : (
              <button
                type="button"
                onClick={pedir}
                disabled={enviando}
                aria-busy={enviando}
                className="mt-4 flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-[var(--tienda-oro)] text-[15px] font-semibold text-white shadow-sm transition-[background-color,transform,opacity] duration-150 hover:bg-[var(--tienda-oro-hover)] active:scale-[0.98] disabled:opacity-80"
              >
                {enviando ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <MessageCircle className="size-5" strokeWidth={1.8} aria-hidden />}
                {enviando ? "Verificando tu pedido…" : "Enviar pedido por WhatsApp"}
              </button>
            )}
            {solicitud?.requestId && hayPedibles && (
              <div className="mt-3 flex items-center justify-between gap-3 text-[12.5px] text-mist">
                <p>
                  Solicitud <span className="font-mono font-medium text-fg">{solicitud.requestId}</span> lista. ¿No se abrió WhatsApp? Toca de nuevo.
                </p>
                <button type="button" onClick={() => dispatch({ type: "clear" })} className="shrink-0 font-medium text-fg underline underline-offset-4">
                  Vaciar
                </button>
              </div>
            )}
          </footer>
        </>
      )}
    </Dialogo>
  );
}
