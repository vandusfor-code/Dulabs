"use client";

import { useCallback, useEffect, useState } from "react";
import { LayoutTemplate, CircleCheck, Clock, CircleAlert, Plus, FileEdit, Ban, Search, Copy, Check as CheckIcon } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill, StatTile } from "@/components/dashboard/shell/ui";

type Plantilla = {
  id: number;
  phone_number_id: string;
  nombre: string;
  categoria: string;
  idioma: string;
  cuerpo: string;
  estado: string;
  borrador: boolean;
  created_at: string;
  enviados: number;
  tasaLectura: number;
};

function contarVariables(cuerpo: string): number {
  const coincidencias = cuerpo.match(/\{\{\d+\}\}/g);
  return coincidencias ? new Set(coincidencias).size : 0;
}

const categorias = ["Todas", "MARKETING", "UTILITY", "AUTHENTICATION"] as const;

const estadoInfo: Record<string, { tone: "success" | "warning" | "danger" | "neutral"; label: string; icon: typeof CircleCheck }> = {
  APPROVED: { tone: "success", label: "Aprobada", icon: CircleCheck },
  REJECTED: { tone: "danger", label: "Rechazada", icon: CircleAlert },
  pendiente: { tone: "warning", label: "En revisión", icon: Clock },
  PENDING: { tone: "warning", label: "En revisión", icon: Clock },
  IN_APPEAL: { tone: "warning", label: "En apelación", icon: Clock },
  PAUSED: { tone: "warning", label: "Pausada por Meta", icon: Ban },
  DISABLED: { tone: "danger", label: "Deshabilitada", icon: Ban },
  PENDING_DELETION: { tone: "neutral", label: "Eliminando…", icon: Clock },
  DELETED: { tone: "neutral", label: "Eliminada", icon: CircleAlert },
  LIMIT_EXCEEDED: { tone: "danger", label: "Límite excedido", icon: CircleAlert },
  borrador: { tone: "neutral", label: "Borrador", icon: FileEdit },
};

function infoDePlantilla(p: Plantilla) {
  if (p.borrador) return estadoInfo.borrador;
  return estadoInfo[p.estado] ?? estadoInfo.pendiente;
}

export default function PlantillasPage() {
  const { session, negocios } = useDashboard();
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<(typeof categorias)[number]>("Todas");
  const [busqueda, setBusqueda] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [formAbierto, setFormAbierto] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const [phoneNumberIdElegido, setPhoneNumberIdElegido] = useState("");
  const phoneNumberId = phoneNumberIdElegido || negocios?.[0]?.phone_number_id || "";
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("UTILITY");
  const [cuerpo, setCuerpo] = useState("");
  const [creando, setCreando] = useState(false);
  const [mensajeCrear, setMensajeCrear] = useState<string | null>(null);
  const [publicandoId, setPublicandoId] = useState<number | null>(null);

  const cargarPlantillas = useCallback(() => {
    if (!session) return;
    fetch("/api/plantillas", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setPlantillas(data.plantillas ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session]);

  useEffect(() => {
    cargarPlantillas();
  }, [cargarPlantillas]);

  const crearPlantilla = useCallback(
    async (e: { preventDefault: () => void }, borrador: boolean) => {
      e.preventDefault();
      if (!session) return;
      setCreando(true);
      setMensajeCrear(null);
      try {
        const res = await fetch("/api/plantillas", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ phone_number_id: phoneNumberId, nombre, categoria, cuerpo, borrador }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error creando la plantilla");
        setMensajeCrear(borrador ? "Guardada como borrador." : `Enviada a revisión de Meta (estado: ${data.estado}).`);
        setNombre("");
        setCuerpo("");
        cargarPlantillas();
      } catch (err) {
        setMensajeCrear(err instanceof Error ? err.message : String(err));
      } finally {
        setCreando(false);
      }
    },
    [session, phoneNumberId, nombre, categoria, cuerpo, cargarPlantillas]
  );

  const publicarBorrador = useCallback(
    async (p: Plantilla) => {
      if (!session) return;
      setPublicandoId(p.id);
      try {
        const res = await fetch("/api/plantillas", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            id: p.id,
            phone_number_id: p.phone_number_id,
            nombre: p.nombre,
            categoria: p.categoria,
            cuerpo: p.cuerpo,
            idioma: p.idioma,
            borrador: false,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error enviando a revisión");
        cargarPlantillas();
      } catch (err) {
        setMensajeCrear(err instanceof Error ? err.message : String(err));
      } finally {
        setPublicandoId(null);
      }
    },
    [session, cargarPlantillas]
  );

  const filtradas = (plantillas ?? []).filter((p) => {
    if (cat !== "Todas" && p.categoria !== cat) return false;
    if (busqueda.trim() && !p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())) return false;
    return true;
  });
  const activa = filtradas.find((p) => p.id === activeId) ?? filtradas[0] ?? null;
  const variablesActiva = activa ? contarVariables(activa.cuerpo) : 0;
  const nombreNegocioActiva = negocios?.find((n) => n.phone_number_id === activa?.phone_number_id)?.nombre_negocio;

  const copiarTexto = () => {
    if (!activa) return;
    navigator.clipboard.writeText(activa.cuerpo).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    });
  };

  const todas = plantillas ?? [];
  const conteos = {
    aprobadas: todas.filter((p) => p.estado === "APPROVED").length,
    pendientes: todas.filter((p) => !p.borrador && ["pendiente", "PENDING", "IN_APPEAL"].includes(p.estado)).length,
    rechazadas: todas.filter((p) => ["REJECTED", "DISABLED", "LIMIT_EXCEEDED"].includes(p.estado)).length,
    pausadas: todas.filter((p) => p.estado === "PAUSED").length,
    borradores: todas.filter((p) => p.borrador).length,
  };

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Crear"
        title="Plantillas"
        description="Diseña, envía a revisión y administra tus plantillas de mensaje de WhatsApp."
      >
        <button
          onClick={() => setFormAbierto((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-2 text-sm font-medium text-lime-fg transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" /> Nueva plantilla
        </button>
      </PageHeader>

      <div className="px-4 pt-6 md:px-8">
        {error && (
          <p className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">{error}</p>
        )}

        {plantillas !== null && plantillas.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatTile label="Aprobadas" value={String(conteos.aprobadas)} icon={CircleCheck} />
            <StatTile label="En revisión" value={String(conteos.pendientes)} icon={Clock} />
            <StatTile label="Rechazadas" value={String(conteos.rechazadas)} icon={CircleAlert} />
            <StatTile label="Pausadas" value={String(conteos.pausadas)} icon={Ban} />
            <StatTile label="Borradores" value={String(conteos.borradores)} icon={FileEdit} />
          </div>
        )}

        {formAbierto && (
          <form
            onSubmit={(e) => crearPlantilla(e, false)}
            className="mb-6 flex flex-col gap-4 rounded-xl border border-edge bg-card p-6"
          >
            {negocios && negocios.length > 1 && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">Número</label>
                <select
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberIdElegido(e.target.value)}
                  className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                >
                  {negocios.map((n) => (
                    <option key={n.phone_number_id} value={n.phone_number_id}>
                      {n.nombre_negocio}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">Nombre</label>
                <input
                  required
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="promo_julio"
                  className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">Categoría</label>
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                >
                  <option value="UTILITY">Utilidad</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="AUTHENTICATION">Autenticación</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">Texto del mensaje</label>
              <textarea
                required
                rows={4}
                maxLength={1024}
                value={cuerpo}
                onChange={(e) => setCuerpo(e.target.value)}
                placeholder="Hola, tenemos una promoción especial este mes para ti."
                className="w-full rounded-lg border border-edge bg-ink px-4 py-3 text-sm text-fg outline-none focus:border-lime/50"
              />
            </div>
            {mensajeCrear && (
              <p className="rounded-lg border border-edge bg-ink p-3 text-xs leading-relaxed text-mist">{mensajeCrear}</p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={creando || !phoneNumberId}
                className="btn-shine rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creando ? "Enviando a Meta…" : "Enviar a revisión"}
              </button>
              <button
                type="button"
                onClick={(e) => crearPlantilla(e, true)}
                disabled={creando || !phoneNumberId}
                className="rounded-lg border border-edge px-5 py-2.5 text-sm font-semibold text-fg transition-colors hover:border-lime/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Guardar borrador
              </button>
            </div>
          </form>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 overflow-x-auto">
            {categorias.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  cat === c ? "bg-lime text-lime-fg" : "bg-card text-mist hover:text-fg"
                }`}
              >
                {c === "Todas" ? "Todas" : c === "MARKETING" ? "Marketing" : c === "UTILITY" ? "Utilidad" : "Autenticación"}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar plantillas…"
              className="w-56 rounded-lg border border-edge bg-card py-1.5 pl-9 pr-3 text-sm text-fg outline-none focus:border-lime/50"
            />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,340px)]">
          <div>
            {plantillas !== null && filtradas.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-edge bg-card p-10 text-center">
                <LayoutTemplate className="size-9 text-mist/40" strokeWidth={1.2} />
                <p className="mt-1 text-sm font-semibold text-fg">Todavía no has creado ninguna plantilla</p>
                <p className="max-w-xs text-xs leading-relaxed text-mist">
                  Créala arriba para empezar a mandar campañas masivas.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {filtradas.map((p) => {
                  const info = infoDePlantilla(p);
                  return (
                    <button
                      key={p.id}
                      onClick={() => setActiveId(p.id)}
                      className={`rounded-xl border p-4 text-left transition-colors ${
                        activa?.id === p.id ? "border-lime/40 bg-card" : "border-edge bg-card hover:border-lime/25"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex size-8 items-center justify-center rounded-lg bg-ink text-mist">
                            <LayoutTemplate className="size-4" />
                          </div>
                          <span className="font-mono text-sm font-medium text-fg">{p.nombre}</span>
                        </div>
                        <Pill tone={info.tone}>
                          <info.icon className="size-3" /> {info.label}
                        </Pill>
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-mist">{p.cuerpo}</p>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Pill tone={p.categoria === "MARKETING" ? "info" : "neutral"}>{p.categoria}</Pill>
                          <span className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{p.idioma}</span>
                        </div>
                        <span className="font-mono text-[10.5px] uppercase tracking-widest text-mist">
                          {p.enviados.toLocaleString("es-CO")} enviados
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="lg:sticky lg:top-20 lg:self-start">
            <div className="rounded-xl border border-edge bg-card p-4">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">Vista previa</p>
                {activa && (
                  <button
                    onClick={copiarTexto}
                    className="flex items-center gap-1 text-xs text-mist transition-colors hover:text-fg"
                  >
                    {copiado ? <CheckIcon className="size-3.5 text-lime-text" /> : <Copy className="size-3.5" />}
                    {copiado ? "Copiado" : "Copiar"}
                  </button>
                )}
              </div>
              <div className="mt-3 rounded-[1.75rem] border border-edge bg-ink p-2.5">
                <div className="rounded-[1.4rem] bg-[#0b3b2e] p-3">
                  <div className="mb-2 flex justify-center">
                    <span className="rounded-full bg-black/20 px-2 py-0.5 font-mono text-[9.5px] text-white/70">
                      Hoy
                    </span>
                  </div>
                  <div className="max-w-[92%] rounded-xl rounded-tl-sm bg-card p-3 shadow-sm">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-fg">
                      {activa ? activa.cuerpo : "Hola, tenemos una promoción especial este mes para ti."}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] text-mist">{nombreNegocioActiva ?? ""}</span>
                      <span className="shrink-0 text-[10px] text-mist">10:24 ✓✓</span>
                    </div>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-mist">
                {activa ? activa.nombre : "Así se verá tu próxima plantilla"}
              </p>

              {activa && (
                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-edge pt-4">
                  <div>
                    <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">Variables</p>
                    <p className="mt-1 text-lg font-semibold text-fg">{variablesActiva}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">Tasa de lectura</p>
                    <p className="mt-1 text-lg font-semibold text-fg">
                      {activa.enviados > 0 ? `${Math.round(activa.tasaLectura * 100)}%` : "—"}
                    </p>
                  </div>
                </div>
              )}

              {activa?.borrador && (
                <button
                  onClick={() => publicarBorrador(activa)}
                  disabled={publicandoId === activa.id}
                  className="btn-shine mt-4 w-full rounded-lg bg-lime px-4 py-2.5 text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {publicandoId === activa.id ? "Enviando…" : "Enviar a revisión"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
