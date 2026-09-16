"use client";

import { useMemo, useState } from "react";
import { Search, Minus, Plus, ShoppingBag, CheckCircle2 } from "lucide-react";
import { Modal, Button, inputClass } from "../ui";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import type { ProductoInventarioUI } from "@/app/amoreweb/(app)/inventario/page";

// Módulo Inventario -- "Registrar venta" (autorizado). Flujo: buscar/elegir
// producto -> cantidad -> total (calculado acá SOLO para mostrar de
// inmediato -- el total REAL que cuenta es el que calcula el backend, ver
// app/api/agenda/[token]/inventario/ventas/route.ts) -> confirmar.
//
// Seguridad (sección "SEGURIDAD Y DATOS" del pedido) -- este modal NUNCA
// envía precio ni total al backend, solo productoId + cantidad: el backend
// vuelve a obtener el precio real y a calcular el total, nunca confía en lo
// que se ve en pantalla acá.
//
// Idempotencia (sección "CONFIRMAR VENTA" -- nunca duplicar por doble clic):
// idempotencyKey se genera UNA vez al abrir este modal (useState lazy, nunca
// se regenera mientras el modal sigue abierto) y el botón se deshabilita
// mientras la petición está en curso -- doble protección real (frontend +
// la propia idempotencia atómica del backend, ver la migración SQL).
export function VentaModal({
  token,
  productos,
  onClose,
  onVendido,
}: {
  token: string;
  productos: ProductoInventarioUI[];
  onClose: () => void;
  onVendido: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [busqueda, setBusqueda] = useState("");
  const [seleccionado, setSeleccionado] = useState<ProductoInventarioUI | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ productoNombre: string; cantidad: number; total: number; stockRestante: number } | null>(null);

  const filtrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return productos;
    return productos.filter((p) => p.nombre.toLowerCase().includes(texto));
  }, [productos, busqueda]);

  const total = seleccionado ? seleccionado.precio * cantidad : 0;
  const cantidadValida = Number.isInteger(cantidad) && cantidad >= 1 && (seleccionado ? cantidad <= seleccionado.stock : false);

  function ajustarCantidad(delta: number) {
    setCantidad((actual) => {
      const siguiente = actual + delta;
      if (siguiente < 1) return 1;
      if (seleccionado && siguiente > seleccionado.stock) return seleccionado.stock;
      return siguiente;
    });
  }

  async function confirmarVenta() {
    if (!seleccionado || !cantidadValida || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/agenda/${token}/inventario/ventas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productoId: seleccionado.id, cantidad, idempotencyKey }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "No se pudo registrar la venta");
      setResultado({ productoNombre: body.venta.productoNombre, cantidad: body.venta.cantidad, total: body.venta.total, stockRestante: body.stockRestante });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la venta");
    } finally {
      setEnviando(false);
    }
  }

  // FASE 7 (autorizado) -- confirmación clara post-venta, resume
  // producto/cantidad/total/stock restante, y avisa que el ingreso ya quedó
  // en Contabilidad (real: la venta ES la fuente que Contabilidad suma, ver
  // lib/contabilidad/reporte.ts). "Listo" cierra y refresca el inventario.
  if (resultado) {
    return (
      <Modal onClose={onVendido} maxWidth="max-w-sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-success text-success-text">
            <CheckCircle2 className="size-7" />
          </div>
          <div>
            <p className="text-base font-semibold text-fg">Venta registrada correctamente</p>
          </div>
          <div className="w-full rounded-2xl border border-edge bg-ink p-4 text-left text-sm">
            <div className="flex justify-between py-1">
              <span className="text-mist">Producto</span>
              <span className="font-medium text-fg">{resultado.productoNombre}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-mist">Cantidad</span>
              <span className="font-medium text-fg">{resultado.cantidad}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-mist">Total</span>
              <span className="font-semibold text-fg">{formatearPrecioCop(resultado.total)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-mist">Stock restante</span>
              <span className="font-medium text-fg">{resultado.stockRestante}</span>
            </div>
          </div>
          <p className="text-xs text-mist">Ingreso registrado en Contabilidad.</p>
          <Button onClick={onVendido} className="mt-1 w-full">
            Listo
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <h2 className="text-base font-semibold text-fg">Registrar venta</h2>

      <div className="mt-4 flex flex-col gap-3.5">
        {!seleccionado ? (
          <>
            <label className="flex items-center gap-2.5 rounded-2xl border border-edge bg-ink px-4 py-2.5">
              <Search className="size-4 shrink-0 text-mist" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar producto..."
                autoFocus
                className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-mist"
              />
            </label>

            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {filtrados.length === 0 ? (
                <p className="py-6 text-center text-sm text-mist">Ningún producto disponible coincide con la búsqueda.</p>
              ) : (
                filtrados.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSeleccionado(p);
                      setCantidad(1);
                    }}
                    className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-3 text-left hover:bg-ink-2"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-lime-soft">
                      {p.fotoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- URL dinámica de Storage
                        <img src={p.fotoUrl} alt={p.nombre} className="size-full object-cover" />
                      ) : (
                        <ShoppingBag className="size-4 text-lime-text/50" strokeWidth={1.25} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{p.nombre}</p>
                      <p className="truncate text-xs text-mist">
                        {formatearPrecioCop(p.precio)} · Stock {p.stock}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-2xl border border-edge bg-ink p-3.5">
              <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-lime-soft">
                {seleccionado.fotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL dinámica de Storage
                  <img src={seleccionado.fotoUrl} alt={seleccionado.nombre} className="size-full object-cover" />
                ) : (
                  <ShoppingBag className="size-5 text-lime-text/50" strokeWidth={1.25} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{seleccionado.nombre}</p>
                <p className="text-xs text-mist">
                  {formatearPrecioCop(seleccionado.precio)} · Stock disponible: {seleccionado.stock}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSeleccionado(null);
                  setBusqueda("");
                }}
                className="shrink-0 text-xs font-medium text-lime-text hover:underline"
              >
                Cambiar
              </button>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-mist">Cantidad</label>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => ajustarCantidad(-1)}
                  disabled={cantidad <= 1}
                  className="flex size-10 items-center justify-center rounded-xl border border-edge text-fg disabled:opacity-40"
                >
                  <Minus className="size-4" />
                </button>
                <input
                  type="number"
                  min={1}
                  max={seleccionado.stock}
                  step={1}
                  value={cantidad}
                  onChange={(e) => {
                    const valor = Math.trunc(Number(e.target.value) || 1);
                    setCantidad(Math.min(Math.max(valor, 1), seleccionado.stock));
                  }}
                  className={`${inputClass} w-20 text-center`}
                />
                <button
                  type="button"
                  onClick={() => ajustarCantidad(1)}
                  disabled={cantidad >= seleccionado.stock}
                  className="flex size-10 items-center justify-center rounded-xl border border-edge text-fg disabled:opacity-40"
                >
                  <Plus className="size-4" />
                </button>
              </div>
              {cantidad >= seleccionado.stock && <p className="mt-1.5 text-xs text-mist">Ya seleccionaste todo el stock disponible.</p>}
            </div>

            <div className="rounded-2xl border border-edge bg-ink p-4 text-sm">
              <div className="flex justify-between py-1">
                <span className="text-mist">Precio unitario</span>
                <span className="font-medium text-fg">{formatearPrecioCop(seleccionado.precio)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-mist">Cantidad</span>
                <span className="font-medium text-fg">{cantidad}</span>
              </div>
              <div className="flex justify-between border-t border-edge pt-2 mt-1">
                <span className="font-medium text-fg">Total venta</span>
                <span className="text-base font-semibold text-fg">{formatearPrecioCop(total)}</span>
              </div>
            </div>
          </>
        )}

        {error && <p className="text-xs text-danger-text">{error}</p>}
      </div>

      <div className="mt-4 flex gap-2.5">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          Cancelar
        </Button>
        {seleccionado && (
          <Button onClick={confirmarVenta} loading={enviando} disabled={!cantidadValida} className="flex-1">
            Registrar venta
          </Button>
        )}
      </div>
    </Modal>
  );
}
