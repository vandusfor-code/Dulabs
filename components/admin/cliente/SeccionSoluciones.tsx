"use client";

import { useCallback, useEffect, useState } from "react";
import { Pill } from "@/components/dashboard/shell/ui";
import { AgenteIcono } from "@/components/dashboard/marketplace/AgenteIcono";
import { formatearTelefono } from "@/lib/format";
import { Seccion, fechaLarga } from "./AdminClienteUI";

// F15.2 (Operations Center, cierre) -- portado del admin legacy. Activa
// agentes del Marketplace EN CORTESÍA (sin cobro) para el cliente -- la
// única acción con efecto real acá es POST .../marketplace, ya existente y
// sin cambios; este archivo es puramente el porte de la UI.

type NumeroAdmin = { phoneNumberId: string; nombreNegocio: string; telefonoNegocio: string };
type AgenteMarketplaceVista = {
  slug: string;
  nombre: string;
  categoria: string;
  icono: string;
  descripcion: string;
  usaAgenda: boolean;
  activacion: {
    phoneNumberId: string;
    nombreNegocio: string;
    tipoPlan: string;
    esCortesia: boolean;
    cortesiaActivadaPorEmail: string | null;
    cortesiaMotivo: string | null;
    createdAt: string;
  } | null;
};
type MarketplaceData = { numeros: NumeroAdmin[]; agentes: AgenteMarketplaceVista[] };

function ConfirmarCortesia({
  agente,
  numeroDefecto,
  guardando,
  onCancelar,
  onConfirmar,
}: {
  agente: AgenteMarketplaceVista;
  numeroDefecto: NumeroAdmin;
  guardando: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  return (
    <div className="mt-3 rounded-lg border border-lime/30 bg-lime/5 p-4">
      <p className="text-sm text-fg">
        ¿Activar <strong>&quot;{agente.nombre}&quot;</strong> en cortesía para {numeroDefecto.nombreNegocio} ({formatearTelefono(numeroDefecto.telefonoNegocio)})?
      </p>
      <p className="mt-1 text-xs text-mist">Esto no realizará ningún cobro al cliente.</p>
      <label className="mt-3 block">
        <span className="font-mono text-[10.5px] uppercase tracking-widest text-mist">Motivo</span>
        <input
          autoFocus
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ej. Incluido en implementación, Prueba, Cortesía comercial…"
          maxLength={200}
          className="mt-1.5 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-lime/50"
        />
      </label>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => onConfirmar(motivo)}
          disabled={guardando || !motivo.trim()}
          className="rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {guardando ? "Activando…" : "Activar"}
        </button>
        <button onClick={onCancelar} disabled={guardando} className="rounded-lg px-4 py-2 text-xs font-medium text-mist hover:bg-ink disabled:opacity-50">
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function SeccionSoluciones({ idTenant, accessToken }: { idTenant: string; accessToken: string }) {
  const [data, setData] = useState<MarketplaceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmandoSlug, setConfirmandoSlug] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const cargar = useCallback(() => {
    fetch(`/api/dashboard/admin/clientes/${idTenant}/marketplace`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Error cargando soluciones");
        setData(json);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [idTenant, accessToken]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const activar = useCallback(
    async (slug: string, phoneNumberId: string, motivo: string) => {
      setGuardando(true);
      setMensaje(null);
      try {
        const res = await fetch(`/api/dashboard/admin/clientes/${idTenant}/marketplace`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ slug, phone_number_id: phoneNumberId, motivo }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "No se pudo activar");
        setMensaje(json.mensaje ?? "Solución activada correctamente.");
        setConfirmandoSlug(null);
        cargar();
      } catch (err) {
        setMensaje(err instanceof Error ? err.message : String(err));
      } finally {
        setGuardando(false);
      }
    },
    [idTenant, accessToken, cargar],
  );

  if (error) return <Seccion titulo="Soluciones"><p className="text-sm text-red-400">{error}</p></Seccion>;
  if (!data) return <Seccion titulo="Soluciones"><p className="text-sm text-mist">Cargando…</p></Seccion>;

  const numeroDefecto = data.numeros[0] ?? null;

  return (
    <Seccion titulo="Soluciones">
      {!numeroDefecto && (
        <p className="mb-3 rounded-lg border border-edge bg-ink p-3 text-xs leading-relaxed text-mist">
          Este cliente todavía no tiene WhatsApp conectado — no se puede activar ninguna solución hasta que conecte un número.
        </p>
      )}
      {mensaje && <p className="mb-3 text-xs text-mist">{mensaje}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data.agentes.map((a) => (
          <div key={a.slug} className="rounded-lg border border-edge bg-ink p-4">
            <div className="flex items-start gap-3">
              <AgenteIcono icono={a.icono} className="size-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">{a.nombre}</p>
                <p className="mt-0.5 text-xs text-mist">{a.categoria}</p>
                {a.activacion ? (
                  <div className="mt-2 flex flex-col gap-1">
                    <Pill tone="success">{a.activacion.esCortesia ? "Activo (cortesía)" : "Activo"}</Pill>
                    <p className="text-[11px] text-mist">
                      en {a.activacion.nombreNegocio}
                      {a.activacion.esCortesia && a.activacion.cortesiaMotivo ? ` — ${a.activacion.cortesiaMotivo}` : ""}
                    </p>
                    {a.activacion.esCortesia && a.activacion.cortesiaActivadaPorEmail && (
                      <p className="text-[11px] text-mist/70">
                        Otorgada por {a.activacion.cortesiaActivadaPorEmail} el {fechaLarga(a.activacion.createdAt)}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="mt-2">
                    <Pill tone="neutral">No activo</Pill>
                  </div>
                )}
              </div>
            </div>

            {!a.activacion && numeroDefecto && confirmandoSlug !== a.slug && (
              <button
                onClick={() => setConfirmandoSlug(a.slug)}
                className="mt-3 w-full rounded-lg border border-dashed border-edge px-3 py-2 text-xs font-semibold text-fg transition-colors hover:border-lime/40"
              >
                Activar en cortesía
              </button>
            )}
            {confirmandoSlug === a.slug && numeroDefecto && (
              <ConfirmarCortesia
                agente={a}
                numeroDefecto={numeroDefecto}
                guardando={guardando}
                onCancelar={() => setConfirmandoSlug(null)}
                onConfirmar={(motivo) => activar(a.slug, numeroDefecto.phoneNumberId, motivo)}
              />
            )}
          </div>
        ))}
      </div>
    </Seccion>
  );
}
