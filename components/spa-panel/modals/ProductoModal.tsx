"use client";

import { useRef, useState } from "react";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Button, Field, inputClass, Modal } from "../ui";
import type { ProductoInventarioUI } from "@/app/admin/amore/inventario/page";

// Módulo Inventario (autorizado) -- crear/editar producto. Mismo patrón
// exacto que ServicioModal.tsx (Button/Field/inputClass/Modal de
// spa-panel/ui.tsx, estado local + fetch directo). La foto se sube en un
// segundo paso DESPUÉS de crear el producto (necesita el id real para el
// path del bucket) -- transparente para quien usa el modal: "Guardar
// producto" hace ambas llamadas si hay una foto nueva seleccionada.
export function ProductoModal({
  token,
  producto,
  onClose,
  onGuardado,
}: {
  token: string;
  producto: ProductoInventarioUI | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(producto?.descripcion ?? "");
  const [precio, setPrecio] = useState(producto ? String(producto.precio) : "");
  const [stock, setStock] = useState(producto?.stock ?? 0);
  const [categoria, setCategoria] = useState(producto?.categoria ?? "");
  const [activo, setActivo] = useState(producto?.activo ?? true);
  const [fotoUrl] = useState(producto?.fotoUrl ?? null);
  const [archivoFoto, setArchivoFoto] = useState<File | null>(null);
  const [previewFoto, setPreviewFoto] = useState<string | null>(null);
  const [eliminarFotoActual, setEliminarFotoActual] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputFotoRef = useRef<HTMLInputElement>(null);

  const ajustarStock = (delta: number) => setStock((actual) => Math.max(0, actual + delta));

  const elegirFoto = (archivo: File | null) => {
    setArchivoFoto(archivo);
    setEliminarFotoActual(false);
    setPreviewFoto(archivo ? URL.createObjectURL(archivo) : null);
  };

  const guardar = async () => {
    const precioNum = Number(precio);
    if (!nombre.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    if (!Number.isFinite(precioNum) || !Number.isInteger(precioNum) || precioNum < 0) {
      setError("El precio debe ser un número entero mayor o igual a 0");
      return;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      setError("El stock debe ser un número entero mayor o igual a 0");
      return;
    }

    setGuardando(true);
    setError(null);
    try {
      const url = producto ? `/api/agenda/${token}/inventario/${producto.id}` : `/api/agenda/${token}/inventario`;
      const res = await fetch(url, {
        method: producto ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          descripcion: descripcion.trim() || null,
          precio: precioNum,
          stock,
          categoria: categoria.trim() || null,
          activo,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "No se pudo guardar el producto");
      const idProducto: string = body.producto.id;

      if (archivoFoto) {
        const form = new FormData();
        form.append("archivo", archivoFoto);
        const resFoto = await fetch(`/api/agenda/${token}/inventario/${idProducto}/foto`, { method: "POST", body: form });
        const bodyFoto = await resFoto.json();
        if (!resFoto.ok) throw new Error(bodyFoto.error ?? "El producto se guardó, pero la foto no se pudo subir");
      } else if (eliminarFotoActual && producto?.fotoUrl) {
        await fetch(`/api/agenda/${token}/inventario/${idProducto}/foto`, { method: "DELETE" });
      }

      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error guardando");
    } finally {
      setGuardando(false);
    }
  };

  const fotoAMostrar = previewFoto ?? (eliminarFotoActual ? null : fotoUrl);

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      <h2 className="text-base font-semibold text-fg">{producto ? "Editar producto" : "Nuevo producto"}</h2>

      <div className="mt-4 flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-0.5">
        <Field label="Fotografía (opcional)">
          <div className="flex items-center gap-3">
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-edge bg-lime-soft">
              {fotoAMostrar ? (
                // eslint-disable-next-line @next/next/no-img-element -- preview local o URL dinámica de Storage
                <img src={fotoAMostrar} alt="Foto del producto" className="size-full object-cover" />
              ) : (
                <ShoppingBag className="size-6 text-lime-text/50" strokeWidth={1.25} />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <input
                ref={inputFotoRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => elegirFoto(e.target.files?.[0] ?? null)}
              />
              <Button type="button" variant="secondary" size="sm" onClick={() => inputFotoRef.current?.click()}>
                {fotoAMostrar ? "Reemplazar" : "Subir foto"}
              </Button>
              {fotoAMostrar && (
                <button
                  type="button"
                  onClick={() => {
                    elegirFoto(null);
                    setEliminarFotoActual(true);
                  }}
                  className="flex items-center gap-1 text-xs text-danger-text hover:underline"
                >
                  <Trash2 className="size-3.5" /> Quitar foto
                </button>
              )}
            </div>
          </div>
        </Field>

        <Field label="Nombre del producto">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Kit de Cuidado Capilar" className={inputClass} />
        </Field>
        <Field label="Descripción (opcional)">
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Ej. Kit para cuidado y mantenimiento del cabello."
            rows={3}
            className={inputClass}
          />
        </Field>
        <div className="flex gap-3">
          <Field label="Precio (COP)">
            <input type="number" min={0} step={1} value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Ej. 45000" className={inputClass} />
          </Field>
          <Field label="Categoría (opcional)">
            <input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ej. Cabello" className={inputClass} />
          </Field>
        </div>

        <Field label="Stock">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => ajustarStock(-5)} className="rounded-lg border border-edge px-2 py-1.5 text-xs font-medium text-fg hover:bg-ink-2">
              −5
            </button>
            <button type="button" onClick={() => ajustarStock(-1)} className="flex size-8 items-center justify-center rounded-lg border border-edge text-fg hover:bg-ink-2">
              <Minus className="size-3.5" />
            </button>
            <input
              type="number"
              min={0}
              step={1}
              value={stock}
              onChange={(e) => setStock(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
              className={`${inputClass} w-20 text-center`}
            />
            <button type="button" onClick={() => ajustarStock(1)} className="flex size-8 items-center justify-center rounded-lg border border-edge text-fg hover:bg-ink-2">
              <Plus className="size-3.5" />
            </button>
            <button type="button" onClick={() => ajustarStock(5)} className="rounded-lg border border-edge px-2 py-1.5 text-xs font-medium text-fg hover:bg-ink-2">
              +5
            </button>
            <button type="button" onClick={() => ajustarStock(10)} className="rounded-lg border border-edge px-2 py-1.5 text-xs font-medium text-fg hover:bg-ink-2">
              +10
            </button>
          </div>
        </Field>

        <label className="flex items-center gap-2.5 text-sm text-fg">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="size-4 accent-lime" />
          Activo (visible en la tienda)
        </label>

        {error && <p className="text-xs text-danger-text">{error}</p>}
      </div>

      <div className="mt-4 flex gap-2.5">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          Cancelar
        </Button>
        <Button onClick={guardar} loading={guardando} className="flex-1">
          Guardar producto
        </Button>
      </div>
    </Modal>
  );
}
