"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { SurveyStatus, SurveySummary } from "@/lib/surveys";

function cn(...cls: Array<string | false | undefined>) {
  return cls.filter(Boolean).join(" ");
}

const GRID = "grid-cols-[minmax(190px,1.6fr)_110px_72px_84px_100px_170px_minmax(96px,1fr)_40px]";

function StatusBadge({ status }: { status: SurveyStatus }) {
  const { t } = useI18n();
  const map: Record<SurveyStatus, { label: string; className: string; dot?: boolean }> = {
    active: { label: t("Activa", "Active"), className: "bg-lime/12 text-lime-text", dot: true },
    completed: { label: t("Completada", "Completed"), className: "bg-lime/8 text-lime-text/85" },
    draft: { label: t("Borrador", "Draft"), className: "bg-ink text-mist" },
    paused: { label: t("Pausada", "Paused"), className: "bg-amber-400/15 text-amber-400", dot: true },
    archived: { label: t("Archivada", "Archived"), className: "bg-ink text-mist" },
  };
  const s = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", s.className)}>
      {s.dot && <span className="size-1.5 rounded-full bg-current" />}
      {s.label}
    </span>
  );
}

function CompletionCell({ rate }: { rate: number }) {
  const { t } = useI18n();
  return (
    <div className="pr-4">
      <span className="text-sm tabular-nums text-fg">
        {rate.toLocaleString(t("es-CO", "en-US"), { minimumFractionDigits: rate % 1 === 0 ? 0 : 1, maximumFractionDigits: 1 })}%
      </span>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink">
        <div className="h-full rounded-full bg-lime" style={{ width: `${rate}%` }} />
      </div>
    </div>
  );
}

export function SurveysTable({
  surveys,
  onRowClick,
  accessToken,
  onDeleted,
}: {
  surveys: SurveySummary[];
  onRowClick?: (survey: SurveySummary) => void;
  /** Necesario para poder borrar encuestas desde el menú de la fila. */
  accessToken?: string;
  /** Se llama tras un borrado exitoso, para que el llamador recargue el tablero. */
  onDeleted?: () => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | SurveyStatus>("all");

  // Filtro por antigüedad. Antes era un div decorativo que decía "Últimos 30
  // días" sin onClick ni efecto: la tabla siempre mostraba todo. El corte se
  // calcula al cambiar el select (no durante el render) para no leer el reloj
  // en medio de un render, que hace impuro el resultado.
  const [rango, setRango] = useState<7 | 30 | 90 | 0>(0); // 0 = sin límite
  const [desde, setDesde] = useState<number | null>(null);
  const POR_PAGINA = 10;
  const [pagina, setPagina] = useState(1);

  const cambiarRango = useCallback((dias: 7 | 30 | 90 | 0) => {
    setRango(dias);
    setDesde(dias === 0 ? null : Date.now() - dias * 24 * 60 * 60 * 1000);
    setPagina(1);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return surveys.filter((s) => {
      if (status !== "all" && s.status !== status) return false;
      if (q !== "" && !s.name.toLowerCase().includes(q)) return false;
      if (desde !== null) {
        // Sin fecha real (encuestas de demo) no se filtra por antigüedad:
        // mejor mostrarla que esconderla por un dato que no tenemos.
        if (!s.updatedAtISO) return true;
        const fecha = new Date(s.updatedAtISO).getTime();
        if (Number.isFinite(fecha) && fecha < desde) return false;
      }
      return true;
    });
  }, [surveys, search, status, desde]);

  // Paginación real. Los botones estaban `disabled` a la fuerza y el
  // indicador siempre decía "1", sin importar cuántas encuestas hubiera.
  const totalPaginas = Math.max(1, Math.ceil(filtered.length / POR_PAGINA));
  // La página se acota durante el render en vez de corregirse con un efecto:
  // si un filtro deja menos páginas que la actual, se muestra la última en
  // lugar de una página vacía.
  const paginaActual = Math.min(pagina, totalPaginas);
  const paginadas = useMemo(
    () => filtered.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA),
    [filtered, paginaActual]
  );
  const desdeVisible = filtered.length === 0 ? 0 : (paginaActual - 1) * POR_PAGINA + 1;
  const hastaVisible = Math.min(paginaActual * POR_PAGINA, filtered.length);

  // Menú "..." de cada fila: se saca por portal a document.body y se
  // posiciona en coordenadas de pantalla (fixed) calculadas del botón que lo
  // abre. Necesario porque la tabla vive dentro de un contenedor
  // `overflow-x-auto` — al fijar overflow-x, el navegador fuerza también
  // overflow-y a "auto" en ese contenedor (regla del spec de CSS), así que
  // un menú `absolute` ahí adentro queda recortado con su propio scroll en
  // vez de flotar libre. Solo uno abierto a la vez, por eso un único ref
  // basta para detectar clics afuera y cerrarlo.
  const MENU_ANCHO = 256; // w-64
  const MENU_ALTO_ESTIMADO = 170; // suficiente para el estado de confirmación
  const [menuAbiertoId, setMenuAbiertoId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const cerrarMenu = useCallback(() => {
    setMenuAbiertoId(null);
    setMenuPos(null);
    setConfirmandoId(null);
    setErrorEliminar(null);
  }, []);

  const abrirMenu = useCallback((id: string, boton: HTMLButtonElement) => {
    const rect = boton.getBoundingClientRect();
    const espacioAbajo = window.innerHeight - rect.bottom;
    const arriba = espacioAbajo < MENU_ALTO_ESTIMADO && rect.top > MENU_ALTO_ESTIMADO;
    const left = Math.min(Math.max(8, rect.right - MENU_ANCHO), window.innerWidth - MENU_ANCHO - 8);
    const top = arriba ? rect.top - MENU_ALTO_ESTIMADO - 4 : rect.bottom + 4;
    setMenuPos({ top, left });
    setMenuAbiertoId(id);
    setConfirmandoId(null);
    setErrorEliminar(null);
  }, []);

  useEffect(() => {
    if (!menuAbiertoId) return;
    const onClickFuera = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) cerrarMenu();
    };
    // Cierra al hacer scroll (de la página o del contenedor con scroll
    // horizontal) en vez de reposicionar — más simple y evita que el menú
    // quede desalineado del botón que lo abrió.
    const onScroll = () => cerrarMenu();
    document.addEventListener("mousedown", onClickFuera);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onClickFuera);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [menuAbiertoId, cerrarMenu]);

  const eliminarEncuesta = useCallback(
    async (phoneNumberId: string) => {
      if (!accessToken) return;
      setEliminandoId(phoneNumberId);
      setErrorEliminar(null);
      try {
        const res = await fetch(`/api/dashboard/surveys/${phoneNumberId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error ?? t("No se pudo eliminar la encuesta.", "Couldn't delete the survey."));
        }
        cerrarMenu();
        onDeleted?.();
      } catch (err) {
        setErrorEliminar(err instanceof Error ? err.message : String(err));
      } finally {
        setEliminandoId(null);
      }
    },
    [accessToken, onDeleted, t, cerrarMenu]
  );

  const columns = [
    t("Encuesta", "Survey"),
    t("Estado", "Status"),
    t("Enviadas", "Sent"),
    t("Iniciadas", "Started"),
    t("Completadas", "Completed"),
    t("Tasa de finalización", "Completion rate"),
    t("Actualizada", "Updated"),
    "",
  ];

  const surveyEnMenu = surveys.find((s) => s.id === menuAbiertoId) ?? null;

  return (
    <>
    <div className="rounded-xl border border-edge bg-card">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-base font-semibold text-fg">{t("Todas las encuestas", "All surveys")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Buscar encuestas…", "Search surveys…")}
              aria-label={t("Buscar encuestas", "Search surveys")}
              className="w-full rounded-lg border border-edge bg-ink py-2 pl-9 pr-3 text-sm text-fg outline-none placeholder:text-mist focus:border-lime/50 sm:w-64"
            />
          </div>
          <div className="relative">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "all" | SurveyStatus)}
              aria-label={t("Filtrar por estado", "Filter by status")}
              className="appearance-none rounded-lg border border-edge bg-ink py-2 pl-3 pr-8 text-sm text-fg outline-none focus:border-lime/50"
            >
              <option value="all">{t("Todos los estados", "All status")}</option>
              <option value="active">{t("Activa", "Active")}</option>
              <option value="completed">{t("Completada", "Completed")}</option>
              <option value="draft">{t("Borrador", "Draft")}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-mist" />
          </div>
          <div className="relative hidden sm:block">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <select
              value={rango}
              onChange={(e) => cambiarRango(Number(e.target.value) as 7 | 30 | 90 | 0)}
              aria-label={t("Filtrar por antigüedad", "Filter by recency")}
              className="appearance-none rounded-lg border border-edge bg-ink py-2 pl-9 pr-8 text-sm text-fg outline-none focus:border-lime/50"
            >
              <option value={0}>{t("Todo el tiempo", "All time")}</option>
              <option value={7}>{t("Últimos 7 días", "Last 7 days")}</option>
              <option value={30}>{t("Últimos 30 días", "Last 30 days")}</option>
              <option value={90}>{t("Últimos 90 días", "Last 90 days")}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-mist" />
          </div>
        </div>
      </div>

      {/* Tabla (scroll horizontal en pantallas estrechas) */}
      <div className="overflow-x-auto">
        <div className="min-w-[880px]">
          <div className={cn("grid items-center gap-2 border-y border-edge px-5 py-2.5", GRID)}>
            {columns.map((c, i) => (
              <span key={i} className="font-mono text-[10.5px] uppercase tracking-widest text-mist">
                {c}
              </span>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-mist">
              {t("No hay encuestas que coincidan con el filtro.", "No surveys match the current filter.")}
            </p>
          ) : (
            <div className="divide-y divide-edge">
              {paginadas.map((s) => (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onRowClick?.(s)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowClick?.(s);
                    }
                  }}
                  className={cn(
                    "grid cursor-pointer items-center gap-2 px-5 py-3.5 text-sm transition-colors hover:bg-ink/60 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-lime",
                    GRID
                  )}
                >
                  {/* Survey */}
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-lime/10 text-lime-text">
                      <FileText className="size-4" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-fg">{s.name}</p>
                      <p className="mt-0.5 text-xs text-mist">
                        {s.questionCount} {t("preguntas", "questions")}
                      </p>
                    </div>
                  </div>
                  {/* Status */}
                  <div>
                    <StatusBadge status={s.status} />
                  </div>
                  {/* Sent / Started / Completed */}
                  <span className="tabular-nums text-mist">{s.sent.toLocaleString("es-CO")}</span>
                  <span className="tabular-nums text-mist">{s.started.toLocaleString("es-CO")}</span>
                  <span className="tabular-nums text-mist">{s.completed.toLocaleString("es-CO")}</span>
                  {/* Completion rate */}
                  <CompletionCell rate={s.completionRate} />
                  {/* Updated */}
                  <span className="text-mist">{t(s.updatedAt.es, s.updatedAt.en)}</span>
                  {/* Row menu */}
                  <button
                    type="button"
                    aria-label={t(`Acciones para ${s.name}`, `Actions for ${s.name}`)}
                    title={t("Acciones", "Actions")}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (menuAbiertoId === s.id) cerrarMenu();
                      else abrirMenu(s.id, e.currentTarget);
                    }}
                    className="flex size-8 items-center justify-center rounded-lg text-mist transition-colors hover:bg-card hover:text-fg"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer / paginación */}
      <div className="flex items-center justify-between px-5 py-3.5">
        <p className="text-xs text-mist">
          {t(
            `Mostrando ${desdeVisible} a ${hastaVisible} de ${filtered.length} encuestas`,
            `Showing ${desdeVisible} to ${hastaVisible} of ${filtered.length} surveys`
          )}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPagina(Math.max(1, paginaActual - 1))}
            disabled={paginaActual <= 1}
            aria-label={t("Página anterior", "Previous page")}
            className="flex size-7 items-center justify-center rounded-md border border-edge text-mist transition-colors hover:text-fg disabled:opacity-40 disabled:hover:text-mist"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="flex h-7 min-w-7 items-center justify-center rounded-md bg-lime px-2 text-xs font-semibold text-lime-fg">
            {paginaActual}
            {totalPaginas > 1 && <span className="ml-0.5 font-normal opacity-70">/{totalPaginas}</span>}
          </span>
          <button
            type="button"
            onClick={() => setPagina(Math.min(totalPaginas, paginaActual + 1))}
            disabled={paginaActual >= totalPaginas}
            aria-label={t("Página siguiente", "Next page")}
            className="flex size-7 items-center justify-center rounded-md border border-edge text-mist transition-colors hover:text-fg disabled:opacity-40 disabled:hover:text-mist"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>

    {menuAbiertoId && menuPos && surveyEnMenu &&
      createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
          className="z-50 w-64 rounded-lg border border-edge bg-card p-1.5 shadow-lg"
        >
          {confirmandoId === surveyEnMenu.id ? (
            <div className="p-2">
              <p className="text-xs leading-relaxed text-fg">
                {t(
                  `¿Eliminar "${surveyEnMenu.name}"? Se borra la encuesta y las respuestas de todos los participantes. Esta acción no se puede deshacer.`,
                  `Delete "${surveyEnMenu.name}"? This removes the survey and every participant's answers. This can't be undone.`
                )}
              </p>
              {errorEliminar && <p className="mt-2 text-xs text-red-400">{errorEliminar}</p>}
              <div className="mt-2.5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmandoId(null);
                    setErrorEliminar(null);
                  }}
                  disabled={eliminandoId === surveyEnMenu.id}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium text-mist hover:text-fg disabled:opacity-50"
                >
                  {t("Cancelar", "Cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => eliminarEncuesta(surveyEnMenu.id)}
                  disabled={eliminandoId === surveyEnMenu.id}
                  className="rounded-md bg-red-500/15 px-2.5 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {eliminandoId === surveyEnMenu.id ? t("Eliminando…", "Deleting…") : t("Sí, eliminar", "Yes, delete")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmandoId(surveyEnMenu.id)}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
            >
              <Trash2 className="size-3.5" /> {t("Eliminar encuesta", "Delete survey")}
            </button>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
