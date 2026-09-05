"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Sparkles, Clock3, Pencil, Plus, Loader2 } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { AdminOnlyDesktop } from "@/components/admin-web/AdminOnlyDesktop";
import { formatearCOP } from "@/components/spa-panel/amore/amore-dashboard-mock";
import { ProfesionalModal } from "@/components/spa-panel/modals/ProfesionalModal";
import { HorarioModal, type HorarioFila } from "@/components/spa-panel/modals/HorarioModal";
import type { Profesional } from "@/app/agenda/[token]/profesionales/page";
import { RUTA_EQUIPO } from "@/components/admin-web/admin-web-routes";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
type Desempeno = { cantidad: number; ingresos: number; comision: { estado: "configurada"; monto: number } | { estado: "no_configurada" } };

// Panel web AMORE (autorizado) — detalle de trabajadora desktop: MISMAS
// APIs reales que ya usa el móvil (horarios reales + desempeño real vía
// Contabilidad). Admin-only.
export default function AdminAmoreEquipoDetallePage() {
  return (
    <AdminOnlyDesktop>
      <Detalle />
    </AdminOnlyDesktop>
  );
}

function Detalle() {
  const { token } = useAdminWeb();
  const router = useRouter();
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

  if (miembro === null) return <p className="py-10 text-center text-sm text-mist">No se encontró a esta profesional.</p>;
  if (miembro === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-mist" />
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <button
        type="button"
        onClick={() => router.push(RUTA_EQUIPO)}
        className="flex w-fit items-center gap-1.5 text-sm font-medium text-mist hover:text-fg"
      >
        <ArrowLeft className="size-4" /> Volver a equipo
      </button>

      <div className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-5 shadow-sm">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-fg">{miembro.nombre}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-mist">
            <Sparkles className="size-3.5" /> {miembro.servicio || "Sin categoría asignada"}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            miembro.activo ? "bg-success text-success-text" : "bg-ink-2 text-mist"
          }`}
        >
          {miembro.activo ? "Activa" : "Inactiva"}
        </span>
        <button
          type="button"
          onClick={() => setEditandoPerfil(true)}
          aria-label="Editar"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-mist hover:bg-ink-2 hover:text-fg"
        >
          <Pencil className="size-4" />
        </button>
      </div>

      <div className="rounded-2xl border border-edge bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-fg">Horario</h2>
          <button
            type="button"
            onClick={() => setEditandoHorario("nuevo")}
            className="flex items-center gap-1 text-sm font-medium text-lime-text hover:underline"
          >
            <Plus className="size-3.5" /> Agregar
          </button>
        </div>
        {horarios.length === 0 ? (
          <p className="mt-3 text-sm text-mist">Sin horario configurado todavía.</p>
        ) : (
          <div className="mt-3 flex flex-col divide-y divide-edge">
            {horarios.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => setEditandoHorario(h)}
                className="flex items-center gap-2.5 py-2.5 text-left"
              >
                <Clock3 className="size-4 shrink-0 text-mist" />
                <span className="flex-1 text-sm text-fg">
                  {DIAS[h.dia_semana]} · {h.hora_inicio.slice(0, 5)} - {h.hora_fin.slice(0, 5)}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    h.activo ? "bg-success text-success-text" : "bg-ink-2 text-mist"
                  }`}
                >
                  {h.activo ? "Activo" : "Inactivo"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-edge bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-fg">Desempeño (este mes)</h2>
        <div className="mt-3 flex flex-col divide-y divide-edge">
          <div className="flex items-center justify-between py-2.5">
            <p className="text-sm text-mist">Servicios completados</p>
            <p className="text-sm font-semibold text-fg">{desempeno?.cantidad ?? 0}</p>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <p className="text-sm text-mist">Ingresos generados</p>
            <p className="text-sm font-semibold text-fg">{formatearCOP(desempeno?.ingresos ?? 0)}</p>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <p className="text-sm text-mist">Comisión</p>
            {desempeno?.comision.estado === "configurada" ? (
              <p className="text-sm font-semibold text-fg">{formatearCOP(desempeno.comision.monto)}</p>
            ) : (
              <span className="rounded-full bg-ink-2 px-2.5 py-1 text-[11px] font-medium text-mist">No configurada</span>
            )}
          </div>
        </div>
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
