"use client";

/**
 * Administración de tienda — EDITOR de un elemento (página principal, oferta, combo, campaña o contenido).
 *
 * Ciclo: BORRADOR (se edita y se guarda sin afectar la tienda) → REVISAR (el servidor valida con las mismas reglas de siempre) → VISTA PREVIA → PUBLICAR
 * (exactamente la revisión que se validó) → VERSIÓN ACTIVA → HISTORIAL → RESTAURAR. El permiso de escritura que se ve aquí es solo presentación: el servidor
 * vuelve a autorizar cada llamada.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArrowLeft, ArchiveRestore, Check, Eye, Pause, Play, Save, Send, Undo2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Problema, TipoEntidad } from "@/lib/cms-comercial/contrato";
import type { CmsClientError, EntidadDetalle } from "@/lib/cms-comercial-client";
import { useCatalogToast } from "@/components/dashboard/catalogo/ui";
import { mismoContenido, poner as ponerEn, type Draft } from "@/components/dashboard/tienda/borrador";
import { useTienda } from "@/components/dashboard/tienda/contexto";
import { NOMBRES_TIPO, chipsDe, fechaHora, resumirCambios } from "@/components/dashboard/tienda/formato";
import { FormCampana, FormCombo, FormContenido, FormHome, FormOferta, type FormProps } from "@/components/dashboard/tienda/formularios";
import { ListaCambios, PanelHistorial, PanelProblemas, PanelVersiones } from "@/components/dashboard/tienda/paneles";
import { PanelPrevia } from "@/components/dashboard/tienda/previas";
import { Aviso, BotonCargando, CampoTexto, Cargando, ChipUi, Dialogo, Tarjeta, actionBtn, cn, dangerBtn, primaryBtn } from "@/components/dashboard/tienda/ui";

const FORMULARIOS: Record<TipoEntidad, (p: FormProps) => React.ReactNode> = {
  home: FormHome,
  oferta: FormOferta,
  combo: FormCombo,
  campana: FormCampana,
  contenido: FormContenido,
};

type Ocupado = "guardar" | "revisar" | "publicar" | "estado" | null;
type Pestana = "contenido" | "versiones" | "historial";
type TipoDialogo = "publicar" | "pausar" | "despublicar" | "archivar" | "descartar" | "salir" | null;
type Validacion = { ok: boolean; errores: Problema[]; advertencias: Problema[] };
type Fallo = { mensaje: string; recargar: boolean };

/** ¿El problema de este campo queda afectado al editar `ruta`? (el mismo campo, uno de adentro o el contenedor) */
const tocaCampo = (campo: string, ruta: string) => campo === ruta || campo.startsWith(`${ruta}.`) || ruta.startsWith(`${campo}.`);

const CODIGOS_DE_ESTADO_VIEJO = new Set(["CONFLICT", "ARCHIVED", "INVALID_STATE", "NOT_FOUND"]);

/** `onVolver`: vuelve a la lista. Sin él (la página principal se edita directamente) no hay botón «Volver». */
export function EditorEntidad({ id, onVolver }: { id: string; onVolver?: () => void }) {
  const { t } = useI18n();
  const { client, canWrite, contexto } = useTienda();
  const avisar = useCatalogToast();

  const [detalle, setDetalle] = useState<EntidadDetalle | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [borrador, setBorrador] = useState<Draft>({});
  const [ocupado, setOcupado] = useState<Ocupado>(null);
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [validacion, setValidacion] = useState<Validacion | null>(null);
  const [pestana, setPestana] = useState<Pestana>("contenido");
  const [dialogo, setDialogo] = useState<TipoDialogo>(null);
  const [nota, setNota] = useState("");
  const [haGuardado, setHaGuardado] = useState(false);
  /** Enlace del panel que se tocó con cambios sin guardar: si decide salir, se va allí. */
  const [destinoPendiente, setDestinoPendiente] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void client.obtener(id).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setDetalle(r.data.entidad);
        setBorrador(r.data.entidad.contenido);
        setErrorCarga(null);
        setFallo(null);
      } else setErrorCarga(r.error.message);
    });
    return () => {
      vivo = false;
    };
  }, [client, id, recarga]);

  const sucio = useMemo(() => detalle !== null && !mismoContenido(detalle.tipo, borrador, detalle.contenido), [detalle, borrador]);

  // Salir con cambios sin guardar: al cerrar o recargar la pestaña el navegador avisa; al tocar un enlace del panel (menú lateral, etc.) preguntamos nosotros.
  useEffect(() => {
    if (!sucio) return;
    const antes = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const alHacerClic = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const enlace = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!enlace || enlace.target === "_blank" || enlace.hasAttribute("download")) return;
      const url = new URL(enlace.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // el mismo lugar (por ejemplo «#previa»)
      e.preventDefault();
      e.stopPropagation();
      setDestinoPendiente(`${url.pathname}${url.search}${url.hash}`);
      setDialogo("salir");
    };
    window.addEventListener("beforeunload", antes);
    document.addEventListener("click", alHacerClic, true);
    return () => {
      window.removeEventListener("beforeunload", antes);
      document.removeEventListener("click", alHacerClic, true);
    };
  }, [sucio]);

  const poner = useCallback((ruta: string, valor: unknown) => {
    setBorrador((prev) => ponerEn(prev, ruta, valor));
    // Un error ya no aplica a lo que se acaba de tocar; la próxima revisión vuelve a decidir.
    setValidacion((v) => (v ? { ...v, errores: v.errores.filter((e) => !tocaCampo(e.campo, ruta)) } : v));
  }, []);

  const manejarError = useCallback((e: CmsClientError) => {
    if (e.problemas && e.problemas.length > 0) setValidacion({ ok: false, errores: e.problemas.filter((p) => p.severidad === "error"), advertencias: e.problemas.filter((p) => p.severidad === "advertencia") });
    setFallo({ mensaje: e.message, recargar: CODIGOS_DE_ESTADO_VIEJO.has(e.code) });
  }, []);

  /** Reemplaza lo que se ve por lo que devolvió el servidor. Con `conservarBorrador`, lo que se está escribiendo no se pierde. */
  const aplicar = useCallback((entidad: EntidadDetalle, conservarBorrador: boolean) => {
    setDetalle(entidad);
    if (!conservarBorrador) setBorrador(entidad.contenido);
  }, []);

  const guardar = useCallback(async (): Promise<EntidadDetalle | null> => {
    if (!detalle) return null;
    setOcupado("guardar");
    setFallo(null);
    const enviado = borrador;
    const r = await client.guardarBorrador(id, enviado, detalle.rev);
    setOcupado(null);
    if (!r.ok) {
      manejarError(r.error);
      return null;
    }
    setDetalle(r.data.entidad);
    // Si no se tocó nada mientras se guardaba, se muestra lo que quedó guardado (ya normalizado: sin espacios sobrantes, etc.).
    setBorrador((actual) => (actual === enviado ? r.data.entidad.contenido : actual));
    setHaGuardado(true);
    return r.data.entidad;
  }, [client, id, detalle, borrador, manejarError]);

  const revisar = useCallback(async (): Promise<Validacion | null> => {
    if (canWrite && sucio && (await guardar()) === null) return null;
    setOcupado("revisar");
    setFallo(null);
    const r = await client.validar(id);
    setOcupado(null);
    if (!r.ok) {
      manejarError(r.error);
      return null;
    }
    const v = { ok: r.data.validacion.ok, errores: r.data.validacion.errores, advertencias: r.data.validacion.advertencias };
    setValidacion(v);
    return v;
  }, [canWrite, sucio, guardar, client, id, manejarError]);

  const abrirPublicar = async () => {
    setNota("");
    const v = await revisar();
    if (v?.ok) setDialogo("publicar");
    else if (v) setPestana("contenido");
  };

  const publicar = async () => {
    if (!detalle) return;
    setOcupado("publicar");
    setFallo(null);
    const r = await client.publicar(id, detalle.rev, nota.trim() || null);
    setOcupado(null);
    if (!r.ok) {
      setDialogo(null);
      manejarError(r.error);
      return;
    }
    setDialogo(null);
    setValidacion({ ok: true, errores: [], advertencias: r.data.advertencias });
    aplicar(r.data.entidad, false);
    avisar(t(`Publicado: versión ${r.data.version}.`, `Published: version ${r.data.version}.`));
  };

  const cambiarEstado = async (accion: "pausar" | "reanudar" | "despublicar" | "archivar" | "desarchivar") => {
    setOcupado("estado");
    setFallo(null);
    const r = await client[accion](id);
    setOcupado(null);
    setDialogo(null);
    if (!r.ok) {
      manejarError(r.error);
      return;
    }
    aplicar(r.data.entidad, sucio);
    setValidacion(null);
    const mensajes = {
      pausar: t("Pausado: ya no se ve en la tienda.", "Paused: it no longer shows in the store."),
      reanudar: t("Reanudado: vuelve a verse en la tienda.", "Resumed: it shows in the store again."),
      despublicar: t("Despublicado: vuelve a borrador.", "Unpublished: back to draft."),
      archivar: t("Archivado.", "Archived."),
      desarchivar: t("Desarchivado.", "Unarchived."),
    };
    avisar(mensajes[accion]);
  };

  const descartar = () => {
    if (!detalle) return;
    setBorrador(detalle.contenido);
    setValidacion(null);
    setDialogo(null);
  };

  const volver = () => {
    if (sucio) setDialogo("salir");
    else onVolver?.();
  };

  const salir = () => {
    if (destinoPendiente) window.location.assign(destinoPendiente);
    else onVolver?.();
  };

  const cerrarSalir = () => {
    setDestinoPendiente(null);
    setDialogo(null);
  };

  const guardarYSalir = async () => {
    if ((await guardar()) !== null) salir();
    else cerrarSalir();
  };

  // ---- estados de carga ----
  if (errorCarga) {
    return (
      <div className="space-y-4 px-4 pt-6 md:px-8">
        <Aviso tono="danger" titulo={t("No pudimos abrir este elemento", "We couldn't open this item")}>
          {errorCarga}
        </Aviso>
        <div className="flex gap-2">
          {onVolver && (
            <button type="button" onClick={onVolver} className={actionBtn}>
              <ArrowLeft className="size-4" aria-hidden /> {t("Volver", "Back")}
            </button>
          )}
          <button type="button" onClick={() => setRecarga((n) => n + 1)} className={actionBtn}>
            {t("Reintentar", "Retry")}
          </button>
        </div>
      </div>
    );
  }
  if (!detalle) {
    return (
      <div className="px-4 pt-6 md:px-8">
        <Cargando texto={t("Abriendo…", "Opening…")} />
      </div>
    );
  }

  const tipo = detalle.tipo;
  const Formulario = FORMULARIOS[tipo];
  const accionDialogo = dialogo === "pausar" || dialogo === "despublicar" || dialogo === "archivar" ? dialogo : null;
  const lectura = !canWrite || detalle.archivada;
  const enVivo = detalle.estado !== "borrador";
  const hayAlgoPorPublicar = sucio || detalle.tieneCambios || detalle.estado === "borrador";
  const problemas: Problema[] = validacion ? [...validacion.errores, ...validacion.advertencias] : [];
  const trabajando = ocupado !== null;
  const nombre = detalle.nombre;
  const claveVisible = tipo !== "home" ? detalle.clave : null;

  const estadoGuardado = ocupado === "guardar" ? t("Guardando…", "Saving…") : sucio ? t("Cambios sin guardar", "Unsaved changes") : detalle.tieneCambios ? t("Borrador guardado · sin publicar", "Draft saved · not published") : haGuardado ? t("Todo guardado", "All saved") : "";

  return (
    <div className="pb-24">
      {/* Barra superior: en pantallas grandes se queda arriba; en el celular los botones van en una barra fija abajo (siempre al alcance del pulgar) */}
      <div className="border-b border-edge bg-ink/95 px-4 py-3 md:px-8 lg:sticky lg:top-16 lg:z-20 lg:backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {onVolver && (
            <button type="button" onClick={volver} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-mist transition-colors hover:text-fg" aria-label={t("Volver a la lista", "Back to the list")}>
              <ArrowLeft className="size-4" aria-hidden /> {t("Volver", "Back")}
            </button>
          )}
          <div className="min-w-[11rem] flex-1">
            <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{t(NOMBRES_TIPO[tipo].singular, NOMBRES_TIPO[tipo].singularEn)}</p>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-fg">{nombre}</h2>
              {chipsDe(detalle).map((c) => (
                <ChipUi key={c.texto} chip={c} />
              ))}
            </div>
          </div>
          <span className="text-xs text-mist" role="status" aria-live="polite">
            {estadoGuardado}
          </span>
          <a href="#previa" className="flex items-center gap-1.5 text-sm text-mist underline-offset-2 hover:text-fg hover:underline lg:hidden">
            <Eye className="size-4" aria-hidden /> {t("Vista previa", "Preview")}
          </a>
          <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-end gap-2 border-t border-edge bg-ink/95 px-4 py-3 backdrop-blur lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
            {canWrite && sucio && !detalle.archivada && (
              <button type="button" onClick={() => setDialogo("descartar")} disabled={trabajando} className={actionBtn} aria-label={t("Descartar los cambios", "Discard the changes")} title={t("Descartar los cambios", "Discard the changes")}>
                <Undo2 className="size-4" aria-hidden /> <span className="hidden sm:inline">{t("Descartar", "Discard")}</span>
              </button>
            )}
            <BotonCargando type="button" cargando={ocupado === "revisar"} disabled={trabajando} onClick={() => void revisar()} className={actionBtn}>
              <Check className="size-4" aria-hidden /> {t("Revisar", "Review")}
            </BotonCargando>
            {!lectura && (
              <>
                <BotonCargando type="button" cargando={ocupado === "guardar"} disabled={trabajando || !sucio} onClick={() => void guardar()} className={actionBtn}>
                  <Save className="size-4" aria-hidden />
                  <span>
                    {t("Guardar", "Save")}
                    <span className="hidden sm:inline">{t(" borrador", " draft")}</span>
                  </span>
                </BotonCargando>
                <BotonCargando type="button" cargando={ocupado === "publicar"} disabled={trabajando || !hayAlgoPorPublicar} onClick={() => void abrirPublicar()} className={primaryBtn} title={hayAlgoPorPublicar ? undefined : t("No hay cambios por publicar", "Nothing to publish")}>
                  <Send className="size-4" aria-hidden /> {t("Publicar", "Publish")}
                </BotonCargando>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 pt-5 md:px-8">
        {fallo && (
          <div className="mb-4">
            <Aviso tono="danger" titulo={fallo.mensaje}>
              {fallo.recargar && (
                <button type="button" onClick={() => setRecarga((n) => n + 1)} className={cn(actionBtn, "mt-2")}>
                  {t("Recargar la versión más reciente", "Reload the latest version")}
                </button>
              )}
            </Aviso>
          </div>
        )}
        {detalle.archivada && (
          <div className="mb-4">
            <Aviso tono="info" titulo={t("Está archivado", "It is archived")}>
              {t("Se ve solo para consulta. Desarchívalo para volver a editarlo.", "It is read-only. Unarchive it to edit it again.")}
            </Aviso>
          </div>
        )}
        {!canWrite && (
          <div className="mb-4">
            <Aviso tono="info">{t("Puedes ver todo, pero solo un administrador puede modificar la tienda.", "You can see everything, but only an administrator can change the store.")}</Aviso>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-w-0">
            <div role="tablist" aria-label={t("Secciones del editor", "Editor sections")} className="mb-4 inline-flex gap-1 rounded-lg border border-edge bg-card p-1">
              {(
                [
                  ["contenido", t("Contenido", "Content")],
                  ["versiones", t("Versiones", "Versions")],
                  ["historial", t("Historial", "History")],
                ] as const
              ).map(([clave, etiqueta]) => (
                <button key={clave} type="button" role="tab" id={`tab-${clave}`} aria-selected={pestana === clave} aria-controls={`panel-${clave}`} onClick={() => setPestana(clave)} className={cn("rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors", pestana === clave ? "bg-lime text-lime-fg" : "text-mist hover:text-fg")}>
                  {etiqueta}
                </button>
              ))}
            </div>

            {pestana === "contenido" && (
              <div role="tabpanel" id="panel-contenido" aria-labelledby="tab-contenido">
                <Formulario borrador={borrador} poner={poner} disabled={lectura} problemas={problemas} />
              </div>
            )}
            {pestana === "versiones" && (
              <div role="tabpanel" id="panel-versiones" aria-labelledby="tab-versiones">
                <PanelVersiones
                  id={id}
                  versionActiva={detalle.versionActiva}
                  canWrite={!lectura}
                  bloqueadoPor={sucio ? t("Guarda o descarta tus cambios antes de restaurar una versión.", "Save or discard your changes before restoring a version.") : null}
                  onRestaurada={(entidad, version) => {
                    aplicar(entidad, false);
                    setValidacion(null);
                    avisar(t(`Restaurada: ahora la versión ${version} está en la tienda.`, `Restored: version ${version} is now in the store.`));
                  }}
                />
              </div>
            )}
            {pestana === "historial" && (
              <div role="tabpanel" id="panel-historial" aria-labelledby="tab-historial">
                <PanelHistorial entidadId={id} />
              </div>
            )}
          </div>

          <aside className="min-w-0 space-y-4 lg:sticky lg:top-36 lg:max-h-[calc(100vh-10rem)] lg:self-start lg:overflow-y-auto" aria-label={t("Estado y vista previa", "Status and preview")}>
            <Tarjeta titulo={t("Estado", "Status")}>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-mist">{t("En la tienda", "In the store")}</dt>
                  <dd className="text-right text-fg">
                    {detalle.versionActiva !== null && detalle.estado !== "borrador" ? `${t("Versión", "Version")} ${detalle.versionActiva}${detalle.estado === "pausada" ? ` · ${t("pausada", "paused")}` : ""}` : t("Todavía no se ve", "Not live yet")}
                  </dd>
                </div>
                {detalle.publishedAt && enVivo && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-mist">{t("Publicada", "Published")}</dt>
                    <dd className="text-right text-fg">{fechaHora(detalle.publishedAt)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-mist">{t("Última modificación", "Last modified")}</dt>
                  <dd className="text-right text-fg">{fechaHora(detalle.updatedAt)}</dd>
                </div>
                {claveVisible && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-mist" title={t("El código que usan los enlaces y ARIA. No cambia aunque cambies el nombre.", "The code used by links and ARIA. It doesn't change if you rename it.")}>
                      {t("Código", "Code")}
                    </dt>
                    <dd className="break-all text-right font-mono text-[12px] text-fg">{claveVisible}</dd>
                  </div>
                )}
              </dl>
              {canWrite && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {detalle.archivada ? (
                    <BotonCargando type="button" cargando={ocupado === "estado"} disabled={trabajando} onClick={() => void cambiarEstado("desarchivar")} className={actionBtn}>
                      <ArchiveRestore className="size-4" aria-hidden /> {t("Desarchivar", "Unarchive")}
                    </BotonCargando>
                  ) : (
                    <>
                      {detalle.estado === "publicada" && (
                        <button type="button" disabled={trabajando} onClick={() => setDialogo("pausar")} className={actionBtn}>
                          <Pause className="size-4" aria-hidden /> {t("Pausar", "Pause")}
                        </button>
                      )}
                      {detalle.estado === "pausada" && (
                        <BotonCargando type="button" cargando={ocupado === "estado"} disabled={trabajando} onClick={() => void cambiarEstado("reanudar")} className={actionBtn}>
                          <Play className="size-4" aria-hidden /> {t("Reanudar", "Resume")}
                        </BotonCargando>
                      )}
                      {enVivo && (
                        <button type="button" disabled={trabajando} onClick={() => setDialogo("despublicar")} className={dangerBtn}>
                          {t("Despublicar", "Unpublish")}
                        </button>
                      )}
                      {detalle.estado === "borrador" && tipo !== "home" && (
                        <button type="button" disabled={trabajando} onClick={() => setDialogo("archivar")} className={actionBtn}>
                          <Archive className="size-4" aria-hidden /> {t("Archivar", "Archive")}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </Tarjeta>

            <PanelProblemas errores={validacion?.errores ?? []} advertencias={validacion?.advertencias ?? []} />
            {validacion?.ok && validacion.errores.length === 0 && (
              <Aviso tono="success" titulo={t("Todo en orden", "All good")}>
                {t("La revisión no encontró nada que impida publicar.", "The review found nothing that prevents publishing.")}
              </Aviso>
            )}

            <div id="previa" className="scroll-mt-28">
              <PanelPrevia tipo={tipo} borrador={borrador} />
            </div>
          </aside>
        </div>
      </div>

      {/* Publicar */}
      <Dialogo
        abierto={dialogo === "publicar"}
        titulo={t(`Publicar «${nombre}»`, `Publish “${nombre}”`)}
        descripcion={enVivo ? t("Esto reemplaza lo que hoy ve la tienda. Las versiones anteriores quedan guardadas y podrás restaurarlas.", "This replaces what the store shows today. Earlier versions are kept and you can restore them.") : t("Es la primera vez que se publica: empezará a verse en la tienda y ARIA lo conocerá desde que esté vigente.", "This is the first time it is published: it will show in the store and ARIA will know it once it is active.")}
        onCerrar={() => ocupado !== "publicar" && setDialogo(null)}
        acciones={
          <>
            <button type="button" onClick={() => setDialogo(null)} disabled={ocupado === "publicar"} className={actionBtn}>
              {t("Cancelar", "Cancel")}
            </button>
            <BotonCargando type="button" cargando={ocupado === "publicar"} onClick={() => void publicar()} className={primaryBtn}>
              {t("Publicar ahora", "Publish now")}
            </BotonCargando>
          </>
        }
      >
        <div className="rounded-lg border border-edge bg-ink p-3">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-mist">{enVivo ? t("Lo que cambia", "What changes") : t("Lo que se publica", "What gets published")}</p>
          <ListaCambios cambios={resumirCambios(detalle.contenidoActivo, detalle.contenido, 12, { categorias: contexto?.categorias })} vacio={t("Es igual a lo que ya está publicado.", "It is the same as what is already published.")} />
        </div>
        {validacion && validacion.advertencias.length > 0 && <PanelProblemas errores={[]} advertencias={validacion.advertencias} />}
        <CampoTexto etiqueta={t("Nota (opcional)", "Note (optional)")} valor={nota} onCambio={setNota} maxLength={200} placeholder={t("Qué cambiaste y por qué", "What you changed and why")} />
      </Dialogo>

      {/* Pausar / despublicar / archivar */}
      <Dialogo
        abierto={accionDialogo !== null}
        titulo={dialogo === "pausar" ? t(`Pausar «${nombre}»`, `Pause “${nombre}”`) : dialogo === "despublicar" ? t(`Despublicar «${nombre}»`, `Unpublish “${nombre}”`) : t(`Archivar «${nombre}»`, `Archive “${nombre}”`)}
        descripcion={
          dialogo === "pausar"
            ? t("Deja de verse en la tienda y ARIA deja de informarlo, pero conservas lo publicado. Puedes reanudarlo cuando quieras.", "It stops showing in the store and ARIA stops reporting it, but you keep what was published. You can resume it any time.")
            : dialogo === "despublicar"
              ? t("Deja de estar en la tienda y vuelve a borrador. Tu historial de versiones se conserva.", "It leaves the store and goes back to draft. Your version history is kept.")
              : t("Se guarda aparte, fuera de tu lista principal. Puedes desarchivarlo cuando quieras.", "It is stored apart, out of your main list. You can unarchive it any time.")
        }
        onCerrar={() => ocupado !== "estado" && setDialogo(null)}
        acciones={
          <>
            <button type="button" onClick={() => setDialogo(null)} disabled={ocupado === "estado"} className={actionBtn}>
              {t("Cancelar", "Cancel")}
            </button>
            <BotonCargando type="button" cargando={ocupado === "estado"} onClick={() => accionDialogo && void cambiarEstado(accionDialogo)} className={dialogo === "despublicar" ? dangerBtn : primaryBtn}>
              {dialogo === "pausar" ? t("Pausar", "Pause") : dialogo === "despublicar" ? t("Despublicar", "Unpublish") : t("Archivar", "Archive")}
            </BotonCargando>
          </>
        }
      />

      {/* Descartar cambios */}
      <Dialogo
        abierto={dialogo === "descartar"}
        titulo={t("¿Descartar los cambios?", "Discard the changes?")}
        descripcion={t("Se pierde lo que escribiste desde la última vez que guardaste.", "What you wrote since you last saved is lost.")}
        onCerrar={() => setDialogo(null)}
        acciones={
          <>
            <button type="button" onClick={() => setDialogo(null)} className={actionBtn}>
              {t("Seguir editando", "Keep editing")}
            </button>
            <button type="button" onClick={descartar} className={dangerBtn}>
              {t("Descartar", "Discard")}
            </button>
          </>
        }
      />

      {/* Salir con cambios sin guardar */}
      <Dialogo
        abierto={dialogo === "salir"}
        titulo={t("Tienes cambios sin guardar", "You have unsaved changes")}
        descripcion={t("Si sales ahora, se pierden.", "If you leave now, they are lost.")}
        onCerrar={() => ocupado !== "guardar" && cerrarSalir()}
        acciones={
          <>
            <button type="button" onClick={cerrarSalir} disabled={ocupado === "guardar"} className={actionBtn}>
              {t("Seguir editando", "Keep editing")}
            </button>
            <button type="button" onClick={salir} disabled={ocupado === "guardar"} className={dangerBtn}>
              {t("Salir sin guardar", "Leave without saving")}
            </button>
            {canWrite && (
              <BotonCargando type="button" cargando={ocupado === "guardar"} onClick={() => void guardarYSalir()} className={primaryBtn}>
                {t("Guardar y salir", "Save and leave")}
              </BotonCargando>
            )}
          </>
        }
      />
    </div>
  );
}
