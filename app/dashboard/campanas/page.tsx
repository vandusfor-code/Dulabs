"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Send, Users } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";

type Plantilla = {
  id: number;
  nombre: string;
  cuerpo: string;
  estado: string;
};

export default function CampanasPage() {
  const { session } = useDashboard();
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null);

  const [plantillaCampana, setPlantillaCampana] = useState<number | "">("");
  const [destinatarios, setDestinatarios] = useState("");
  const [enviandoCampana, setEnviandoCampana] = useState(false);
  const [resultadoCampana, setResultadoCampana] = useState<{ enviados: number; fallidos: number } | string | null>(
    null
  );

  useEffect(() => {
    if (!session) return;
    fetch("/api/plantillas", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setPlantillas(data.plantillas ?? []))
      .catch(() => setPlantillas([]));
  }, [session]);

  const enviarCampana = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!session || !plantillaCampana) return;
      setEnviandoCampana(true);
      setResultadoCampana(null);
      const lista = destinatarios
        .split(/[\n,]+/)
        .map((d) => d.trim())
        .filter(Boolean);
      try {
        const res = await fetch("/api/campanas/enviar", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ plantilla_id: plantillaCampana, destinatarios: lista }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error enviando la campaña");
        setResultadoCampana({ enviados: data.enviados, fallidos: data.fallidos?.length ?? 0 });
        setDestinatarios("");
      } catch (err) {
        setResultadoCampana(err instanceof Error ? err.message : String(err));
      } finally {
        setEnviandoCampana(false);
      }
    },
    [session, plantillaCampana, destinatarios]
  );

  const aprobadas = (plantillas ?? []).filter((p) => p.estado === "APPROVED");
  const conteoDestinatarios = destinatarios.split(/[\n,]+/).map((d) => d.trim()).filter(Boolean).length;
  const plantillaElegida = aprobadas.find((p) => p.id === plantillaCampana);

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Crear"
        title="Campañas"
        description="Envía una plantilla aprobada por Meta a toda tu lista de clientes de un solo golpe."
      />

      <div className="px-4 pt-6 md:px-8">
        {plantillas === null ? (
          <p className="text-sm text-mist">Cargando plantillas…</p>
        ) : aprobadas.length === 0 ? (
          <div className="rounded-xl border border-edge bg-card p-8 text-center">
            <Send className="mx-auto size-10 text-mist/40" strokeWidth={1.2} />
            <p className="mt-3 text-sm font-semibold text-fg">Necesitas una plantilla aprobada</p>
            <p className="mt-1 max-w-sm mx-auto text-xs leading-relaxed text-mist">
              Meta revisa las plantillas nuevas automáticamente, normalmente en minutos u horas.
            </p>
            <Link
              href="/dashboard/plantillas"
              className="mt-4 inline-block rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg hover:bg-lime-hover"
            >
              Crear una plantilla →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,320px)]">
            <form onSubmit={enviarCampana} className="flex flex-col gap-4 rounded-xl border border-edge bg-card p-6">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">Plantilla</label>
                <select
                  required
                  value={plantillaCampana}
                  onChange={(e) => setPlantillaCampana(Number(e.target.value))}
                  className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                >
                  <option value="">Selecciona una plantilla</option>
                  {aprobadas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">
                  Destinatarios (uno por línea, con indicativo de país)
                </label>
                <textarea
                  required
                  rows={6}
                  value={destinatarios}
                  onChange={(e) => setDestinatarios(e.target.value)}
                  placeholder={"573001234567\n573007654321"}
                  className="w-full rounded-lg border border-edge bg-ink px-4 py-3 text-sm text-fg outline-none focus:border-lime/50"
                />
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-mist">
                  <Users className="size-3.5" /> {conteoDestinatarios} destinatario{conteoDestinatarios === 1 ? "" : "s"}
                </p>
              </div>
              {resultadoCampana && (
                <p className="rounded-lg border border-edge bg-ink p-3 text-xs leading-relaxed text-mist">
                  {typeof resultadoCampana === "string"
                    ? resultadoCampana
                    : `Enviados: ${resultadoCampana.enviados}${resultadoCampana.fallidos ? ` · Fallidos: ${resultadoCampana.fallidos}` : ""}`}
                </p>
              )}
              <button
                type="submit"
                disabled={enviandoCampana}
                className="btn-shine self-start rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {enviandoCampana ? "Enviando…" : "Enviar campaña"}
              </button>
            </form>

            <div className="rounded-xl border border-edge bg-card p-5">
              <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">Resumen</p>
              {plantillaElegida ? (
                <>
                  <p className="mt-3 text-sm font-semibold text-fg">{plantillaElegida.nombre}</p>
                  <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-mist">{plantillaElegida.cuerpo}</p>
                  <div className="mt-4 flex items-center justify-between border-t border-edge pt-4">
                    <span className="text-xs text-mist">Destinatarios</span>
                    <Pill tone="info">{conteoDestinatarios}</Pill>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm text-mist">Elige una plantilla para ver el resumen.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
