"use client";

/**
 * Administración de tienda — selectores del editor: productos (con búsqueda y orden), categorías, imagen (subir o elegir de la galería), destino de un botón y
 * fechas de vigencia. Reciben el valor y devuelven el nuevo valor; no guardan nada por su cuenta.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImageIcon, Package, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { formatCop } from "@/lib/business-agent-quote";
import { useI18n } from "@/lib/i18n";
import type { EtapaSubida } from "@/lib/cms-comercial-client";
import type { Destino, Imagen } from "@/lib/cms-comercial/esquemas";
import { mover } from "@/components/dashboard/tienda/borrador";
import { useProductosDe, useTienda } from "@/components/dashboard/tienda/contexto";
import { Aviso, Campo, CampoSelect, CampoTexto, Dialogo, actionBtn, cn, dangerBtn, inputCls } from "@/components/dashboard/tienda/ui";

const precio = (v: number | null) => (v === null ? "Sin precio" : formatCop(v));

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

/** Buscador de productos del catálogo (con pausa al escribir y sin que una respuesta vieja pise a la actual). Elige uno a la vez con «Agregar». */
export function BuscadorProductos({ yaElegidos, onElegir, deshabilitarAgregar, mensajeLleno }: { yaElegidos: readonly string[]; onElegir: (referencia: string) => void; deshabilitarAgregar?: boolean; mensajeLleno?: string }) {
  const { t } = useI18n();
  const { buscarProductos } = useTienda();
  const [consulta, setConsulta] = useState("");
  const [resultados, setResultados] = useState<Awaited<ReturnType<typeof buscarProductos>> | null>(null);
  const idBusqueda = useId();
  const secuencia = useRef(0);

  useEffect(() => {
    const miSecuencia = ++secuencia.current;
    const timer = window.setTimeout(() => {
      void buscarProductos(consulta.trim()).then((r) => {
        if (miSecuencia === secuencia.current) setResultados(r);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [consulta, buscarProductos]);

  return (
    <div>
      <label htmlFor={idBusqueda} className="sr-only">
        {t("Buscar producto por nombre o referencia", "Search product by name or reference")}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" aria-hidden />
        <input id={idBusqueda} value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder={t("Buscar producto por nombre o referencia…", "Search product by name or reference…")} className={cn(inputCls, "pl-9")} />
      </div>
      {resultados?.error && (
        <p role="alert" className="mt-2 text-[12px] text-red-400">
          {resultados.error}
        </p>
      )}
      {resultados && !resultados.error && (
        <ul aria-label={t("Resultados de la búsqueda", "Search results")} className="mt-2 max-h-64 divide-y divide-edge overflow-y-auto rounded-lg border border-edge">
          {resultados.items.length === 0 && <li className="px-3 py-3 text-sm text-mist">{t("Sin resultados.", "No results.")}</li>}
          {resultados.items.map((p) => {
            const ya = yaElegidos.includes(p.referencia);
            return (
              <li key={p.referencia} className="flex items-center gap-3 px-3 py-2">
                <MiniaturaProducto url={p.miniatura} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">{p.nombre}</p>
                  <p className="truncate font-mono text-[11px] text-mist">
                    {p.referencia} · {precio(p.precioDetal)}
                  </p>
                </div>
                <button type="button" disabled={ya || deshabilitarAgregar} onClick={() => onElegir(p.referencia)} className={cn(actionBtn, "shrink-0 px-2.5 py-1.5 text-[13px]")} aria-label={`${t("Agregar", "Add")} ${p.referencia}`}>
                  {ya ? (
                    t("Agregado", "Added")
                  ) : (
                    <>
                      <Plus className="size-3.5" aria-hidden /> {t("Agregar", "Add")}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {deshabilitarAgregar && mensajeLleno && <p className="mt-2 text-[11px] text-amber-400">{mensajeLleno}</p>}
    </div>
  );
}

export function SelectorProductos({ etiqueta, ayuda, referencias, onCambio, max = 24, disabled, ordenable = true }: { etiqueta: string; ayuda?: string; referencias: readonly string[]; onCambio: (nuevas: string[]) => void; max?: number; disabled?: boolean; ordenable?: boolean }) {
  const { t } = useI18n();
  const elegidos = useProductosDe(referencias);
  const llena = referencias.length >= max;

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-mist">
        {etiqueta}{" "}
        <span className="text-mist/70">
          ({referencias.length}/{max})
        </span>
      </p>
      {ayuda && <p className="mb-2 text-[11px] text-mist/80">{ayuda}</p>}

      {elegidos.length > 0 ? (
        <ul className="mb-3 divide-y divide-edge rounded-lg border border-edge">
          {elegidos.map(({ referencia, producto }, i) => (
            <li key={referencia} className="flex items-center gap-3 px-3 py-2">
              <MiniaturaProducto url={producto?.miniatura ?? null} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">{producto ? producto.nombre : referencia}</p>
                <p className="truncate font-mono text-[11px] text-mist">
                  {referencia}
                  {producto && ` · ${precio(producto.precioDetal)}`}
                  {producto && !producto.activo && <span className="ml-1 text-amber-400">· {t("inactivo", "inactive")}</span>}
                </p>
              </div>
              {!disabled && (
                <div className="flex shrink-0 items-center gap-0.5">
                  {ordenable && (
                    <>
                      <button type="button" aria-label={`${t("Subir", "Move up")} ${referencia}`} disabled={i === 0} onClick={() => onCambio(mover(referencias, i, -1))} className="rounded p-1.5 text-mist transition-colors hover:text-fg disabled:opacity-30">
                        <ArrowUp className="size-4" />
                      </button>
                      <button type="button" aria-label={`${t("Bajar", "Move down")} ${referencia}`} disabled={i === elegidos.length - 1} onClick={() => onCambio(mover(referencias, i, 1))} className="rounded p-1.5 text-mist transition-colors hover:text-fg disabled:opacity-30">
                        <ArrowDown className="size-4" />
                      </button>
                    </>
                  )}
                  <button type="button" aria-label={`${t("Quitar", "Remove")} ${referencia}`} onClick={() => onCambio(referencias.filter((r) => r !== referencia))} className="rounded p-1.5 text-mist transition-colors hover:text-red-400">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 rounded-lg border border-dashed border-edge px-3 py-4 text-center text-sm text-mist">{t("Todavía no elegiste productos.", "No products chosen yet.")}</p>
      )}

      {!disabled && <BuscadorProductos yaElegidos={referencias} onElegir={(ref) => !referencias.includes(ref) && !llena && onCambio([...referencias, ref])} deshabilitarAgregar={llena} mensajeLleno={t(`Llegaste al máximo de ${max} productos.`, `You reached the maximum of ${max} products.`)} />}
    </div>
  );
}

function MiniaturaProducto({ url }: { url: string | null }) {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-edge bg-ink text-mist" aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element -- miniatura del catálogo (URL pública de Storage), igual que en el listado de productos */}
      {url ? <img src={url} alt="" className="size-full object-cover" loading="lazy" /> : <Package className="size-4" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------------

export function SelectorCategorias({ etiqueta, ayuda, ids, onCambio, max = 50, disabled, ordenable = false }: { etiqueta: string; ayuda?: string; ids: readonly string[]; onCambio: (nuevos: string[]) => void; max?: number; disabled?: boolean; ordenable?: boolean }) {
  const { t } = useI18n();
  const { contexto } = useTienda();
  const categorias = contexto?.categorias ?? [];
  const nombreDe = (id: string) => categorias.find((c) => c.id === id)?.nombre ?? t("Categoría eliminada", "Deleted category");
  const disponibles = categorias.filter((c) => !ids.includes(c.id));
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-mist">
        {etiqueta} <span className="text-mist/70">({ids.length}/{max})</span>
      </p>
      {ayuda && <p className="mb-2 text-[11px] text-mist/80">{ayuda}</p>}
      {ids.length > 0 ? (
        <ul className="mb-3 flex flex-wrap gap-2">
          {ids.map((id, i) => (
            <li key={id} className="flex items-center gap-1 rounded-full border border-edge bg-ink py-1 pl-3 pr-1 text-sm text-fg">
              <span>{nombreDe(id)}</span>
              {!disabled && (
                <>
                  {ordenable && (
                    <>
                      <button type="button" aria-label={`${t("Subir", "Move up")} ${nombreDe(id)}`} disabled={i === 0} onClick={() => onCambio(mover(ids, i, -1))} className="rounded-full p-1 text-mist hover:text-fg disabled:opacity-30">
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button type="button" aria-label={`${t("Bajar", "Move down")} ${nombreDe(id)}`} disabled={i === ids.length - 1} onClick={() => onCambio(mover(ids, i, 1))} className="rounded-full p-1 text-mist hover:text-fg disabled:opacity-30">
                        <ArrowDown className="size-3.5" />
                      </button>
                    </>
                  )}
                  <button type="button" aria-label={`${t("Quitar", "Remove")} ${nombreDe(id)}`} onClick={() => onCambio(ids.filter((x) => x !== id))} className="rounded-full p-1 text-mist hover:text-red-400">
                    <X className="size-3.5" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-mist">{t("Ninguna categoría elegida.", "No categories chosen.")}</p>
      )}
      {!disabled && disponibles.length > 0 && ids.length < max && (
        <div>
          <p className="mb-1.5 text-[11px] text-mist/80">{t("Toca una categoría para agregarla:", "Tap a category to add it:")}</p>
          <ul className="flex flex-wrap gap-2">
            {disponibles.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onCambio([...ids, c.id])} className="flex items-center gap-1 rounded-full border border-dashed border-edge px-3 py-1 text-sm text-mist transition-colors hover:border-lime/50 hover:text-fg">
                  <Plus className="size-3.5" aria-hidden /> {c.nombre}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!disabled && categorias.length === 0 && contexto && <p className="text-[12px] text-mist">{t("Tu catálogo todavía no tiene categorías.", "Your catalog has no categories yet.")}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Imagen
// ---------------------------------------------------------------------------

const ENFOQUES = [
  { valor: "50% 50%", es: "Centro", en: "Center" },
  { valor: "50% 0%", es: "Arriba", en: "Top" },
  { valor: "50% 100%", es: "Abajo", en: "Bottom" },
  { valor: "0% 50%", es: "Izquierda", en: "Left" },
  { valor: "100% 50%", es: "Derecha", en: "Right" },
  { valor: "72% 50%", es: "Derecha (suave)", en: "Right (soft)" },
] as const;

const ETAPAS: Record<EtapaSubida, [string, string]> = {
  preparando: ["Preparando la imagen…", "Preparing the image…"],
  subiendo: ["Subiendo…", "Uploading…"],
  confirmando: ["Verificando la imagen…", "Checking the image…"],
};

/** URL para MOSTRAR una imagen del contenido: la de la galería (subida) o la estática del repositorio. */
export function useUrlImagen(imagen: Imagen | undefined): string | null {
  const { imagenPorId, cargarImagenes, imagenes } = useTienda();
  const esCms = imagen?.origen === "cms";
  useEffect(() => {
    if (esCms && imagenes === null) void cargarImagenes();
  }, [esCms, imagenes, cargarImagenes]);
  if (!imagen) return null;
  if (imagen.origen === "estatico") return imagen.src;
  return imagenPorId(imagen.asset)?.url ?? null;
}

export function SelectorImagen({ etiqueta, ayuda, imagen, onCambio, disabled, conFoco = false, requerida = false, problema }: { etiqueta: string; ayuda?: string; imagen: Imagen | undefined; onCambio: (nueva: Imagen | undefined) => void; disabled?: boolean; conFoco?: boolean; requerida?: boolean; problema?: string | null }) {
  const { t } = useI18n();
  const { imagenes, errorImagenes, cargarImagenes, subirImagen } = useTienda();
  const url = useUrlImagen(imagen);
  const entrada = useRef<HTMLInputElement>(null);
  const [etapa, setEtapa] = useState<EtapaSubida | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [galeria, setGaleria] = useState(false);
  const alt = imagen?.alt ?? "";

  const elegir = (id: string) => {
    onCambio({ origen: "cms", asset: id, alt: alt || "", ...(imagen?.foco ? { foco: imagen.foco } : {}) } as Imagen);
    setGaleria(false);
  };

  const subir = async (archivo: File | undefined) => {
    if (!archivo) return;
    setError(null);
    const r = await subirImagen(archivo, setEtapa);
    setEtapa(null);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    elegir(r.data.imagen.id);
  };

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-mist">
        {etiqueta}
        {requerida && <span className="ml-0.5 text-red-400" aria-hidden>*</span>}
      </p>
      {ayuda && <p className="mb-2 text-[11px] text-mist/80">{ayuda}</p>}
      {problema && (
        <p role="alert" className="mb-2 text-[12px] text-red-400">
          {problema}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex h-32 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border border-edge bg-ink sm:w-52">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- vista previa de una imagen del negocio (URL pública de Storage o archivo estático)
            <img src={url} alt={alt} className="size-full object-cover" style={imagen?.foco ? { objectPosition: imagen.foco } : undefined} />
          ) : (
            <div className="flex flex-col items-center gap-1 text-mist">
              <ImageIcon className="size-6" aria-hidden />
              <span className="text-[11px]">{imagen ? t("Cargando imagen…", "Loading image…") : t("Sin imagen", "No image")}</span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          {!disabled && (
            <div className="flex flex-wrap gap-2">
              <input ref={entrada} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={t("Archivo de imagen", "Image file")} data-testid="archivo-imagen" onChange={(e) => { void subir(e.target.files?.[0]); e.target.value = ""; }} />
              <button type="button" disabled={etapa !== null} onClick={() => entrada.current?.click()} className={cn(actionBtn, "text-[13px]")}>
                <Upload className="size-4" aria-hidden /> {etapa ? t(ETAPAS[etapa][0], ETAPAS[etapa][1]) : t("Subir imagen", "Upload image")}
              </button>
              <button type="button" onClick={() => { void cargarImagenes(); setGaleria(true); }} className={cn(actionBtn, "text-[13px]")}>
                <ImageIcon className="size-4" aria-hidden /> {t("Elegir de la galería", "Choose from gallery")}
              </button>
              {imagen && (
                <button type="button" onClick={() => onCambio(undefined)} className={cn(dangerBtn, "text-[13px]")}>
                  <Trash2 className="size-4" aria-hidden /> {t("Quitar", "Remove")}
                </button>
              )}
            </div>
          )}
          {error && <Aviso tono="danger">{error}</Aviso>}
          {imagen && (
            <>
              <CampoTexto etiqueta={t("Descripción de la imagen (para accesibilidad)", "Image description (accessibility)")} ayuda={t("Describe lo que se ve, en pocas palabras. Es obligatoria.", "Describe what is shown, briefly. Required.")} valor={alt} onCambio={(v) => onCambio({ ...imagen, alt: v } as Imagen)} maxLength={160} disabled={disabled} requerido />
              {conFoco && (
                <CampoSelect etiqueta={t("Parte de la imagen que se mantiene visible", "Part of the image kept visible")} ayuda={t("Útil cuando la imagen se recorta en el celular.", "Useful when the image is cropped on mobile.")} valor={imagen.foco ?? "50% 50%"} onCambio={(v) => onCambio({ ...imagen, foco: v } as Imagen)} opciones={ENFOQUES.map((o) => ({ valor: o.valor, etiqueta: t(o.es, o.en) }))} disabled={disabled} />
              )}
            </>
          )}
        </div>
      </div>

      <Dialogo abierto={galeria} titulo={t("Galería de imágenes", "Image gallery")} descripcion={t("Elige una imagen que ya subiste.", "Choose an image you already uploaded.")} onCerrar={() => setGaleria(false)} acciones={<button type="button" onClick={() => setGaleria(false)} className={actionBtn}>{t("Cerrar", "Close")}</button>}>
        {imagenes === null && !errorImagenes && <p className="text-sm text-mist">{t("Cargando…", "Loading…")}</p>}
        {errorImagenes && <Aviso tono="danger">{errorImagenes}</Aviso>}
        {imagenes && imagenes.length === 0 && <p className="text-sm text-mist">{t("Todavía no subiste imágenes.", "You haven't uploaded images yet.")}</p>}
        {imagenes && imagenes.length > 0 && (
          <ul className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto">
            {imagenes.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => elegir(i.id)} className="block aspect-square w-full overflow-hidden rounded-lg border border-edge transition-colors hover:border-lime/60" aria-label={`${t("Elegir imagen", "Choose image")} ${i.nombreOriginal ?? i.id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- galería del negocio (URLs públicas de Storage) */}
                  <img src={i.url} alt="" className="size-full object-cover" loading="lazy" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dialogo>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Destino de un botón
// ---------------------------------------------------------------------------

type TipoDestino = Destino["tipo"];
const NINGUNO = "ninguno" as const;
const OPCIONES_DESTINO: ReadonlyArray<{ valor: TipoDestino; etiqueta: string }> = [
  { valor: "catalogo", etiqueta: "Todo el catálogo" },
  { valor: "categoria", etiqueta: "Una categoría" },
  { valor: "busqueda", etiqueta: "Una búsqueda" },
  { valor: "oferta", etiqueta: "Una oferta" },
  { valor: "combo", etiqueta: "Un combo" },
  { valor: "campana", etiqueta: "Una campaña" },
  { valor: "whatsapp", etiqueta: "Escribir por WhatsApp" },
];
const ETIQUETAS_DESTINO_EN: Readonly<Record<TipoDestino, string>> = {
  catalogo: "The whole catalog",
  categoria: "A category",
  busqueda: "A search",
  oferta: "An offer",
  combo: "A combo",
  campana: "A campaign",
  whatsapp: "Message on WhatsApp",
};

/** `opcional`: se puede dejar sin destino (el elemento no se puede tocar). Sin `opcional`, «sin destino» se muestra como «Todo el catálogo». */
export function SelectorDestino({ etiqueta, ayuda, destino, onCambio, disabled, opcional = false }: { etiqueta: string; ayuda?: string; destino: Destino | undefined; onCambio: (d: Destino | undefined) => void; disabled?: boolean; opcional?: boolean }) {
  const { t } = useI18n();
  const { client, contexto } = useTienda();
  const tipo: TipoDestino = destino?.tipo ?? "catalogo";
  const seleccion: TipoDestino | typeof NINGUNO = destino ? destino.tipo : opcional ? NINGUNO : "catalogo";
  const [publicados, setPublicados] = useState<{ tipo: TipoDestino; items: Array<{ clave: string; nombre: string }> } | null>(null);
  const necesitaElementos = tipo === "oferta" || tipo === "combo" || tipo === "campana";

  useEffect(() => {
    if (!necesitaElementos) return;
    let vivo = true;
    void client.listar({ tipo, estado: "publicada" }).then((r) => {
      if (vivo && r.ok) setPublicados({ tipo, items: r.data.items.map((e) => ({ clave: e.clave, nombre: e.nombre })) });
    });
    return () => {
      vivo = false;
    };
  }, [tipo, necesitaElementos, client]);

  const cambiarTipo = (nuevo: TipoDestino | typeof NINGUNO) => {
    if (nuevo === NINGUNO) onCambio(undefined);
    else if (nuevo === "catalogo" || nuevo === "whatsapp") onCambio({ tipo: nuevo });
    else if (nuevo === "busqueda") onCambio({ tipo: "busqueda", consulta: "" });
    else if (nuevo === "categoria") onCambio({ tipo: "categoria", categoria_id: contexto?.categorias[0]?.id ?? "" });
    else onCambio({ tipo: nuevo, clave: "" });
  };

  const elementos = publicados && publicados.tipo === tipo ? publicados.items : null;
  return (
    <div className="space-y-3">
      <CampoSelect
        etiqueta={etiqueta}
        ayuda={ayuda}
        valor={seleccion}
        onCambio={cambiarTipo}
        opciones={[...(opcional ? [{ valor: NINGUNO, etiqueta: t("Ninguno (no se puede tocar)", "None (not clickable)") }] : []), ...OPCIONES_DESTINO.map((o) => ({ valor: o.valor, etiqueta: t(o.etiqueta, ETIQUETAS_DESTINO_EN[o.valor]) }))]}
        disabled={disabled}
      />
      {destino?.tipo === "categoria" && (
        <CampoSelect etiqueta={t("Categoría", "Category")} valor={destino.categoria_id} onCambio={(v) => onCambio({ tipo: "categoria", categoria_id: v })} opciones={(contexto?.categorias ?? []).map((c) => ({ valor: c.id, etiqueta: c.nombre }))} disabled={disabled} />
      )}
      {destino?.tipo === "busqueda" && <CampoTexto etiqueta={t("Texto a buscar", "Search text")} ayuda={t("Lo que se buscará en el catálogo, por ejemplo «anillos».", "What will be searched in the catalog, e.g. “rings”.")} valor={destino.consulta} onCambio={(v) => onCambio({ tipo: "busqueda", consulta: v })} maxLength={60} disabled={disabled} />}
      {(destino?.tipo === "oferta" || destino?.tipo === "combo" || destino?.tipo === "campana") && (
        <>
          <CampoSelect
            etiqueta={destino.tipo === "oferta" ? t("Oferta", "Offer") : destino.tipo === "combo" ? "Combo" : t("Campaña", "Campaign")}
            valor={destino.clave}
            onCambio={(v) => onCambio({ tipo: destino.tipo, clave: v })}
            opciones={(elementos ?? []).map((e) => ({ valor: e.clave, etiqueta: e.nombre }))}
            disabled={disabled || elementos === null}
          />
          {elementos !== null && elementos.length === 0 && <p className="text-[12px] text-amber-400">{t("Todavía no hay nada publicado de este tipo: publícalo primero.", "Nothing of this kind is published yet: publish it first.")}</p>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

/** Una fecha (y hora opcional, que se agrega aparte) en hora de Bogotá, guardada como `YYYY-MM-DD` o `YYYY-MM-DDTHH:mm`. */
export function CampoFecha({ etiqueta, ayuda, valor, onCambio, disabled, requerido, error }: { etiqueta: string; ayuda?: string; valor: string | undefined; onCambio: (v: string | undefined) => void; disabled?: boolean; requerido?: boolean; error?: string | null }) {
  const { t } = useI18n();
  const [fecha, hora = ""] = (valor ?? "").split("T");
  const idFecha = useId();
  const idHora = useId();
  const [pedirHora, setPedirHora] = useState(false);
  const conHora = hora !== "" || pedirHora;
  const poner = (f: string, h: string) => (f ? onCambio(h ? `${f}T${h}` : f) : onCambio(undefined));
  return (
    <div>
      <label htmlFor={idFecha} className="mb-1.5 block text-xs font-medium text-mist">
        {etiqueta}
        {requerido && <span className="ml-0.5 text-red-400" aria-hidden>*</span>}
      </label>
      <input id={idFecha} type="date" value={fecha} onChange={(e) => poner(e.target.value, hora)} disabled={disabled} aria-invalid={error ? true : undefined} className={cn(inputCls, error && "border-red-500/60")} />
      {conHora ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="shrink-0 text-[11px] text-mist" aria-hidden>
            {t("Hora", "Time")}
          </span>
          <input id={idHora} type="time" value={hora} onChange={(e) => poner(fecha, e.target.value)} disabled={disabled || !fecha} aria-label={`${etiqueta} — ${t("hora", "time")}`} className={inputCls} />
          {!disabled && (
            <button
              type="button"
              onClick={() => {
                setPedirHora(false);
                poner(fecha, "");
              }}
              aria-label={`${t("Quitar la hora de", "Remove the time of")} ${etiqueta}`}
              className="shrink-0 rounded p-1.5 text-mist transition-colors hover:text-fg"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      ) : (
        !disabled &&
        fecha !== "" && (
          <button type="button" onClick={() => setPedirHora(true)} className="mt-1.5 text-[11px] text-mist underline-offset-2 hover:text-fg hover:underline">
            {t("Agregar hora", "Add time")}
          </button>
        )
      )}
      {ayuda && !error && <p className="mt-1 text-[11px] text-mist/80">{ayuda}</p>}
      {error && <p role="alert" className="mt-1 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

export type Vigencia = { desde?: string; hasta?: string };

/** Una vigencia sin claves vacías; `undefined` si no queda ninguna fecha (así el borrador no guarda un objeto vacío). */
export function vigenciaLimpia(v: Vigencia): Vigencia | undefined {
  const limpia: Vigencia = {};
  if (v.desde) limpia.desde = v.desde;
  if (v.hasta) limpia.hasta = v.hasta;
  return Object.keys(limpia).length > 0 ? limpia : undefined;
}

/** Devuelve la vigencia ya limpia (o `undefined` si no hay fechas): se puede pasar directo a `poner("vigencia", …)`. */
export function CamposVigencia({ valor, onCambio, disabled, obligatoria, errorDesde, errorHasta }: { valor: Vigencia | undefined; onCambio: (nuevo: Vigencia | undefined) => void; disabled?: boolean; obligatoria?: boolean; errorDesde?: string | null; errorHasta?: string | null }) {
  const { t } = useI18n();
  const v = useMemo(() => valor ?? {}, [valor]);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <CampoFecha etiqueta={t("Desde", "From")} valor={v.desde} onCambio={(d) => onCambio(vigenciaLimpia({ ...v, desde: d }))} disabled={disabled} requerido={obligatoria} error={errorDesde} />
      <CampoFecha etiqueta={t("Hasta", "Until")} ayuda={t("Incluye todo el día elegido. Hora de Bogotá.", "Includes the whole chosen day. Bogotá time.")} valor={v.hasta} onCambio={(d) => onCambio(vigenciaLimpia({ ...v, hasta: d }))} disabled={disabled} requerido={obligatoria} error={errorHasta} />
    </div>
  );
}

export { Campo };
