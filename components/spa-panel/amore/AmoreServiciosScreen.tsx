"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Search, Plus, Pencil, Sparkles } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { ServicioModal } from "@/components/spa-panel/modals/ServicioModal";
import { AmoreScreenTitle, AmoreCard, AmoreSearchInput, AmoreBadge, AmorePrimaryButton, AmoreEmptyState } from "./ui";
import type { Servicio } from "@/app/agenda/[token]/servicios/page";
import type { Profesional } from "@/app/agenda/[token]/profesionales/page";

// AMORE (Fase "sistema completo", autorizado) — catálogo REAL de AMORE.
// "+ Nuevo" y "Editar" ahora abren ServicioModal (el mismo CRUD real que ya
// usa Daniela, ver components/spa-panel/modals/ServicioModal.tsx) -- se
// reskinea solo por estar dentro de .amore-scope, cero componente nuevo.
export function AmoreServiciosScreen() {
  const { token } = useAgenda();
  const [servicios, setServicios] = useState<Servicio[] | null>(null);
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [editando, setEditando] = useState<Servicio | null | "nuevo">(null);

  const cargarServicios = useCallback(() => {
    fetch(`/api/agenda/${token}/servicios`)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else setServicios(body.servicios);
      })
      .catch(() => setError("No se pudieron cargar los servicios"));
  }, [token]);

  useEffect(() => {
    cargarServicios();
    fetch(`/api/agenda/${token}/especialistas`)
      .then((r) => r.json())
      .then((body) => setProfesionales(body.especialistas ?? []))
      .catch(() => {});
  }, [token, cargarServicios]);

  const categorias = useMemo(
    () => Array.from(new Set((servicios ?? []).map((s) => s.categoria).filter((c): c is string => Boolean(c)))),
    [servicios]
  );

  const filtrados = useMemo(() => {
    if (!servicios) return null;
    const texto = busqueda.trim().toLowerCase();
    return servicios.filter((s) => {
      if (categoria && s.categoria !== categoria) return false;
      if (texto && !s.nombre.toLowerCase().includes(texto)) return false;
      return true;
    });
  }, [servicios, busqueda, categoria]);

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle
        title="Servicios"
        subtitle="Catálogo real que verán tus clientas al reservar"
        action={
          <AmorePrimaryButton onClick={() => setEditando("nuevo")}>
            <Plus className="size-4" /> Nuevo
          </AmorePrimaryButton>
        }
      />

      {servicios && servicios.length > 0 && (
        <AmoreSearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar servicio..." icon={<Search className="size-4 shrink-0 text-mist" />} />
      )}

      {categorias.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setCategoria(null)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium ${
              categoria === null ? "border-lime/40 bg-lime-soft text-lime-text" : "border-edge bg-card text-mist"
            }`}
          >
            Todas
          </button>
          {categorias.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategoria(c)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium ${
                categoria === c ? "border-lime/40 bg-lime-soft text-lime-text" : "border-edge bg-card text-mist"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {!servicios && !error ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : filtrados && filtrados.length === 0 ? (
        <AmoreEmptyState icono={<Sparkles className="size-6 text-mist" />} mensaje="Ningún servicio coincide con la búsqueda." />
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtrados?.map((s) => (
            <AmoreCard key={s.id} className="flex items-center gap-3 p-3.5">
              <Link href={`/agenda/${token}/servicios/${s.id}`} className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{s.nombre}</p>
                <p className="truncate text-xs text-mist">
                  {s.duracion_min} min{s.precio != null ? ` · ${formatearPrecioCop(s.precio)}` : ""}
                </p>
              </Link>
              <AmoreBadge tono={s.activo ? "success" : "neutral"}>{s.activo ? "Activo" : "Inactivo"}</AmoreBadge>
              <button
                type="button"
                onClick={() => setEditando(s)}
                aria-label="Editar"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-mist active:bg-ink-2"
              >
                <Pencil className="size-4" />
              </button>
            </AmoreCard>
          ))}
        </div>
      )}

      {editando && (
        <ServicioModal
          token={token}
          servicio={editando === "nuevo" ? null : editando}
          profesionales={profesionales}
          onClose={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            cargarServicios();
          }}
        />
      )}
    </div>
  );
}
