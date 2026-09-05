"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Users, CalendarDays, Sparkles } from "lucide-react";
import { useAdminWeb } from "./AdminWebContext";
import { formatearHora, mismoDia } from "@/components/spa-panel/format";
import { RUTA_CLIENTES, RUTA_CITAS, RUTA_SERVICIOS } from "./admin-web-routes";

type ClienteResultado = { id: number; nombre: string; telefono: string | null };
type ServicioResultado = { id: string; nombre: string };

// Panel web AMORE (autorizado) — buscador REAL (spec Fase 11): clientes vía
// el mismo endpoint de búsqueda server-side que ya usa el módulo Clientes
// (?q=), citas próximas ya cargadas en el contexto (sin fetch nuevo) y
// servicios del catálogo ya cargado. Cada resultado navega al módulo real
// -- nunca una lista decorativa.
export function GlobalSearch() {
  const { token, datos } = useAdminWeb();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [clientes, setClientes] = useState<ClienteResultado[]>([]);
  const [servicios, setServicios] = useState<ServicioResultado[]>([]);
  const contenedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/agenda/${token}/servicios`)
      .then((r) => r.json())
      .then((body) => setServicios((body.servicios ?? []).map((s: { id: string; nombre: string }) => ({ id: s.id, nombre: s.nombre }))))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    const q = query.trim();
    const controlador = new AbortController();
    const temporizador = setTimeout(() => {
      if (q.length < 2) {
        setClientes([]);
        return;
      }
      fetch(`/api/agenda/${token}/clientes?q=${encodeURIComponent(q)}`, { signal: controlador.signal })
        .then((r) => r.json())
        .then((body) => setClientes((body.clientes ?? []).slice(0, 5)))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(temporizador);
      controlador.abort();
    };
  }, [query, token]);

  useEffect(() => {
    function alHacerClicFuera(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", alHacerClicFuera);
    return () => document.removeEventListener("mousedown", alHacerClicFuera);
  }, []);

  const q = query.trim().toLowerCase();
  const citasEncontradas = useMemo(() => {
    if (q.length < 2) return [];
    return datos.citas
      .filter(
        (c) =>
          c.nombre_cliente.toLowerCase().includes(q) ||
          c.servicio.toLowerCase().includes(q) ||
          formatearHora(c.inicio).toLowerCase().includes(q)
      )
      .slice(0, 5);
  }, [datos.citas, q]);

  const serviciosEncontrados = useMemo(() => {
    if (q.length < 2) return [];
    return servicios.filter((s) => s.nombre.toLowerCase().includes(q)).slice(0, 5);
  }, [servicios, q]);

  const hayResultados = clientes.length > 0 || citasEncontradas.length > 0 || serviciosEncontrados.length > 0;

  return (
    <div ref={contenedorRef} className="relative w-full max-w-md">
      <label className="flex items-center gap-2.5 rounded-xl border border-edge bg-ink-2 px-3.5 py-2.5">
        <Search className="size-4 shrink-0 text-mist" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAbierto(true);
          }}
          onFocus={() => setAbierto(true)}
          placeholder="Buscar cliente, cita, servicio..."
          className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-mist"
        />
      </label>

      {abierto && q.length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-96 overflow-y-auto rounded-xl border border-edge bg-card p-2 shadow-lg">
          {!hayResultados ? (
            <p className="p-3 text-center text-sm text-mist">Sin resultados para &quot;{query}&quot;.</p>
          ) : (
            <>
              {clientes.length > 0 && (
                <div className="mb-1.5">
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-mist">Clientes</p>
                  {clientes.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setAbierto(false);
                        router.push(`${RUTA_CLIENTES}/${c.id}`);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-ink-2"
                    >
                      <Users className="size-4 shrink-0 text-mist" />
                      <span className="truncate text-fg">{c.nombre}</span>
                    </button>
                  ))}
                </div>
              )}
              {citasEncontradas.length > 0 && (
                <div className="mb-1.5">
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-mist">Citas</p>
                  {citasEncontradas.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setAbierto(false);
                        router.push(RUTA_CITAS);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-ink-2"
                    >
                      <CalendarDays className="size-4 shrink-0 text-mist" />
                      <span className="truncate text-fg">
                        {formatearHora(c.inicio)} · {c.nombre_cliente} · {c.servicio}
                        {mismoDia(c.inicio, new Date()) ? "" : ` · ${new Date(c.inicio).toLocaleDateString("es-CO")}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {serviciosEncontrados.length > 0 && (
                <div>
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-mist">Servicios</p>
                  {serviciosEncontrados.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setAbierto(false);
                        router.push(RUTA_SERVICIOS);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-ink-2"
                    >
                      <Sparkles className="size-4 shrink-0 text-mist" />
                      <span className="truncate text-fg">{s.nombre}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
