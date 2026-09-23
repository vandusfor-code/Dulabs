"use client";

/**
 * "Tu selección": revisar y pedir. Hoja inferior en móvil, panel lateral en
 * escritorio (diálogo nativo). Al abrirse, el BACKEND confirma cada
 * referencia (precio vigente, producto activo, disponibilidad): el carrito
 * del navegador nunca es la fuente de verdad. Un único CTA: "Pedir por
 * WhatsApp", con referencias y cantidades reales.
 */
import { useEffect, useState } from "react";
import { ImageOff, MessageCircle, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { formatCop } from "@/lib/business-agent-quote";
import { MAX_QUANTITY, cartTotal, cartWhatsappLink, lineSubtotal, type CartProduct, type CartState } from "@/lib/catalogo/carrito";
import { Dialogo } from "@/components/catalogo-publico/tienda/Dialogo";
import { useCarrito, useTienda } from "@/components/catalogo-publico/tienda/TiendaContext";

const stepBtn =
  "flex size-10 items-center justify-center rounded-full text-fg transition-[background-color,transform] duration-150 hover:bg-fg/5 active:scale-90 disabled:opacity-30";

interface Seleccion {
  items: CartProduct[];
  unknown: string[];
}

/** Pide al servidor la verdad de las referencias del carrito (solo referencias viajan). */
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

export function HojaCarrito() {
  const { carritoAbierto, cerrarCarrito, whatsapp, basePath, store } = useTienda();
  const { state, items, dispatch } = useCarrito();
  const [retirados, setRetirados] = useState<string[]>([]);

  // Reconciliación: UNA consulta por apertura, con las referencias de ese momento.
  useEffect(() => {
    if (!carritoAbierto) return;
    const actual = store.getSnapshot();
    if (actual.lines.length === 0) return;
    const controller = new AbortController();
    void resolverSeleccion(basePath, actual, controller.signal).then((r) => {
      if (!r || controller.signal.aborted) return;
      const nombres = actual.lines.filter((l) => r.unknown.includes(l.reference)).map((l) => l.name);
      store.dispatch({ type: "reconcile", resolved: r.items, unknown: r.unknown });
      if (nombres.length > 0) setRetirados(nombres);
    });
    return () => controller.abort();
  }, [carritoAbierto, basePath, store]);

  const cerrar = () => {
    setRetirados([]);
    cerrarCarrito();
  };

  const { total, unpricedItems } = cartTotal(state);
  const pedir = cartWhatsappLink(whatsapp, state);

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

      {retirados.length > 0 && (
        <p role="status" className="mx-5 mb-1 rounded-2xl bg-[var(--tienda-oro-suave)] px-4 py-2.5 text-[13px] text-fg">
          {retirados.length === 1 ? `«${retirados[0]}» ya no está disponible y se retiró de tu selección.` : `${retirados.length} piezas ya no están disponibles y se retiraron de tu selección.`}
        </p>
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
                            disabled={l.quantity >= MAX_QUANTITY}
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
            {pedir ? (
              <a
                href={pedir}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-[var(--tienda-oro)] text-[15px] font-semibold text-white shadow-sm transition-[background-color,transform] duration-150 hover:bg-[var(--tienda-oro-hover)] active:scale-[0.98]"
              >
                <MessageCircle className="size-5" strokeWidth={1.8} aria-hidden />
                Pedir por WhatsApp
              </a>
            ) : (
              <p className="mt-4 rounded-2xl bg-ink-2 px-4 py-3 text-center text-sm text-mist">
                {whatsapp ? "No hay piezas disponibles para pedir en tu selección." : "Este catálogo todavía no tiene un WhatsApp de pedidos configurado."}
              </p>
            )}
          </footer>
        </>
      )}
    </Dialogo>
  );
}
