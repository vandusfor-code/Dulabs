"use client";

import { useState } from "react";
import { Button, Field, inputClass, Modal } from "../ui";

export type Usuario = {
  id: number;
  nombre: string;
  username: string;
  rol: "administrador" | "colaboradora";
  especialistaId: number | null;
  especialistaNombre: string | null;
  activo: boolean;
};

// Login AMORE (autorizado) — crear/editar una cuenta de login (spec Fase
// 20-21). Mismo kit genérico (Modal/Field/inputClass/Button) que ya usan
// ServicioModal/ProfesionalModal -- se reskinea solo bajo `.amore-scope`,
// cero componentes nuevos de diseño. El username NUNCA se puede editar acá
// (identidad estable de la cuenta); la contraseña solo se toca si se marca
// "restablecer".
export function UsuarioModal({
  token,
  usuario,
  especialistas,
  onClose,
  onGuardado,
}: {
  token: string;
  usuario: Usuario | null;
  especialistas: { id: number; nombre: string }[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(usuario?.nombre ?? "");
  const [username, setUsername] = useState(usuario?.username ?? "");
  const [password, setPassword] = useState("");
  const [restablecer, setRestablecer] = useState(false);
  const [rol, setRol] = useState<"administrador" | "colaboradora">(usuario?.rol ?? "colaboradora");
  const [especialistaId, setEspecialistaId] = useState<string>(usuario?.especialistaId ? String(usuario.especialistaId) : "");
  const [activo, setActivo] = useState(usuario?.activo ?? true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mostrarCampoPassword = !usuario || restablecer;

  const guardar = async () => {
    if (!nombre.trim()) return setError("El nombre es obligatorio");
    if (!usuario && !username.trim()) return setError("El usuario es obligatorio");
    if (rol === "colaboradora" && !especialistaId) return setError("Selecciona la especialista vinculada");
    if (mostrarCampoPassword && password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres");

    setGuardando(true);
    setError(null);
    try {
      const url = usuario ? `/api/agenda/${token}/usuarios/${usuario.id}` : `/api/agenda/${token}/usuarios`;
      const cuerpo: Record<string, unknown> = {
        nombre: nombre.trim(),
        rol,
        especialistaId: especialistaId ? Number(especialistaId) : null,
        activo,
      };
      if (!usuario) cuerpo.username = username.trim();
      if (mostrarCampoPassword) cuerpo.password = password;

      const res = await fetch(url, {
        method: usuario ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "No se pudo guardar");
      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error guardando");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 className="text-base font-semibold text-fg">{usuario ? "Editar usuario" : "Nuevo usuario"}</h2>

      <div className="mt-4 flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-0.5">
        <Field label="Nombre">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Mary" className={inputClass} />
        </Field>

        <Field label="Usuario" hint={usuario ? "El usuario no se puede cambiar." : "Con esto inicia sesión."}>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={!!usuario}
            placeholder="Ej. Mary"
            className={inputClass}
          />
        </Field>

        <Field label="Rol">
          <select value={rol} onChange={(e) => setRol(e.target.value as "administrador" | "colaboradora")} className={inputClass}>
            <option value="colaboradora">Colaboradora</option>
            <option value="administrador">Administradora</option>
          </select>
        </Field>

        <Field label="Especialista vinculada" hint={rol === "colaboradora" ? "Obligatoria para colaboradora." : "Opcional para administradora."}>
          <select value={especialistaId} onChange={(e) => setEspecialistaId(e.target.value)} className={inputClass}>
            <option value="">— Ninguna —</option>
            {especialistas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        </Field>

        {usuario && !restablecer && (
          <button type="button" onClick={() => setRestablecer(true)} className="text-left text-sm font-medium text-lime-text underline-offset-2 hover:underline">
            Restablecer contraseña
          </button>
        )}

        {mostrarCampoPassword && (
          <Field label={usuario ? "Nueva contraseña" : "Contraseña inicial"} hint="Mínimo 8 caracteres.">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </Field>
        )}

        <label className="flex items-center gap-2.5 text-sm text-fg">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="size-4 accent-lime" />
          Activo (puede iniciar sesión)
        </label>

        {error && <p className="text-xs text-danger-text">{error}</p>}
      </div>

      <div className="mt-4 flex gap-2.5">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          Cancelar
        </Button>
        <Button onClick={guardar} loading={guardando} className="flex-1">
          Guardar
        </Button>
      </div>
    </Modal>
  );
}
