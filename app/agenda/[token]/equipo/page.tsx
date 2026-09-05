"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus, Loader2, KeyRound } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreCard, AmoreScreenTitle, AmoreAvatar, AmoreBadge, AmorePrimaryButton, AmoreEmptyState, AmoreChevronRow } from "@/components/spa-panel/amore/ui";
import { ProfesionalModal } from "@/components/spa-panel/modals/ProfesionalModal";
import type { Profesional } from "@/app/agenda/[token]/profesionales/page";
import type { Servicio } from "@/app/agenda/[token]/servicios/page";

// AMORE (Fase "sistema completo", autorizado) — equipo REAL: mismas APIs de
// especialistas/servicios ya existentes (dulabs_especialistas,
// dulabs_servicio_especialista). "Estado" ahora es activo/inactivo real (no
// "disponible/ocupada/descanso", que no existe como dato en ningún lado).
// "+ Nueva" abre ProfesionalModal, el mismo CRUD real que ya usa Daniela.
export default function EquipoPage() {
  const { token } = useAgenda();
  const router = useRouter();
  const [especialistas, setEspecialistas] = useState<Profesional[] | null>(null);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<Profesional | null | "nuevo">(null);

  const cargar = useCallback(() => {
    fetch(`/api/agenda/${token}/especialistas`)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else setEspecialistas(body.especialistas);
      })
      .catch(() => setError("No se pudo cargar el equipo"));
    fetch(`/api/agenda/${token}/servicios`)
      .then((r) => r.json())
      .then((body) => setServicios(body.servicios ?? []))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function serviciosDe(especialistaId: number): number {
    return servicios.filter((s) => s.especialistaIds.includes(especialistaId)).length;
  }

  return (
    <AmoreOnlyScreen>
      <div className="flex flex-col gap-5">
        <AmoreScreenTitle
          title="Equipo"
          subtitle="Las profesionales de AMORE"
          action={
            <AmorePrimaryButton onClick={() => setEditando("nuevo")}>
              <Plus className="size-4" /> Nueva
            </AmorePrimaryButton>
          }
        />

        <AmoreChevronRow
          icono={<KeyRound className="size-4" />}
          titulo="Usuarios"
          descripcion="Quién puede iniciar sesión en el panel"
          onClick={() => router.push(`/agenda/${token}/equipo/usuarios`)}
        />

        {error && <p className="text-sm text-danger-text">{error}</p>}

        {!especialistas ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-mist" />
          </div>
        ) : especialistas.length === 0 ? (
          <AmoreEmptyState icono={<Plus className="size-6 text-mist" />} mensaje="Todavía no hay profesionales registradas." />
        ) : (
          <div className="flex flex-col gap-2.5">
            {especialistas.map((m) => (
              <Link key={m.id} href={`/agenda/${token}/equipo/${m.id}`}>
                <AmoreCard className="flex items-center gap-3 p-3.5">
                  <AmoreAvatar nombre={m.nombre} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{m.nombre}</p>
                    <p className="truncate text-xs text-mist">
                      {serviciosDe(m.id)} {serviciosDe(m.id) === 1 ? "servicio asignado" : "servicios asignados"}
                    </p>
                  </div>
                  <AmoreBadge tono={m.activo ? "success" : "neutral"}>{m.activo ? "Activa" : "Inactiva"}</AmoreBadge>
                  <ChevronRight className="size-4 shrink-0 text-mist" />
                </AmoreCard>
              </Link>
            ))}
          </div>
        )}

        {editando && (
          <ProfesionalModal
            token={token}
            profesional={editando === "nuevo" ? null : editando}
            onClose={() => setEditando(null)}
            onGuardado={() => {
              setEditando(null);
              cargar();
            }}
          />
        )}
      </div>
    </AmoreOnlyScreen>
  );
}
