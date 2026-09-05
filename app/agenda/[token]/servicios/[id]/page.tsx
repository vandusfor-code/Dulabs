"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Clock3, Wallet, Users } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreCard, AmoreScreenTitle, AmoreBadge, AmoreSectionTitle } from "@/components/spa-panel/amore/ui";
import type { Servicio } from "@/app/agenda/[token]/servicios/page";
import type { Profesional } from "@/app/agenda/[token]/profesionales/page";

// AMORE (Fase 5, diseño visual completo, autorizado) — detalle de solo
// lectura de un servicio REAL del catálogo (misma API ya existente); editar
// de verdad (ServicioModal) es lógica funcional, fuera de esta fase.
export default function ServicioDetallePage() {
  return (
    <AmoreOnlyScreen>
      <Detalle />
    </AmoreOnlyScreen>
  );
}

function Detalle() {
  const { token } = useAgenda();
  const { id } = useParams<{ id: string }>();
  const [servicio, setServicio] = useState<Servicio | null | undefined>(undefined);
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);

  useEffect(() => {
    fetch(`/api/agenda/${token}/servicios`)
      .then((r) => r.json())
      .then((body) => setServicio((body.servicios as Servicio[])?.find((s) => s.id === id) ?? null));
    fetch(`/api/agenda/${token}/especialistas`)
      .then((r) => r.json())
      .then((body) => setProfesionales(body.especialistas ?? []))
      .catch(() => {});
  }, [token, id]);

  return (
    <div className="flex flex-col gap-5">
      <Link href={`/agenda/${token}/servicios`} className="flex items-center gap-1.5 text-xs font-medium text-mist hover:text-fg">
        <ArrowLeft className="size-3.5" /> Volver a servicios
      </Link>

      {servicio === undefined ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : servicio === null ? (
        <p className="py-10 text-center text-sm text-mist">No se encontró este servicio.</p>
      ) : (
        <>
          <AmoreCard>
            <AmoreScreenTitle title={servicio.nombre} action={<AmoreBadge tono={servicio.activo ? "success" : "neutral"}>{servicio.activo ? "Activo" : "Inactivo"}</AmoreBadge>} />
          </AmoreCard>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="flex items-center gap-2 rounded-xl border border-edge bg-card p-3">
              <Clock3 className="size-4 shrink-0 text-mist" />
              <span className="truncate text-sm text-fg">{servicio.duracion_min} min</span>
            </div>
            {servicio.precio != null && (
              <div className="flex items-center gap-2 rounded-xl border border-edge bg-card p-3">
                <Wallet className="size-4 shrink-0 text-mist" />
                <span className="truncate text-sm text-fg">{formatearPrecioCop(servicio.precio)}</span>
              </div>
            )}
          </div>

          <div>
            <AmoreSectionTitle title="Profesionales" action={<Users className="size-4 text-mist" />} />
            <div className="mt-2.5 flex flex-col gap-2.5">
              {servicio.especialistaIds.length === 0 ? (
                <p className="text-sm text-mist">Ningún profesional asociado todavía.</p>
              ) : (
                profesionales
                  .filter((p) => servicio.especialistaIds.includes(p.id))
                  .map((p) => (
                    <AmoreCard key={p.id} className="p-3.5">
                      <p className="text-sm font-medium text-fg">{p.nombre}</p>
                    </AmoreCard>
                  ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
