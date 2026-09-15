"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Loader2, KeyRound } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { AdminOnlyDesktop } from "@/components/admin-web/AdminOnlyDesktop";
import { inicialesDe } from "@/components/spa-panel/format";
import { UsuarioModal, type Usuario } from "@/components/spa-panel/modals/UsuarioModal";
import { RUTA_EQUIPO } from "@/components/admin-web/admin-web-routes";

// Panel web AMORE (autorizado) — Usuarios desktop: MISMAS APIs y MISMO
// UsuarioModal reales que ya usa el móvil. Admin-only.
export default function AdminAmoreUsuariosPage() {
  return (
    <AdminOnlyDesktop>
      <UsuariosContenido />
    </AdminOnlyDesktop>
  );
}

function UsuariosContenido() {
  const { token } = useAdminWeb();
  const router = useRouter();
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

  useEffect(() => cargar(), [cargar]);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <button
        type="button"
        onClick={() => router.push(RUTA_EQUIPO)}
        className="flex w-fit items-center gap-1.5 text-sm font-medium text-mist hover:text-fg"
      >
        <ArrowLeft className="size-4" /> Volver a equipo
      </button>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">Usuarios</h1>
          <p className="text-sm text-mist">Quién puede iniciar sesión en el panel</p>
        </div>
        <button
          type="button"
          onClick={() => setEditando("nuevo")}
          className="flex items-center gap-1.5 rounded-xl bg-lime px-4 py-2.5 text-sm font-medium text-lime-fg hover:bg-lime-hover"
        >
          <Plus className="size-4" /> Nuevo
        </button>
      </div>

      {error && <p className="text-sm text-danger-text">{error}</p>}

      <div className="rounded-2xl border border-edge bg-card shadow-sm">
        {!usuarios ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-5 animate-spin text-mist" />
          </div>
        ) : usuarios.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <KeyRound className="size-6 text-mist" />
            <p className="mt-2 text-sm text-mist">Todavía no hay usuarios creados.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-mist">
                <th className="px-5 py-3 font-medium">Nombre</th>
                <th className="px-5 py-3 font-medium">Usuario</th>
                <th className="px-5 py-3 font-medium">Rol</th>
                <th className="px-5 py-3 font-medium">Especialista</th>
                <th className="px-5 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {usuarios.map((u) => (
                <tr key={u.id} onClick={() => setEditando(u)} className="cursor-pointer hover:bg-ink-2">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-lime-soft text-[11px] font-semibold text-lime-text">
                        {inicialesDe(u.nombre)}
                      </div>
                      <span className="font-medium text-fg">{u.nombre}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-fg">@{u.username}</td>
                  <td className="px-5 py-3 text-fg">{u.rol === "administrador" ? "Administradora" : "Colaboradora"}</td>
                  <td className="px-5 py-3 text-fg">{u.especialistaNombre ?? "—"}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                        u.activo ? "bg-success text-success-text" : "bg-ink-2 text-mist"
                      }`}
                    >
                      {u.activo ? "Activo" : "Desactivado"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
  );
}
