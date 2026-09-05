"use client";

import { useState } from "react";
import { Phone, UserPlus, Loader2 } from "lucide-react";
import type { ClienteVinculado, CitaResumenChat } from "@/lib/chats/tipos";
import { Button, Field, inputClass, cn } from "@/components/spa-panel/ui";

export type TabCliente = "informacion" | "citas";

// Chats AMORE (autorizado) — panel derecho del mockup. Solo Información y
// Citas: "Notas" del mockup se omite a propósito -- no existe ninguna tabla
// real para persistir notas de cliente en esta fase, y no se inventa un
// campo que se perdería al recargar (ver reporte final, punto de alcance
// honesto).
export function ClientPanel({
  telefono,
  cliente,
  historial,
  cargando,
  tab,
  onTab,
  onCrearCliente,
}: {
  telefono: string;
  cliente: ClienteVinculado;
  historial: CitaResumenChat[];
  cargando: boolean;
  tab: TabCliente;
  onTab: (t: TabCliente) => void;
  onCrearCliente: (body: { nombre: string; correo?: string }) => Promise<unknown>;
}) {
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [correoNuevo, setCorreoNuevo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    if (!nombreNuevo.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await onCrearCliente({ nombre: nombreNuevo.trim(), correo: correoNuevo.trim() || undefined });
      setCreando(false);
      setNombreNuevo("");
      setCorreoNuevo("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el cliente");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-edge bg-card">
      <div className="flex flex-col items-center gap-2 border-b border-edge p-5 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-lime-soft text-lg font-semibold text-lime-text">
          {(cliente?.nombre ?? telefono).slice(0, 1).toUpperCase()}
        </div>
        <p className="text-sm font-semibold text-fg">{cliente?.nombre ?? "Cliente no registrado"}</p>
        <p className="flex items-center gap-1 text-xs text-mist">
          <Phone className="size-3" /> {telefono}
        </p>
      </div>

      <div className="flex border-b border-edge">
        {(["informacion", "citas"] as TabCliente[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTab(t)}
            className={cn(
              "flex-1 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
              tab === t ? "border-lime text-lime-text" : "border-transparent text-mist hover:text-fg"
            )}
          >
            {t === "informacion" ? "Información" : "Citas"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {cargando ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-4 animate-spin text-mist" />
          </div>
        ) : tab === "informacion" ? (
          cliente ? (
            <div className="flex flex-col gap-3 text-sm">
              <div>
                <p className="text-xs text-mist">Correo</p>
                <p className="text-fg">{cliente.correo ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-mist">Cliente desde</p>
                <p className="text-fg">{new Date(cliente.fechaRegistro).toLocaleDateString("es-CO")}</p>
              </div>
              <div>
                <p className="text-xs text-mist">Citas registradas</p>
                <p className="text-fg">{historial.length}</p>
              </div>
            </div>
          ) : creando ? (
            <div className="flex flex-col gap-3">
              <Field label="Nombre">
                <input value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} className={inputClass} placeholder="Nombre de la clienta" />
              </Field>
              <Field label="Correo (opcional)">
                <input value={correoNuevo} onChange={(e) => setCorreoNuevo(e.target.value)} className={inputClass} placeholder="correo@ejemplo.com" />
              </Field>
              {error && <p className="text-xs text-danger-text">{error}</p>}
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setCreando(false)}>
                  Cancelar
                </Button>
                <Button className="flex-1" loading={guardando} onClick={guardar}>
                  Guardar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-mist">Cliente no registrado</p>
              <Button size="sm" onClick={() => setCreando(true)}>
                <UserPlus className="size-3.5" /> Crear cliente
              </Button>
            </div>
          )
        ) : historial.length === 0 ? (
          <p className="py-6 text-center text-sm text-mist">Sin citas registradas.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {historial.map((c) => (
              <div key={c.id} className="rounded-xl border border-edge p-3">
                <p className="text-sm font-medium text-fg">{c.servicio}</p>
                <p className="text-xs text-mist">
                  {c.profesional} · {new Date(c.inicio).toLocaleString("es-CO")}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
