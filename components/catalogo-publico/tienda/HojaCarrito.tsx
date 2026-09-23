"use client";

/**
 * "Tu selección": revisar y pedir. Hoja inferior en móvil, panel lateral en
 * escritorio. Un único CTA principal: "Pedir por WhatsApp", con el mensaje
 * armado desde las líneas del carrito (referencias reales de la BD).
 */
import { useEffect, useRef } from "react";
import { ImageOff, MessageCircle, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { formatCop } from "@/lib/business-agent-quote";
import { MAX_QUANTITY, cartTotal, cartWhatsappLink, lineSubtotal } from "@/lib/catalogo/carrito";
import { useCarrito, useTienda } from "@/components/catalogo-publico/tienda/TiendaContext";

const stepBtn =
  "flex size-10 items-center justify-center rounded-full text-fg transition-[background-color,transform] duration-150 hover:bg-fg/5 active:scale-90 disabled:opacity-30";

export function HojaCarrito() {
  const { carritoAbierto, cerrarCarrito, whatsapp } = useTienda();
  const { state, items, dispatch } = useCarrito();
  const cerrarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!carritoAbierto) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cerrarRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cerrarCarrito();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previo;
      window.removeEventListener("keydown", onKey);
    };
  }, [carritoAbierto, cerrarCarrito]);

  if (!carritoAbierto) return null;

  const { total, unpricedItems } = cartTotal(state);
  const pedir = cartWhatsappLink(whatsapp, state);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="tienda-seleccion-titulo">
      <button type="button" aria-label="Cerrar tu selección" onClick={cerrarCarrito} className="tienda-velo absolute inset-0 bg-fg/40 backdrop-blur-[2px]" />
      <section className="tienda-hoja absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-[28px] bg-ink shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[420px] md:rounded-none">
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-fg/15 md:hidden" aria-hidden />
        <header className="flex items-center justify-between px-5 pb-2 pt-3 md:pt-5">
          <div>
            <h2 id="tienda-seleccion-titulo" className="font-serif-tienda text-[26px] font-medium leading-tight text-fg">
              Tu selección
            </h2>
            <p className="text-xs text-mist">{items === 0 ? "Aún no has elegido piezas" : items === 1 ? "1 producto" : `${items} productos`}</p>
          </div>
          <button ref={cerrarRef} type="button" onClick={cerrarCarrito} className={stepBtn} aria-label="Cerrar">
            <X className="size-5" strokeWidth={1.6} />
          </button>
        </header>

        {state.lines.length === 0 ? (
          <div className="flex flex-col items-center px-8 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-8 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-[var(--tienda-oro-suave)] text-[var(--tienda-oro)]">
              <ShoppingBag className="size-7" strokeWidth={1.5} />
            </div>
            <p className="mt-4 text-[15px] font-medium text-fg">Tu selección está vacía</p>
            <p className="mt-1 max-w-xs text-sm text-mist">Toca «+» en las piezas que te gusten y pídelas todas juntas por WhatsApp.</p>
            <button type="button" onClick={cerrarCarrito} className="mt-6 h-12 rounded-full border border-edge px-6 text-sm font-medium text-fg transition-colors hover:bg-fg/5">
              Seguir explorando
            </button>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-edge overflow-y-auto overscroll-contain px-5">
              {state.lines.map((l) => {
                const subtotal = lineSubtotal(l);
                return (
                  <li key={l.reference} className="flex gap-3.5 py-4">
                    <div className="size-[76px] shrink-0 overflow-hidden rounded-2xl bg-ink-2">
                      {l.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- miniatura pública ya optimizada (WebP) del catálogo
                        <img src={l.imageUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                      ) : (
                        <div className="flex size-full items-center justify-center text-mist/60">
                          <ImageOff className="size-5" />
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
                          <Trash2 className="size-[17px]" strokeWidth={1.6} />
                        </button>
                      </div>
                      <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                        <div className="flex items-center rounded-full border border-edge bg-card">
                          <button
                            type="button"
                            className={stepBtn}
                            onClick={() => dispatch({ type: "setQuantity", reference: l.reference, quantity: l.quantity - 1 })}
                            aria-label={l.quantity === 1 ? `Quitar ${l.name}` : `Una unidad menos de ${l.name}`}
                          >
                            <Minus className="size-4" strokeWidth={1.8} />
                          </button>
                          <span className="w-7 text-center text-sm font-semibold tabular-nums text-fg" aria-label={`Cantidad: ${l.quantity}`}>
                            {l.quantity}
                          </span>
                          <button
                            type="button"
                            className={stepBtn}
                            disabled={l.quantity >= MAX_QUANTITY}
                            onClick={() => dispatch({ type: "setQuantity", reference: l.reference, quantity: l.quantity + 1 })}
                            aria-label={`Una unidad más de ${l.name}`}
                          >
                            <Plus className="size-4" strokeWidth={1.8} />
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
                    </div>
                  </li>
                );
              })}
            </ul>

            <footer className="border-t border-edge bg-ink px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
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
                  <MessageCircle className="size-5" strokeWidth={1.8} />
                  Pedir por WhatsApp
                </a>
              ) : (
                <p className="mt-4 rounded-2xl bg-ink-2 px-4 py-3 text-center text-sm text-mist">Este catálogo todavía no tiene un WhatsApp de pedidos configurado.</p>
              )}
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
