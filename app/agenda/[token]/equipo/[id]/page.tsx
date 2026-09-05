"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Sparkles, Clock3, BarChart3, Pencil, Plus, Loader2 } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreCard, AmoreScreenTitle, AmoreSectionTitle, AmoreBadge, AmoreDivider } from "@/components/spa-panel/amore/ui";
import { formatearCOP } from "@/components/spa-panel/amore/amore-dashboard-mock";
import { ProfesionalModal } from "@/components/spa-panel/modals/ProfesionalModal";
import { HorarioModal, type HorarioFila } from "@/components/spa-panel/modals/HorarioModal";
import type { Profesional } from "@/app/agenda/[token]/profesionales/page";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

type Desempeno = { cantidad: number; ingresos: number; comision: { estado: "configurada"; monto: number } | { estado: "no_configurada" } };

// AMORE (Fase "sistema completo", autorizado) — detalle REAL de una
// profesional: horarios reales (dulabs_horario_especialista) y desempeño
// real (reutiliza lib/contabilidad/reporte.ts vía la misma API de
// Contabilidad, filtrado por especialistaId -- cero lógica duplicada).
export default function MiembroEquipoDetallePage() {
  return (
    <AmoreOnlyScreen>
      <Detalle />
    </AmoreOnlyScreen>
  );
}

function Detalle() {
  const { token } = useAgenda();
  const { id } = useParams<{ id: string }>();
  const especialistaId = Number(id);
  const [miembro, setMiembro] = useState<Profesional | null | undefined>(undefined);
  const [horarios, setHorarios] = useState<HorarioFila[]>([]);
  const [desempeno, setDesempeno] = useState<Desempeno | null>(null);
  const [editandoPerfil, setEditandoPerfil] = useState(false);
  const [editandoHorario, setEditandoHorario] = useState<HorarioFila | null | "nuevo">(null);

  const cargar = useCallback(() => {
    fetch(`/api/agenda/${token}/especialistas`)
      .then((r) => r.json())
      .then((body) => setMiembro((body.especialistas as Profesional[])?.find((p) => p.id === especialistaId) ?? null));
    fetch(`/api/agenda/${token}/horarios?especialistaId=${especialistaId}`)
      .then((r) => r.json())
      .then((body) => setHorarios(body.horarios ?? []))
      .catch(() => {});
    fetch(`/api/agenda/${token}/contabilidad?periodo=mes&especialistaId=${especialistaId}`)
      .then((r) => r.json())
      .then((body) => {
        const fila = (body.porProfesional ?? []).find((p: { especialistaId: number }) => p.especialistaId === especialistaId);
        setDesempeno(fila ?? { cantidad: 0, ingresos: 0, comision: { estado: "no_configurada" } });
      })
      .catch(() => {});
  }, [token, especialistaId]);

  useEffect(() => {
    if (Number.isInteger(especialistaId)) cargar();
  }, [especialistaId, cargar]);

  if (miembro === null) {
    return <p className="py-10 text-center text-sm text-mist">No se encontró a esta profesional.</p>;
  }
  if (miembro === undefined) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-mist" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href={`/agenda/${token}/equipo`} className="flex items-center gap-1.5 text-xs font-medium text-mist hover:text-fg">
        <ArrowLeft className="size-3.5" /> Volver a equipo
      </Link>

      <AmoreCard className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <AmoreScreenTitle title={miembro.nombre} />
        </div>
        <AmoreBadge tono={miembro.activo ? "success" : "neutral"}>{miembro.activo ? "Activa" : "Inactiva"}</AmoreBadge>
        <button
          type="button"
          onClick={() => setEditandoPerfil(true)}
          aria-label="Editar"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-mist active:bg-ink-2"
        >
          <Pencil className="size-4" />
        </button>
      </AmoreCard>

      <div className="grid grid-cols-1 gap-2.5">
        <div className="flex items-center gap-2 rounded-xl border border-edge bg-card p-3">
          <Sparkles className="size-4 shrink-0 text-mist" />
          <span className="truncate text-sm text-fg">{miembro.servicio || "Sin categoría asignada"}</span>
        </div>
      </div>

      <div>
        <AmoreSectionTitle
          title="Horario"
          action={
            <button type="button" onClick={() => setEditandoHorario("nuevo")} className="flex items-center gap-1 text-sm font-medium text-lime-text">
              <Plus className="size-3.5" /> Agregar
            </button>
          }
        />
        {horarios.length === 0 ? (
          <p className="mt-2.5 text-sm text-mist">Sin horario configurado todavía.</p>
        ) : (
          <AmoreCard className="mt-2.5 !p-0">
            {horarios.map((h, i) => (
              <div key={h.id}>
                <button type="button" onClick={() => setEditandoHorario(h)} className="flex w-full items-center gap-2 p-3.5 text-left">
                  <Clock3 className="size-4 shrink-0 text-mist" />
                  <span className="flex-1 text-sm text-fg">
                    {DIAS[h.dia_semana]} · {h.hora_inicio.slice(0, 5)} - {h.hora_fin.slice(0, 5)}
                  </span>
                  <AmoreBadge tono={h.activo ? "success" : "neutral"}>{h.activo ? "Activo" : "Inactivo"}</AmoreBadge>
                </button>
                {i < horarios.length - 1 && <AmoreDivider />}
              </div>
            ))}
          </AmoreCard>
        )}
      </div>

      <div>
        <AmoreSectionTitle title="Desempeño (este mes)" action={<BarChart3 className="size-4 text-mist" />} />
        <AmoreCard className="mt-2.5 !p-0">
          <div className="flex items-center justify-between p-3.5">
            <p className="text-sm text-mist">Servicios completados</p>
            <p className="text-sm font-semibold text-fg">{desempeno?.cantidad ?? 0}</p>
          </div>
          <AmoreDivider />
          <div className="flex items-center justify-between p-3.5">
            <p className="text-sm text-mist">Ingresos generados</p>
            <p className="text-sm font-semibold text-fg">{formatearCOP(desempeno?.ingresos ?? 0)}</p>
          </div>
          <AmoreDivider />
          <div className="flex items-center justify-between p-3.5">
            <p className="text-sm text-mist">Comisión</p>
            {desempeno?.comision.estado === "configurada" ? (
              <p className="text-sm font-semibold text-fg">{formatearCOP(desempeno.comision.monto)}</p>
            ) : (
              <AmoreBadge tono="neutral">Comisión no configurada</AmoreBadge>
            )}
          </div>
        </AmoreCard>
      </div>

      {editandoPerfil && (
        <ProfesionalModal
          token={token}
          profesional={miembro}
          onClose={() => setEditandoPerfil(false)}
          onGuardado={() => {
            setEditandoPerfil(false);
            cargar();
          }}
        />
      )}

      {editandoHorario && (
        <HorarioModal
          token={token}
          especialistaId={especialistaId}
          horario={editandoHorario === "nuevo" ? null : editandoHorario}
          onClose={() => setEditandoHorario(null)}
          onGuardado={() => {
            setEditandoHorario(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}
