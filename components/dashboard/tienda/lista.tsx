"use client";

/**
 * Administración de tienda — lista de ofertas, combos, campañas o contenido: buscar, filtrar por estado, ver qué está en la tienda y crear uno nuevo.
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ETIQUETAS_TEMA, TEMAS_CONTENIDO, type EstadoEntidad, type TemaContenido, type TipoEntidad } from "@/lib/cms-comercial/contrato";
import type { EntidadResumen } from "@/lib/cms-comercial-client";
import { borradorInicial } from "@/components/dashboard/tienda/borrador";
import { useTienda } from "@/components/dashboard/tienda/contexto";
import { NOMBRES_TIPO, chipsDe, fechaHora } from "@/components/dashboard/tienda/formato";
import { Aviso, BotonCargando, CampoTexto, Cargando, ChipUi, Dialogo, actionBtn, cn, inputCls, primaryBtn } from "@/components/dashboard/tienda/ui";

export type TipoLista = Exclude<TipoEntidad, "home">;

const sinAcentos = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function etiquetaAudiencia(tipo: TipoLista, valor: string | null, t: (es: string, en: string) => string): string | null {
  if (valor === null) return null;
  if (tipo === "contenido") return valor === "mayorista" ? t("Solo mayorista", "Wholesale only") : valor === "detal" ? t("Solo detal", "Retail only") : t("Todos los clientes", "All customers");
  return valor === "mayorista" ? t("Mayorista", "Wholesale") : valor === "detal" ? t("Detal", "Retail") : t("Detal y mayorista", "Retail and wholesale");
}

export function ListaEntidades({ tipo, onAbrir }: { tipo: TipoLista; onAbrir: (id: string) => void }) {
  const { t } = useI18n();
  const { client, canWrite } = useTienda();
  const nombres = NOMBRES_TIPO[tipo];

  const [items, setItems] = useState<EntidadResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [verArchivadas, setVerArchivadas] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState<"todos" | EstadoEntidad>("todos");
  const [tema, setTema] = useState<"todos" | TemaContenido>("todos");
  const [creando, setCreando] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [errorCrear, setErrorCrear] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void client.listar({ tipo, archivadas: verArchivadas }).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setItems(r.data.items);
        setError(null);
      } else setError(r.error.message);
    });
    return () => {
      vivo = false;
    };
  }, [client, tipo, verArchivadas, recarga]);

  const visibles = useMemo(() => {
    const q = sinAcentos(busqueda.trim());
    return (items ?? []).filter((i) => (estado === "todos" || i.estado === estado) && (tema === "todos" || i.tema === tema) && (q === "" || sinAcentos(i.nombre).includes(q)));
  }, [items, busqueda, estado, tema]);

  const cerrarCrear = () => {
    if (enviando) return;
    setCreando(false);
    setNuevoNombre("");
    setErrorCrear(null);
  };

  const crear = async () => {
    const nombre = nuevoNombre.trim();
    if (nombre === "") {
      setErrorCrear(tipo === "contenido" ? t("Escribe un título.", "Write a title.") : t("Escribe un nombre.", "Write a name."));
      return;
    }
    setEnviando(true);
    setErrorCrear(null);
    const r = await client.crear(tipo, { ...borradorInicial(tipo), [tipo === "contenido" ? "titulo" : "nombre"]: nombre });
    setEnviando(false);
    if (!r.ok) {
      setErrorCrear(r.error.message);
      return;
    }
    onAbrir(r.data.entidad.id);
  };

  const hayFiltros = busqueda.trim() !== "" || estado !== "todos" || tema !== "todos";

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" aria-hidden />
          <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder={t("Buscar por nombre…", "Search by name…")} aria-label={t("Buscar", "Search")} className={cn(inputCls, "pl-9")} />
        </div>
        {tipo === "contenido" && (
          <select value={tema} onChange={(e) => setTema(e.target.value as "todos" | TemaContenido)} aria-label={t("Filtrar por tema", "Filter by topic")} className={cn(inputCls, "sm:w-48")}>
            <option value="todos">{t("Todos los temas", "All topics")}</option>
            {TEMAS_CONTENIDO.map((x) => (
              <option key={x} value={x}>
                {ETIQUETAS_TEMA[x]}
              </option>
            ))}
          </select>
        )}
        <select value={estado} onChange={(e) => setEstado(e.target.value as "todos" | EstadoEntidad)} aria-label={t("Filtrar por estado", "Filter by status")} className={cn(inputCls, "sm:w-48")}>
          <option value="todos">{t("Todos los estados", "All statuses")}</option>
          <option value="publicada">{t("En la tienda", "Live")}</option>
          <option value="borrador">{t("Borradores", "Drafts")}</option>
          <option value="pausada">{t("Pausados", "Paused")}</option>
        </select>
        {canWrite && (
          <button type="button" onClick={() => setCreando(true)} className={primaryBtn}>
            <Plus className="size-4" aria-hidden /> {t(nombres.nuevo, nombres.nuevoEn)}
          </button>
        )}
      </div>

      <label className="mt-3 flex w-fit items-center gap-2 text-sm text-mist">
        <input type="checkbox" checked={verArchivadas} onChange={(e) => setVerArchivadas(e.target.checked)} className="size-4 accent-lime" />
        {t("Mostrar archivados", "Show archived")}
      </label>

      <div className="mt-4">
        {error ? (
          <Aviso tono="danger" titulo={t("No pudimos cargar la lista", "We couldn't load the list")}>
            {error}
            <button type="button" onClick={() => setRecarga((n) => n + 1)} className={cn(actionBtn, "mt-2")}>
              {t("Reintentar", "Retry")}
            </button>
          </Aviso>
        ) : items === null ? (
          <Cargando />
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-edge bg-card px-6 py-14 text-center">
            <p className="text-base font-semibold text-fg">{t(`Todavía no hay ${nombres.plural.toLowerCase()}`, `No ${nombres.pluralEn.toLowerCase()} yet`)}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-mist">{canWrite ? t("Crea el primero: se guarda como borrador y no se ve en la tienda hasta que lo publiques.", "Create the first one: it is saved as a draft and doesn't show in the store until you publish it.") : t("Cuando un administrador cree alguno, lo verás aquí.", "When an administrator creates one, you'll see it here.")}</p>
            {canWrite && (
              <button type="button" onClick={() => setCreando(true)} className={cn(primaryBtn, "mx-auto mt-5")}>
                <Plus className="size-4" aria-hidden /> {t(nombres.nuevo, nombres.nuevoEn)}
              </button>
            )}
          </div>
        ) : visibles.length === 0 ? (
          <div className="rounded-2xl border border-edge bg-card px-6 py-12 text-center">
            <Search className="mx-auto size-6 text-mist" aria-hidden />
            <p className="mt-3 text-sm font-medium text-fg">{t("Sin resultados", "No results")}</p>
            {hayFiltros && (
              <button
                type="button"
                onClick={() => {
                  setBusqueda("");
                  setEstado("todos");
                  setTema("todos");
                }}
                className="mt-1 text-sm text-mist underline-offset-2 hover:text-fg hover:underline"
              >
                {t("Limpiar filtros", "Clear filters")}
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-card" data-testid="lista-entidades">
            {visibles.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => onAbrir(i.id)} className="flex w-full flex-col gap-1.5 px-4 py-3.5 text-left transition-colors hover:bg-ink focus-visible:bg-ink sm:flex-row sm:items-center sm:gap-4" aria-label={`${t("Abrir", "Open")} ${i.nombre}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{i.nombre}</span>
                    <span className="mt-0.5 block text-xs text-mist">
                      {[i.tema ? ETIQUETAS_TEMA[i.tema as TemaContenido] : null, etiquetaAudiencia(tipo, i.modalidad, t), i.versionActiva !== null && i.estado !== "borrador" ? `${t("Versión", "Version")} ${i.versionActiva}` : null, `${t("Editado", "Edited")} ${fechaHora(i.updatedAt)}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {chipsDe(i).map((c) => (
                      <ChipUi key={c.texto} chip={c} />
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialogo
        abierto={creando}
        titulo={t(nombres.nuevo, nombres.nuevoEn)}
        descripcion={t("Se crea como borrador: no se ve en la tienda hasta que lo publiques.", "It is created as a draft: it doesn't show in the store until you publish it.")}
        onCerrar={cerrarCrear}
        acciones={
          <>
            <button type="button" onClick={cerrarCrear} disabled={enviando} className={actionBtn}>
              {t("Cancelar", "Cancel")}
            </button>
            <BotonCargando type="button" cargando={enviando} onClick={() => void crear()} className={primaryBtn}>
              {t("Crear y editar", "Create and edit")}
            </BotonCargando>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void crear();
          }}
        >
          <CampoTexto
            etiqueta={tipo === "contenido" ? t("Título o pregunta", "Title or question") : t("Nombre", "Name")}
            ayuda={tipo === "contenido" ? t("Por ejemplo «¿Cuál es el mínimo de compra mayorista?»", "For example “What is the wholesale minimum order?”") : t("Por ejemplo «Amor y Amistad». Lo verán tus clientes.", "For example “Valentine's Day”. Your customers will see it.")}
            valor={nuevoNombre}
            onCambio={setNuevoNombre}
            maxLength={tipo === "contenido" ? 160 : 80}
            error={errorCrear}
            requerido
          />
        </form>
      </Dialogo>
    </div>
  );
}
