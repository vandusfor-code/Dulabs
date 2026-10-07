"use client";

/**
 * Administración de tienda — paneles de apoyo del editor: problemas de la revisión, versiones (con restauración) e historial de cambios.
 */
import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Problema, RegistroAuditoria, VersionCms } from "@/lib/cms-comercial/contrato";
import type { EntidadDetalle } from "@/lib/cms-comercial-client";
import { Pill } from "@/components/dashboard/shell/ui";
import { useTienda } from "@/components/dashboard/tienda/contexto";
import { ACCION_CORTA, ACCION_CORTA_EN, fechaHora, objetoDeAuditoria, resumirCambios, type CambioResumido } from "@/components/dashboard/tienda/formato";
import { Aviso, BotonCargando, CampoTexto, Cargando, Dialogo, actionBtn, cn, primaryBtn } from "@/components/dashboard/tienda/ui";

// ---------------------------------------------------------------------------
// Problemas
// ---------------------------------------------------------------------------

function ListaProblemas({ problemas }: { problemas: readonly Problema[] }) {
  return (
    <ul className="mt-1 list-disc space-y-1 pl-4">
      {problemas.map((p) => (
        <li key={`${p.codigo}|${p.campo}|${p.mensaje}`}>{p.mensaje}</li>
      ))}
    </ul>
  );
}

/** Lo que impide publicar (errores) y lo que conviene revisar (advertencias): mensajes claros, sin códigos técnicos. */
export function PanelProblemas({ errores, advertencias }: { errores: readonly Problema[]; advertencias: readonly Problema[] }) {
  const { t } = useI18n();
  if (errores.length === 0 && advertencias.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="panel-problemas">
      {errores.length > 0 && (
        <Aviso tono="danger" titulo={errores.length === 1 ? t("Hay 1 cosa por corregir antes de publicar", "There is 1 thing to fix before publishing") : t(`Hay ${errores.length} cosas por corregir antes de publicar`, `There are ${errores.length} things to fix before publishing`)}>
          <ListaProblemas problemas={errores} />
        </Aviso>
      )}
      {advertencias.length > 0 && (
        <Aviso tono="warning" titulo={t("Para revisar (no impide publicar)", "To review (does not prevent publishing)")}>
          <ListaProblemas problemas={advertencias} />
        </Aviso>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cambios «antes → después»
// ---------------------------------------------------------------------------

export function ListaCambios({ cambios, vacio }: { cambios: readonly CambioResumido[]; vacio?: string }) {
  const { t } = useI18n();
  if (cambios.length === 0) return <p className="text-xs text-mist">{vacio ?? t("Sin cambios.", "No changes.")}</p>;
  return (
    <ul className="space-y-1 text-[13px]" data-testid="lista-cambios">
      {cambios.map((c, i) => (
        <li key={`${i}-${c.campo}`} className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-medium text-fg">{c.campo}:</span>
          <span className="text-mist line-through decoration-mist/60">{c.antes}</span>
          <span aria-hidden className="text-mist">
            →
          </span>
          <span className="sr-only">{t("cambió a", "changed to")}</span>
          <span className="text-fg">{c.despues}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Versiones
// ---------------------------------------------------------------------------

/** `bloqueadoPor`: un texto que explica por qué ahora no se puede restaurar (por ejemplo, hay cambios sin guardar); null = se puede. */
export function PanelVersiones({ id, versionActiva, canWrite, bloqueadoPor = null, onRestaurada }: { id: string; versionActiva: number | null; canWrite: boolean; bloqueadoPor?: string | null; onRestaurada: (entidad: EntidadDetalle, version: number) => void }) {
  const { t } = useI18n();
  const { client, contexto } = useTienda();
  const categorias = contexto?.categorias;
  const [versiones, setVersiones] = useState<VersionCms[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [aRestaurar, setARestaurar] = useState<VersionCms | null>(null);
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [falloRestaurar, setFalloRestaurar] = useState<{ mensaje: string; problemas: Problema[] } | null>(null);

  useEffect(() => {
    let vivo = true;
    void client.versiones(id).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setVersiones([...r.data.versiones].sort((a, b) => b.version - a.version));
        setError(null);
      } else setError(r.error.message);
    });
    return () => {
      vivo = false;
    };
  }, [client, id, versionActiva]);

  const activa = versiones?.find((v) => v.version === versionActiva) ?? null;

  const cerrarDialogo = () => {
    if (enviando) return;
    setARestaurar(null);
    setNota("");
    setFalloRestaurar(null);
  };

  const restaurar = async () => {
    if (!aRestaurar) return;
    setEnviando(true);
    setFalloRestaurar(null);
    const r = await client.restaurar(id, aRestaurar.version, nota.trim() || null);
    setEnviando(false);
    if (!r.ok) {
      setFalloRestaurar({ mensaje: r.error.message, problemas: r.error.problemas ?? [] });
      return;
    }
    setARestaurar(null);
    setNota("");
    onRestaurada(r.data.entidad, r.data.version);
  };

  if (error) return <Aviso tono="danger">{error}</Aviso>;
  if (versiones === null) return <Cargando texto={t("Cargando versiones…", "Loading versions…")} />;
  if (versiones.length === 0) return <p className="rounded-xl border border-dashed border-edge px-4 py-8 text-center text-sm text-mist">{t("Todavía no hay versiones: aparecen cuando publicas.", "No versions yet: they appear when you publish.")}</p>;

  return (
    <div>
      {canWrite && bloqueadoPor && (
        <div className="mb-3">
          <Aviso tono="info">{bloqueadoPor}</Aviso>
        </div>
      )}
      <ul className="divide-y divide-edge rounded-xl border border-edge bg-card" data-testid="lista-versiones">
        {versiones.map((v, i) => {
          const anterior = versiones[i + 1] ?? null;
          const esActiva = v.version === versionActiva;
          return (
            <li key={v.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-fg">
                  {t("Versión", "Version")} {v.version}
                </span>
                {esActiva && <Pill tone="success">{t("En la tienda", "Live")}</Pill>}
                {v.accion === "restaurar" && (
                  <Pill tone="info">
                    {t("Restaurada de la versión", "Restored from version")} {v.restauradaDe}
                  </Pill>
                )}
                <span className="ml-auto text-xs text-mist">{fechaHora(v.createdAt)}</span>
              </div>
              <p className="mt-1 text-xs text-mist">
                {v.creadoPorEtiqueta ?? "—"}
                {v.nota ? ` · «${v.nota}»` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" aria-expanded={abierta === v.version} onClick={() => setAbierta(abierta === v.version ? null : v.version)} className={cn(actionBtn, "px-2.5 py-1.5 text-[13px]")}>
                  {abierta === v.version ? t("Ocultar cambios", "Hide changes") : t("Ver cambios", "See changes")}
                </button>
                {canWrite && !esActiva && (
                  <button type="button" disabled={bloqueadoPor !== null} onClick={() => setARestaurar(v)} className={cn(actionBtn, "px-2.5 py-1.5 text-[13px]")} aria-label={`${t("Restaurar la versión", "Restore version")} ${v.version}`}>
                    <RotateCcw className="size-3.5" aria-hidden /> {t("Restaurar", "Restore")}
                  </button>
                )}
              </div>
              {abierta === v.version && (
                <div className="mt-3 rounded-lg border border-edge bg-ink p-3">
                  <p className="mb-2 text-[11px] uppercase tracking-wide text-mist">{anterior ? `${t("Frente a la versión", "Compared to version")} ${anterior.version}` : t("Primera versión", "First version")}</p>
                  <ListaCambios cambios={resumirCambios(anterior?.contenido ?? null, v.contenido, 14, { categorias })} vacio={t("Sin diferencias con la versión anterior.", "No differences from the previous version.")} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Dialogo
        abierto={aRestaurar !== null}
        titulo={t(`Restaurar la versión ${aRestaurar?.version ?? ""}`, `Restore version ${aRestaurar?.version ?? ""}`)}
        descripcion={t("Se crea una versión nueva con este contenido y pasa a ser la que ve la tienda. Tus versiones anteriores no se borran. Antes se revisa con las reglas de hoy: si algo ya no es válido, no se restaura.", "A new version is created with this content and it becomes the one the store shows. Your earlier versions are kept. It is checked against today's rules first: if something is no longer valid, it is not restored.")}
        onCerrar={cerrarDialogo}
        acciones={
          <>
            <button type="button" onClick={cerrarDialogo} disabled={enviando} className={actionBtn}>
              {t("Cancelar", "Cancel")}
            </button>
            <BotonCargando type="button" cargando={enviando} onClick={() => void restaurar()} className={primaryBtn}>
              {t("Restaurar esta versión", "Restore this version")}
            </BotonCargando>
          </>
        }
      >
        {aRestaurar && (
          <div className="space-y-3">
            <div className="rounded-lg border border-edge bg-ink p-3">
              <p className="mb-2 text-[11px] uppercase tracking-wide text-mist">{t("Lo que cambiaría en la tienda", "What would change in the store")}</p>
              <ListaCambios cambios={resumirCambios(activa?.contenido ?? null, aRestaurar.contenido, 12, { categorias })} vacio={t("Es igual a lo que ya está en la tienda.", "It is the same as what is already in the store.")} />
            </div>
            <CampoTexto etiqueta={t("Nota (opcional)", "Note (optional)")} valor={nota} onCambio={setNota} maxLength={200} placeholder={t("Por qué la restauras", "Why you are restoring it")} />
            {falloRestaurar && (
              <Aviso tono="danger" titulo={falloRestaurar.mensaje}>
                {falloRestaurar.problemas.length > 0 && <ListaProblemas problemas={falloRestaurar.problemas} />}
              </Aviso>
            )}
          </div>
        )}
      </Dialogo>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------

const PAGINA = 20;
/** Acciones cuyo registro guarda el contenido «antes» y «después»: de ahí sale el resumen del cambio. */
const CON_CAMBIOS = new Set(["editar_borrador", "publicar", "restaurar"]);

export function PanelHistorial({ entidadId }: { entidadId?: string }) {
  const { t } = useI18n();
  const { client, contexto } = useTienda();
  const categorias = contexto?.categorias;
  const [registros, setRegistros] = useState<RegistroAuditoria[] | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void client.auditoria({ entidad: entidadId, limite: PAGINA }).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setRegistros(r.data.registros);
        setHayMas(r.data.registros.length >= PAGINA);
        setError(null);
      } else setError(r.error.message);
    });
    return () => {
      vivo = false;
    };
  }, [client, entidadId]);

  const cargarMas = async () => {
    const ultimo = registros?.[registros.length - 1];
    if (!ultimo) return;
    setCargandoMas(true);
    const r = await client.auditoria({ entidad: entidadId, limite: PAGINA, antes: ultimo.id });
    setCargandoMas(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setRegistros((prev) => [...(prev ?? []), ...r.data.registros]);
    setHayMas(r.data.registros.length >= PAGINA);
  };

  if (error && registros === null) return <Aviso tono="danger">{error}</Aviso>;
  if (registros === null) return <Cargando texto={t("Cargando historial…", "Loading history…")} />;
  if (registros.length === 0) return <p className="rounded-xl border border-dashed border-edge px-4 py-8 text-center text-sm text-mist">{t("Todavía no hay movimientos.", "No activity yet.")}</p>;

  return (
    <div>
      {error && <Aviso tono="danger">{error}</Aviso>}
      <ul className="divide-y divide-edge rounded-xl border border-edge bg-card" data-testid="lista-historial">
        {registros.map((r) => {
          const objeto = entidadId ? "" : objetoDeAuditoria(r);
          const cambios = CON_CAMBIOS.has(r.accion) ? resumirCambios(r.antes, r.despues, 4, { categorias }) : [];
          return (
            <li key={r.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm text-fg">
                  <span className="font-medium">{r.actorEtiqueta ?? t("Alguien del equipo", "Someone on the team")}</span> · {t(ACCION_CORTA[r.accion], ACCION_CORTA_EN[r.accion])}
                  {r.version !== null && ` · v${r.version}`}
                </span>
                <span className="ml-auto text-xs text-mist">{fechaHora(r.createdAt)}</span>
              </div>
              {objeto && <p className="mt-0.5 text-xs text-mist">{objeto}</p>}
              {r.nota && <p className="mt-0.5 text-xs text-mist">«{r.nota}»</p>}
              {cambios.length > 0 && (
                <div className="mt-2">
                  <ListaCambios cambios={cambios} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {hayMas && (
        <div className="mt-3 text-center">
          <BotonCargando type="button" cargando={cargandoMas} onClick={() => void cargarMas()} className={actionBtn}>
            {t("Ver movimientos anteriores", "See earlier activity")}
          </BotonCargando>
        </div>
      )}
    </div>
  );
}
