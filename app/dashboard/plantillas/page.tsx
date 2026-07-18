"use client";

import { useCallback, useEffect, useState } from "react";
import { LayoutTemplate, CircleCheck, Clock, CircleAlert, Plus, FileEdit, Ban, Search, Copy, Check as CheckIcon } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill, StatTile } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";

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

export default function PlantillasPage() {
  const { session, negocios } = useDashboard();
  const { t } = useI18n();
  const estadoInfo: Record<string, { tone: "success" | "warning" | "danger" | "neutral"; label: string; icon: typeof CircleCheck }> = {
    APPROVED: { tone: "success", label: t("Aprobada", "Approved"), icon: CircleCheck },
    REJECTED: { tone: "danger", label: t("Rechazada", "Rejected"), icon: CircleAlert },
    pendiente: { tone: "warning", label: t("En revisión", "Under review"), icon: Clock },
    PENDING: { tone: "warning", label: t("En revisión", "Under review"), icon: Clock },
    IN_APPEAL: { tone: "warning", label: t("En apelación", "In appeal"), icon: Clock },
    PAUSED: { tone: "warning", label: t("Pausada por Meta", "Paused by Meta"), icon: Ban },
    DISABLED: { tone: "danger", label: t("Deshabilitada", "Disabled"), icon: Ban },
    PENDING_DELETION: { tone: "neutral", label: t("Eliminando…", "Deleting…"), icon: Clock },
    DELETED: { tone: "neutral", label: t("Eliminada", "Deleted"), icon: CircleAlert },
    LIMIT_EXCEEDED: { tone: "danger", label: t("Límite excedido", "Limit exceeded"), icon: CircleAlert },
    borrador: { tone: "neutral", label: t("Borrador", "Draft"), icon: FileEdit },
  };
  const infoDePlantilla = (p: Plantilla) =>
    p.borrador ? estadoInfo.borrador : estadoInfo[p.estado] ?? estadoInfo.pendiente;
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
        if (!res.ok) throw new Error(data.error ?? t("Error creando la plantilla", "Error creating the template"));
        setMensajeCrear(borrador ? t("Guardada como borrador.", "Saved as a draft.") : t(`Enviada a revisión de Meta (estado: ${data.estado}).`, `Submitted for Meta review (status: ${data.estado}).`));
        setNombre("");
        setCuerpo("");
        cargarPlantillas();
      } catch (err) {
        setMensajeCrear(err instanceof Error ? err.message : String(err));
      } finally {
        setCreando(false);
      }
    },
    [session, phoneNumberId, nombre, categoria, cuerpo, cargarPlantillas, t]
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
        if (!res.ok) throw new Error(data.error ?? t("Error enviando a revisión", "Error submitting for review"));
        cargarPlantillas();
      } catch (err) {
        setMensajeCrear(err instanceof Error ? err.message : String(err));
      } finally {
        setPublicandoId(null);
      }
    },
    [session, cargarPlantillas, t]
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
        eyebrow={t("Crear", "Create")}
        title={t("Plantillas", "Templates")}
        description={t("Diseña, envía a revisión y administra tus plantillas de mensaje de WhatsApp.", "Design, submit for review and manage your WhatsApp message templates.")}
      >
        <button
          onClick={() => setFormAbierto((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-2 text-sm font-medium text-lime-fg transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" /> {t("Nueva plantilla", "New template")}
        </button>
      </PageHeader>

      <div className="px-4 pt-6 md:px-8">
        {error && (
          <p className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">{error}</p>
        )}

        {plantillas !== null && plantillas.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatTile label={t("Aprobadas", "Approved")} value={String(conteos.aprobadas)} icon={CircleCheck} />
            <StatTile label={t("En revisión", "Under review")} value={String(conteos.pendientes)} icon={Clock} />
            <StatTile label={t("Rechazadas", "Rejected")} value={String(conteos.rechazadas)} icon={CircleAlert} />
            <StatTile label={t("Pausadas", "Paused")} value={String(conteos.pausadas)} icon={Ban} />
            <StatTile label={t("Borradores", "Drafts")} value={String(conteos.borradores)} icon={FileEdit} />
          </div>
        )}

        {formAbierto && (
          <form
            onSubmit={(e) => crearPlantilla(e, false)}
            className="mb-6 flex flex-col gap-4 rounded-xl border border-edge bg-card p-6"
          >
            {negocios && negocios.length > 1 && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">{t("Número", "Number")}</label>
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
                <label className="mb-1.5 block text-xs font-medium text-mist">{t("Nombre", "Name")}</label>
                <input
                  required
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="promo_julio"
                  className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">{t("Categoría", "Category")}</label>
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  className="w-full rounded-lg border border-edge bg-ink px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                >
                  <option value="UTILITY">{t("Utilidad", "Utility")}</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="AUTHENTICATION">{t("Autenticación", "Authentication")}</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">{t("Texto del mensaje", "Message text")}</label>
              <textarea
                required
                rows={4}
                maxLength={1024}
                value={cuerpo}
                onChange={(e) => setCuerpo(e.target.value)}
                placeholder={t("Hola, tenemos una promoción especial este mes para ti.", "Hi, we have a special promotion for you this month.")}
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
                {creando ? t("Enviando a Meta…", "Sending to Meta…") : t("Enviar a revisión", "Submit for review")}
              </button>
              <button
                type="button"
                onClick={(e) => crearPlantilla(e, true)}
                disabled={creando || !phoneNumberId}
                className="rounded-lg border border-edge px-5 py-2.5 text-sm font-semibold text-fg transition-colors hover:border-lime/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("Guardar borrador", "Save draft")}
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
                {c === "Todas" ? t("Todas", "All") : c === "MARKETING" ? "Marketing" : c === "UTILITY" ? t("Utilidad", "Utility") : t("Autenticación", "Authentication")}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={t("Buscar plantillas…", "Search templates…")}
              className="w-56 rounded-lg border border-edge bg-card py-1.5 pl-9 pr-3 text-sm text-fg outline-none focus:border-lime/50"
            />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,340px)]">
          <div>
            {plantillas !== null && filtradas.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-edge bg-card p-10 text-center">
                <LayoutTemplate className="size-9 text-mist/40" strokeWidth={1.2} />
                <p className="mt-1 text-sm font-semibold text-fg">{t("Todavía no has creado ninguna plantilla", "You haven't created any template yet")}</p>
                <p className="max-w-xs text-xs leading-relaxed text-mist">
                  {t("Créala arriba para empezar a mandar campañas masivas.", "Create one above to start sending bulk campaigns.")}
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
                          {p.enviados.toLocaleString("es-CO")} {t("enviados", "sent")}
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
                <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Vista previa", "Preview")}</p>
                {activa && (
                  <button
                    onClick={copiarTexto}
                    className="flex items-center gap-1 text-xs text-mist transition-colors hover:text-fg"
                  >
                    {copiado ? <CheckIcon className="size-3.5 text-lime-text" /> : <Copy className="size-3.5" />}
                    {copiado ? t("Copiado", "Copied") : t("Copiar", "Copy")}
                  </button>
                )}
              </div>
              <div className="mt-3 rounded-[1.75rem] border border-edge bg-ink p-2.5">
                <div className="rounded-[1.4rem] bg-[#0b3b2e] p-3">
                  <div className="mb-2 flex justify-center">
                    <span className="rounded-full bg-black/20 px-2 py-0.5 font-mono text-[9.5px] text-white/70">
                      {t("Hoy", "Today")}
                    </span>
                  </div>
                  <div className="max-w-[92%] rounded-xl rounded-tl-sm bg-card p-3 shadow-sm">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-fg">
                      {activa ? activa.cuerpo : t("Hola, tenemos una promoción especial este mes para ti.", "Hi, we have a special promotion for you this month.")}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] text-mist">{nombreNegocioActiva ?? ""}</span>
                      <span className="shrink-0 text-[10px] text-mist">10:24 ✓✓</span>
                    </div>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-mist">
                {activa ? activa.nombre : t("Así se verá tu próxima plantilla", "This is how your next template will look")}
              </p>

              {activa && (
                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-edge pt-4">
                  <div>
                    <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Variables", "Variables")}</p>
                    <p className="mt-1 text-lg font-semibold text-fg">{variablesActiva}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Tasa de lectura", "Read rate")}</p>
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
                  {publicandoId === activa.id ? t("Enviando…", "Sending…") : t("Enviar a revisión", "Submit for review")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
