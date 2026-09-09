"use client";

import { useRef, useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import { Button, Modal } from "../ui";

// Módulo Inventario (autorizado) -- carga masiva por Excel. Flujo en 2
// pasos, nunca inserta nada en el primer paso (sección VALIDACIÓN DEL EXCEL
// del pedido: "Vista previa de importación" antes de tocar la base de
// datos): 1) subir archivo -> preview fila por fila; 2) "Importar productos
// válidos" -> confirma solo las filas realmente válidas y nuevas.
type FilaImportacion = {
  fila: number;
  nombre: string | null;
  descripcion: string | null;
  precio: number | null;
  stock: number | null;
  categoria: string | null;
  activo: boolean;
  errores: string[];
  estado: "valido" | "error" | "existente";
};

type ResultadoImportacion = {
  filas: FilaImportacion[];
  totalFilas: number;
  validos: number;
  conErrores: number;
  existentes: number;
};

const ETIQUETA_ESTADO: Record<FilaImportacion["estado"], { texto: string; clase: string }> = {
  valido: { texto: "Válido", clase: "bg-success text-success-text" },
  error: { texto: "Con errores", clase: "bg-danger text-danger-text" },
  existente: { texto: "Producto existente", clase: "bg-warning text-warning-text" },
};

export function ImportarInventarioModal({ token, onClose, onImportado }: { token: string; onClose: () => void; onImportado: () => void }) {
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [cargando, setCargando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const subirArchivo = async (archivo: File) => {
    setCargando(true);
    setError(null);
    setMensajeExito(null);
    try {
      const form = new FormData();
      form.append("archivo", archivo);
      const res = await fetch(`/api/agenda/${token}/inventario/importar`, { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "No se pudo leer el archivo");
      setResultado(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error leyendo el archivo");
    } finally {
      setCargando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const confirmarImportacion = async () => {
    if (!resultado) return;
    const validas = resultado.filas.filter((f) => f.estado === "valido");
    if (validas.length === 0) return;

    setImportando(true);
    setError(null);
    try {
      const res = await fetch(`/api/agenda/${token}/inventario/importar/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filas: validas }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "No se pudo completar la importación");
      setMensajeExito(`Se importaron ${body.creados} producto${body.creados === 1 ? "" : "s"} correctamente.`);
      onImportado();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error importando los productos");
    } finally {
      setImportando(false);
    }
  };

  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl">
      <h2 className="text-base font-semibold text-fg">Importar productos</h2>
      <p className="mt-1 text-sm text-mist">Puedes cargar múltiples productos utilizando la plantilla de Inventario AMORE.</p>

      <div className="mt-4 flex flex-wrap gap-2.5">
        <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && subirArchivo(e.target.files[0])} />
        <Button variant="secondary" onClick={() => inputRef.current?.click()} loading={cargando}>
          <Upload className="size-4" /> Seleccionar Excel
        </Button>
        <a
          href="/plantillas/Plantilla_Inventario_AMORE.xlsx"
          download
          className="inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-medium text-mist transition-colors hover:bg-ink-2 hover:text-fg"
        >
          <Download className="size-4" /> Descargar plantilla
        </a>
      </div>

      {error && <p className="mt-3 text-sm text-danger-text">{error}</p>}
      {mensajeExito && <p className="mt-3 text-sm text-success-text">{mensajeExito}</p>}

      {cargando && (
        <div className="mt-6 flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      )}

      {resultado && !mensajeExito && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-fg">Vista previa de importación</h3>
          <div className="mt-2 grid grid-cols-3 gap-2.5">
            <ResumenChip etiqueta="Filas encontradas" valor={resultado.totalFilas} />
            <ResumenChip etiqueta="Productos válidos" valor={resultado.validos} tono="success" />
            <ResumenChip etiqueta="Con errores" valor={resultado.conErrores} tono="danger" />
          </div>

          <div className="mt-3 max-h-[40vh] overflow-y-auto rounded-2xl border border-edge">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge bg-ink text-left text-xs uppercase tracking-wide text-mist">
                  <th className="px-3 py-2 font-medium">Fila</th>
                  <th className="px-3 py-2 font-medium">Producto</th>
                  <th className="px-3 py-2 font-medium">Precio</th>
                  <th className="px-3 py-2 font-medium">Stock</th>
                  <th className="px-3 py-2 font-medium">Categoría</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {resultado.filas.map((fila) => (
                  <tr key={fila.fila}>
                    <td className="px-3 py-2 text-fg">{fila.fila}</td>
                    <td className="px-3 py-2 text-fg">{fila.nombre ?? "—"}</td>
                    <td className="px-3 py-2 text-fg">{fila.precio ?? "—"}</td>
                    <td className="px-3 py-2 text-fg">{fila.stock ?? "—"}</td>
                    <td className="px-3 py-2 text-fg">{fila.categoria ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${ETIQUETA_ESTADO[fila.estado].clase}`}>
                        {ETIQUETA_ESTADO[fila.estado].texto}
                      </span>
                      {fila.errores.length > 0 && (
                        <ul className="mt-1 list-inside list-disc text-[11px] text-danger-text">
                          {fila.errores.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      )}
                      {fila.estado === "existente" && (
                        <p className="mt-1 text-[11px] text-mist">Ya existe un producto con este nombre; no se creará un duplicado.</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex gap-2.5">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setResultado(null);
                setError(null);
              }}
            >
              Corregir archivo
            </Button>
            <Button className="flex-1" onClick={confirmarImportacion} loading={importando} disabled={resultado.validos === 0}>
              Importar productos válidos ({resultado.validos})
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ResumenChip({ etiqueta, valor, tono }: { etiqueta: string; valor: number; tono?: "success" | "danger" }) {
  const clase = tono === "success" ? "text-success-text" : tono === "danger" ? "text-danger-text" : "text-fg";
  return (
    <div className="rounded-xl border border-edge bg-ink px-3 py-2.5 text-center">
      <p className={`text-lg font-semibold ${clase}`}>{valor}</p>
      <p className="text-[11px] text-mist">{etiqueta}</p>
    </div>
  );
}
