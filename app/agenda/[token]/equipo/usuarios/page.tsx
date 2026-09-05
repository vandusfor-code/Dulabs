"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Loader2, KeyRound } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreCard, AmoreScreenTitle, AmoreAvatar, AmoreBadge, AmorePrimaryButton, AmoreEmptyState } from "@/components/spa-panel/amore/ui";
import { UsuarioModal, type Usuario } from "@/components/spa-panel/modals/UsuarioModal";
import { rutaEquipo } from "@/components/spa-panel/amore/amore-routes";

// Login AMORE (autorizado) — gestión de cuentas de login del equipo (spec
// Fase 19-21), admin-only. Vive como subpantalla de Equipo (no dentro de
// ProfesionalModal) para no tocar el CRUD de especialistas que Daniela
// también usa.
export default function UsuariosPage() {
  const { token } = useAgenda();
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [especialistas, setEspecialistas] = useState<{ id: number; nombre: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<Usuario | null | "nuevo">(null);

  const cargar = useCallback(() => {
    fetch(`/api/agenda/${token}/usuarios`)
      .then((r) => r.json())
      .then((body) => (body.error ? setError(body.error) : setUsuarios(body.usuarios)))
      .catch(() => setError("No se pudieron cargar los usuarios"));
    fetch(`/api/agenda/${token}/especialistas`)
      .then((r) => r.json())
      .then((body) => setEspecialistas((body.especialistas ?? []).map((e: { id: number; nombre: string }) => ({ id: e.id, nombre: e.nombre }))))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <AmoreOnlyScreen>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <Link href={rutaEquipo(token)} aria-label="Volver" className="flex size-9 items-center justify-center rounded-full border border-edge text-mist">
            <ArrowLeft className="size-4" />
          </Link>
          <AmoreScreenTitle
            title="Usuarios"
            subtitle="Quién puede iniciar sesión"
            action={
              <AmorePrimaryButton onClick={() => setEditando("nuevo")}>
                <Plus className="size-4" /> Nuevo
              </AmorePrimaryButton>
            }
          />
        </div>

        {error && <p className="text-sm text-danger-text">{error}</p>}

        {!usuarios ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-mist" />
          </div>
        ) : usuarios.length === 0 ? (
          <AmoreEmptyState icono={<KeyRound className="size-6 text-mist" />} mensaje="Todavía no hay usuarios creados." />
        ) : (
          <div className="flex flex-col gap-2.5">
            {usuarios.map((u) => (
              <button key={u.id} type="button" onClick={() => setEditando(u)} className="text-left">
                <AmoreCard className="flex items-center gap-3 p-3.5">
                  <AmoreAvatar nombre={u.nombre} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{u.nombre}</p>
                    <p className="truncate text-xs text-mist">
                      @{u.username} · {u.rol === "administrador" ? "Administradora" : "Colaboradora"}
                      {u.especialistaNombre ? ` · ${u.especialistaNombre}` : ""}
                    </p>
                  </div>
                  <AmoreBadge tono={u.activo ? "success" : "neutral"}>{u.activo ? "Activo" : "Desactivado"}</AmoreBadge>
                </AmoreCard>
              </button>
            ))}
          </div>
        )}

        {editando && (
          <UsuarioModal
            token={token}
            usuario={editando === "nuevo" ? null : editando}
            especialistas={especialistas}
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
