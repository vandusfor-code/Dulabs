"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Search, Plus, Pencil, Sparkles } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { AmoreScreenTitle, AmoreCard, AmoreSearchInput, AmoreBadge, AmorePrimaryButton, AmoreEmptyState } from "./ui";
import { useAmoreUi } from "./AmoreUiContext";
import type { Servicio } from "@/app/agenda/[token]/servicios/page";

// AMORE (Fase 5, diseño visual completo, autorizado) — catálogo REAL de
// AMORE (misma API de solo lectura ya existente, GET /api/agenda/[token]/
// servicios), presentado con el design system móvil. "+ Nuevo servicio" y
// "Editar" son solo visuales -- el CRUD (ServicioModal) es lógica funcional,
// fuera de esta fase.
export function AmoreServiciosScreen() {
  const { token } = useAgenda();
  const { avisarProximamente } = useAmoreUi();
  const [servicios, setServicios] = useState<Servicio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/agenda/${token}/servicios`)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else setServicios(body.servicios);
      })
      .catch(() => setError("No se pudieron cargar los servicios"));
  }, [token]);

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
          <AmorePrimaryButton onClick={avisarProximamente}>
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
                onClick={avisarProximamente}
                aria-label="Editar"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-mist active:bg-ink-2"
              >
                <Pencil className="size-4" />
              </button>
            </AmoreCard>
          ))}
        </div>
      )}
    </div>
  );
}
