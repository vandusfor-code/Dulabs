"use client";

/**
 * Administración de tienda — VISTA PREVIA de lo que verá el cliente. Los números (precio con oferta, ahorro, precio normal del combo, disponibilidad) salen de las
 * MISMAS funciones que usan la tienda, el pedido y ARIA (lib/cms-comercial/previa.ts → evaluacion.ts): aquí no hay ninguna regla propia.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Canal, TipoEntidad } from "@/lib/cms-comercial/contrato";
import type { Destino, Imagen } from "@/lib/cms-comercial/esquemas";
import type { MotivoComboNoDisponible } from "@/lib/cms-comercial/evaluacion";
import { previaCombo, previaContenido, previaOferta, textoAlcance, type ProductoPrevia } from "@/lib/cms-comercial/previa";
import type { EstadoVigencia } from "@/lib/cms-comercial/tiempo";
import { formatearPesos, type ValoresVariables, type VariableId } from "@/lib/cms-comercial/variables";
import { Pill } from "@/components/dashboard/shell/ui";
import { leer, type Draft } from "@/components/dashboard/tienda/borrador";
import { useProductosDe, useTienda } from "@/components/dashboard/tienda/contexto";
import { NOMBRES_SECCION } from "@/components/dashboard/tienda/formato";
import { seccionesCompletas } from "@/components/dashboard/tienda/formularios";
import { useUrlImagen } from "@/components/dashboard/tienda/selectores";
import { Aviso, cn } from "@/components/dashboard/tienda/ui";

const MOTIVO_COMBO: Record<MotivoComboNoDisponible, [string, string]> = {
  componente_inexistente: ["Un producto del combo ya no existe en el catálogo.", "A product in the combo no longer exists in the catalog."],
  componente_inactivo: ["Un producto del combo está desactivado.", "A product in the combo is deactivated."],
  componente_agotado: ["Un producto del combo está agotado.", "A product in the combo is sold out."],
  stock_insuficiente: ["No hay existencias suficientes de un producto del combo.", "There is not enough stock of a product in the combo."],
};

const texto = (b: Draft, ruta: string): string => {
  const v = leer(b, ruta);
  return typeof v === "string" ? v : "";
};
const lista = (b: Draft, ruta: string): string[] => {
  const v = leer(b, ruta);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};

function useNombreCanal() {
  const { t } = useI18n();
  return (canal: Canal) => (canal === "retail" ? t("Clientes detal", "Retail customers") : t("Clientes mayoristas", "Wholesale customers"));
}

function EstadoVigenciaPill({ estado }: { estado: EstadoVigencia }) {
  const { t } = useI18n();
  if (estado === "vigente") return <Pill tone="success">{t("Vigente ahora", "Active now")}</Pill>;
  if (estado === "programada") return <Pill tone="info">{t("Todavía no empieza", "Not started yet")}</Pill>;
  if (estado === "vencida") return <Pill tone="danger">{t("Ya venció", "Expired")}</Pill>;
  return <Pill tone="neutral">{t("Sin fechas", "No dates")}</Pill>;
}

function Foto({ imagen, className }: { imagen: Imagen | undefined; className?: string }) {
  const url = useUrlImagen(imagen);
  if (!url) {
    return (
      <div className={cn("flex items-center justify-center bg-ink text-mist", className)} aria-hidden>
        <ImageIcon className="size-6" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- vista previa de una imagen del negocio (URL pública de Storage o archivo estático)
    <img src={url} alt={imagen?.alt ?? ""} className={cn("object-cover", className)} style={imagen?.foco ? { objectPosition: imagen.foco } : undefined} />
  );
}

function Marco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-edge bg-card p-4" data-testid="previa">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-widest text-mist">{titulo}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function NoLista({ motivo }: { motivo: string }) {
  return <p className="rounded-lg border border-dashed border-edge px-3 py-6 text-center text-sm text-mist">{motivo}</p>;
}

/** Hacia dónde lleva un botón, en palabras. */
function useTextoDestino() {
  const { t } = useI18n();
  const { contexto } = useTienda();
  return (d: Destino | undefined): string | null => {
    if (!d) return null;
    switch (d.tipo) {
      case "catalogo":
        return t("Lleva a: todo el catálogo", "Leads to: the whole catalog");
      case "categoria":
        return `${t("Lleva a la categoría", "Leads to category")}: ${contexto?.categorias.find((c) => c.id === d.categoria_id)?.nombre ?? "—"}`;
      case "busqueda":
        return `${t("Lleva a la búsqueda", "Leads to the search")}: «${d.consulta}»`;
      case "oferta":
        return `${t("Lleva a la oferta", "Leads to the offer")}: ${d.clave}`;
      case "combo":
        return `${t("Lleva al combo", "Leads to the combo")}: ${d.clave}`;
      case "campana":
        return `${t("Lleva a la campaña", "Leads to the campaign")}: ${d.clave}`;
      case "whatsapp":
        return t("Lleva a: escribir por WhatsApp", "Leads to: message on WhatsApp");
    }
  };
}

function BloquePortada({ etiqueta, titulo, subtitulo, boton, imagen, destino }: { etiqueta?: string; titulo: string; subtitulo?: string; boton?: string; imagen: Imagen | undefined; destino?: Destino }) {
  const { t } = useI18n();
  const textoDestino = useTextoDestino();
  return (
    <div>
      <div className="relative overflow-hidden rounded-xl border border-edge">
        <Foto imagen={imagen} className="h-44 w-full" />
        <div className="absolute inset-0 flex flex-col justify-end gap-1 bg-gradient-to-t from-black/75 via-black/25 to-transparent p-4 text-white">
          {etiqueta && <span className="text-[11px] uppercase tracking-widest opacity-80">{etiqueta}</span>}
          <p className="text-lg font-semibold leading-tight">{titulo || t("(sin título todavía)", "(no title yet)")}</p>
          {subtitulo && <p className="text-xs opacity-90">{subtitulo}</p>}
          {boton && <span className="mt-1 inline-flex w-fit rounded-full bg-white px-3.5 py-1.5 text-xs font-medium text-black">{boton}</span>}
        </div>
      </div>
      {boton && textoDestino(destino) && <p className="mt-1.5 text-[11px] text-mist">{textoDestino(destino)}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

function PreviaHome({ borrador }: { borrador: Draft }) {
  const { t } = useI18n();
  const textoDestino = useTextoDestino();
  const portadaVisible = leer(borrador, "portada.visible") !== false;
  const banner = leer(borrador, "banner") as { visible?: boolean; imagen?: Imagen; destino?: Destino } | undefined;
  const secciones = seccionesCompletas(borrador).filter((s) => s.visible);
  return (
    <Marco titulo={t("Así se vería la página principal", "How the home page would look")}>
      {portadaVisible ? (
        <BloquePortada
          etiqueta={texto(borrador, "portada.etiqueta") || undefined}
          titulo={texto(borrador, "portada.titulo")}
          subtitulo={texto(borrador, "portada.subtitulo") || undefined}
          boton={texto(borrador, "portada.boton.texto") || undefined}
          imagen={leer(borrador, "portada.imagen") as Imagen | undefined}
          destino={leer(borrador, "portada.boton.destino") as Destino | undefined}
        />
      ) : (
        <p className="rounded-lg border border-dashed border-edge px-3 py-4 text-center text-sm text-mist">{t("La portada está oculta.", "The cover is hidden.")}</p>
      )}
      {banner !== undefined && banner.visible !== false && (
        <div>
          <Foto imagen={banner.imagen} className="h-20 w-full rounded-lg border border-edge" />
          {textoDestino(banner.destino) && <p className="mt-1.5 text-[11px] text-mist">{textoDestino(banner.destino)}</p>}
        </div>
      )}
      <div>
        <p className="mb-1.5 text-xs font-medium text-mist">{t("Secciones visibles, en orden", "Visible sections, in order")}</p>
        {secciones.length > 0 ? (
          <ol className="flex flex-wrap gap-2">
            {secciones.map((s, i) => (
              <li key={s.tipo} className="rounded-full border border-edge bg-ink px-3 py-1 text-xs text-fg">
                {i + 1}. {t(NOMBRES_SECCION[s.tipo].es, NOMBRES_SECCION[s.tipo].en)}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-mist">{t("No hay secciones visibles.", "No visible sections.")}</p>
        )}
      </div>
      <p className="text-[11px] text-mist/80">
        {lista(borrador, "categorias_destacadas").length} {t("categorías y", "categories and")} {lista(borrador, "productos_destacados").length} {t("productos destacados.", "featured products.")}
      </p>
    </Marco>
  );
}

// ---------------------------------------------------------------------------
// Oferta
// ---------------------------------------------------------------------------

/** Productos de ejemplo: los que la oferta nombra y, para completar, los más recientes del catálogo. */
function useMuestra(referencias: readonly string[]): ProductoPrevia[] {
  const { buscarProductos } = useTienda();
  const elegidos = useProductosDe(referencias);
  const [recientes, setRecientes] = useState<ProductoPrevia[] | null>(null);
  useEffect(() => {
    let vivo = true;
    void buscarProductos("").then((r) => {
      if (vivo && !r.error) setRecientes(r.items);
    });
    return () => {
      vivo = false;
    };
  }, [buscarProductos]);
  return useMemo(() => {
    const vistos = new Set<string>();
    const salida: ProductoPrevia[] = [];
    for (const p of [...elegidos.map((e) => e.producto).filter((p): p is NonNullable<typeof p> => p !== undefined), ...(recientes ?? [])]) {
      if (vistos.has(p.referencia)) continue;
      vistos.add(p.referencia);
      salida.push(p);
      if (salida.length >= 12) break;
    }
    return salida;
  }, [elegidos, recientes]);
}

function PreviaOfertaUi({ borrador }: { borrador: Draft }) {
  const { t } = useI18n();
  const { contexto } = useTienda();
  const nombreCanal = useNombreCanal();
  const muestra = useMuestra(lista(borrador, "alcance.referencias").slice(0, 6));
  const ahora = contexto ? Date.parse(contexto.ahora) : null;
  const previa = useMemo(() => (ahora === null ? null : previaOferta(borrador, muestra, ahora)), [borrador, muestra, ahora]);
  const alcance = textoAlcance(leer(borrador, "alcance") as { todos?: boolean; referencias?: unknown[]; categorias?: unknown[] } | undefined);

  return (
    <Marco titulo={t("Así lo verá el cliente", "How the customer will see it")}>
      {previa === null ? (
        <NoLista motivo={t("Cargando…", "Loading…")} />
      ) : !previa.lista ? (
        <NoLista motivo={previa.motivo} />
      ) : (
        <>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold text-fg">{previa.nombre}</p>
              <EstadoVigenciaPill estado={previa.estadoVigencia} />
            </div>
            {previa.descripcion && <p className="text-sm text-mist">{previa.descripcion}</p>}
            <ul className="text-sm text-fg">
              {previa.textosBeneficio.map((b) => (
                <li key={b.canal}>
                  <span className="text-mist">{nombreCanal(b.canal)}:</span> {b.texto}
                </li>
              ))}
            </ul>
            {previa.textoVigencia && <p className="text-xs text-mist">{previa.textoVigencia}</p>}
            {previa.condiciones && <p className="text-xs text-mist">{previa.condiciones}</p>}
            <p className="text-xs text-mist">
              {t("Aplica a", "Applies to")}: {alcance}
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-mist">{t("Ejemplos de precio", "Price examples")}</p>
            {previa.ejemplos.length > 0 ? (
              <ul className="divide-y divide-edge rounded-lg border border-edge" data-testid="ejemplos-precio">
                {previa.ejemplos.map((e) => (
                  <li key={`${e.producto.referencia}-${e.canal}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate text-fg">{e.producto.nombre}</p>
                      <p className="text-[11px] text-mist">{nombreCanal(e.canal)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[12px] text-mist line-through">{formatearPesos(e.precioLista)}</p>
                      <p className="font-semibold text-fg">{formatearPesos(e.precioFinal)}</p>
                      <p className="text-[11px] text-lime-text">
                        {t("Ahorra", "Saves")} {formatearPesos(e.ahorro)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-edge px-3 py-3 text-sm text-mist">{t("Todavía no hay productos de ejemplo a los que esta oferta les cambie el precio. Elige productos o categorías para verlo.", "There are no example products whose price this offer changes yet. Choose products or categories to see it.")}</p>
            )}
            {previa.sinEfecto.length > 0 && <p className="mt-1.5 text-[11px] text-amber-400">{t("No cambia el precio de:", "Does not change the price of:")} {previa.sinEfecto.map((p) => p.nombre).join(", ")}</p>}
          </div>
          <p className="text-[11px] text-mist/80">{t("Es el mismo cálculo que usan la tienda, el carrito, el pedido y ARIA: el precio que ves aquí es el que se cobra.", "It is the same calculation used by the store, cart, order and ARIA: the price you see here is the price charged.")}</p>
        </>
      )}
    </Marco>
  );
}

// ---------------------------------------------------------------------------
// Combo
// ---------------------------------------------------------------------------

function PreviaComboUi({ borrador }: { borrador: Draft }) {
  const { t } = useI18n();
  const { contexto } = useTienda();
  const nombreCanal = useNombreCanal();
  const referencias = (Array.isArray(leer(borrador, "componentes")) ? (leer(borrador, "componentes") as Array<{ referencia?: unknown }>) : []).map((c) => c.referencia).filter((r): r is string => typeof r === "string");
  const elegidos = useProductosDe(referencias);
  const productos = useMemo(() => elegidos.map((e) => e.producto).filter((p): p is NonNullable<typeof p> => p !== undefined), [elegidos]);
  const ahora = contexto ? Date.parse(contexto.ahora) : null;
  const previa = useMemo(() => (ahora === null ? null : previaCombo(borrador, productos, ahora)), [borrador, productos, ahora]);

  return (
    <Marco titulo={t("Así lo verá el cliente", "How the customer will see it")}>
      {previa === null ? (
        <NoLista motivo={t("Cargando…", "Loading…")} />
      ) : !previa.lista ? (
        <NoLista motivo={previa.motivo} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-fg">{previa.nombre}</p>
            <EstadoVigenciaPill estado={previa.estadoVigencia} />
          </div>
          {previa.descripcion && <p className="text-sm text-mist">{previa.descripcion}</p>}
          {previa.textoVigencia && <p className="text-xs text-mist">{previa.textoVigencia}</p>}
          {previa.porCanal.map(({ canal, vista }) => (
            <div key={canal} className="rounded-lg border border-edge p-3" data-testid={`combo-${canal}`}>
              <p className="mb-2 text-xs font-medium text-mist">{nombreCanal(canal)}</p>
              {vista === null ? (
                <p className="text-sm text-mist">{t("Falta el precio del combo para este canal.", "The combo price for this channel is missing.")}</p>
              ) : (
                <div className="space-y-2">
                  <ul className="text-sm text-fg">
                    {vista.componentes.map((c) => (
                      <li key={c.referencia} className={cn(!c.disponible && "text-amber-400")}>
                        {c.cantidad} × {c.nombre ?? c.referencia}
                        {c.precioUnitario !== null && <span className="text-mist"> · {formatearPesos(c.precioUnitario)} c/u</span>}
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    {vista.precioNormal !== null && <span className="text-sm text-mist line-through">{formatearPesos(vista.precioNormal)}</span>}
                    <span className="text-lg font-semibold text-fg">{formatearPesos(vista.precioCombo)}</span>
                    {vista.ahorro !== null ? (
                      <span className="text-xs text-lime-text">
                        {t("Ahorra", "Saves")} {formatearPesos(vista.ahorro)}
                      </span>
                    ) : (
                      vista.precioNormal !== null && <span className="text-xs text-amber-400">{t("No ahorra frente a comprar por separado.", "No savings versus buying separately.")}</span>
                    )}
                  </div>
                  {vista.disponible ? <Pill tone="success">{vista.unidadesDisponibles === null ? t("Disponible", "Available") : `${t("Disponible", "Available")} · ${vista.unidadesDisponibles} ${t("combos", "combos")}`}</Pill> : <Pill tone="warning">{vista.motivoNoDisponible ? t(MOTIVO_COMBO[vista.motivoNoDisponible][0], MOTIVO_COMBO[vista.motivoNoDisponible][1]) : t("No disponible", "Unavailable")}</Pill>}
                </div>
              )}
            </div>
          ))}
          <p className="text-[11px] text-mist/80">{t("El precio normal y la disponibilidad los calcula el sistema. El combo se muestra y ARIA lo informa; la venta la cierra una asesora.", "The regular price and availability are calculated by the system. The combo is shown and ARIA reports it; an advisor closes the sale.")}</p>
        </>
      )}
    </Marco>
  );
}

// ---------------------------------------------------------------------------
// Campaña
// ---------------------------------------------------------------------------

function PreviaCampana({ borrador }: { borrador: Draft }) {
  const { t } = useI18n();
  const { contexto } = useTienda();
  const ahora = contexto ? Date.parse(contexto.ahora) : null;
  const tienePortada = leer(borrador, "portada") !== undefined;
  const vigencia = leer(borrador, "vigencia") as { desde?: string; hasta?: string } | undefined;
  return (
    <Marco titulo={t("Así se vería el bloque de la campaña", "How the campaign block would look")}>
      {tienePortada ? (
        <BloquePortada
          etiqueta={texto(borrador, "portada.etiqueta") || undefined}
          titulo={texto(borrador, "portada.titulo")}
          subtitulo={texto(borrador, "portada.subtitulo") || undefined}
          boton={texto(borrador, "portada.boton.texto") || undefined}
          imagen={(leer(borrador, "portada.imagen") ?? leer(borrador, "imagen")) as Imagen | undefined}
          destino={leer(borrador, "portada.boton.destino") as Destino | undefined}
        />
      ) : (
        <p className="rounded-lg border border-dashed border-edge px-3 py-4 text-center text-sm text-mist">{t("Esta campaña no muestra un bloque en la página principal (solo agrupa ofertas y combos).", "This campaign shows no block on the home page (it only groups offers and combos).")}</p>
      )}
      {vigencia && ahora !== null && (
        <p className="text-xs text-mist">
          {vigencia.desde ?? "—"} → {vigencia.hasta ?? "—"} · {t("Hora de Bogotá", "Bogotá time")}
        </p>
      )}
      <p className="text-[11px] text-mist/80">{t("Mientras la campaña no esté activa, sus ofertas y combos tampoco se aplican.", "While the campaign is not active, its offers and combos don't apply either.")}</p>
    </Marco>
  );
}

// ---------------------------------------------------------------------------
// Contenido
// ---------------------------------------------------------------------------

function PreviaContenidoUi({ borrador }: { borrador: Draft }) {
  const { t } = useI18n();
  const { contexto } = useTienda();
  const valores = useMemo<ValoresVariables>(() => {
    const v: Partial<Record<VariableId, string>> = {};
    for (const x of contexto?.variables ?? []) if (x.valor !== null) v[x.id] = x.valor;
    return v;
  }, [contexto]);
  const previa = useMemo(() => previaContenido(borrador, valores), [borrador, valores]);
  const audiencia = texto(borrador, "audiencia") || "todos";
  return (
    <Marco titulo={t("Así lo recibirá el cliente", "How the customer will receive it")}>
      {!previa.lista ? (
        <NoLista motivo={previa.motivo} />
      ) : (
        <>
          <div className="rounded-lg border border-edge bg-ink p-3">
            <p className="text-sm font-medium text-fg">{previa.titulo}</p>
            <p className="mt-1 whitespace-pre-line text-sm text-mist">{previa.texto}</p>
          </div>
          {previa.sinValor.length > 0 && <Aviso tono="warning">{t("Este texto usa datos del negocio que todavía no están configurados:", "This text uses business data that is not configured yet:")} {previa.sinValor.join(", ")}.</Aviso>}
          {previa.desconocidas.length > 0 && <Aviso tono="danger">{t("Este texto usa datos que no existen:", "This text uses data that does not exist:")} {previa.desconocidas.join(", ")}.</Aviso>}
          <p className="text-[11px] text-mist/80">
            {audiencia === "mayorista" ? t("Solo lo recibirán clientes mayoristas.", "Only wholesale customers will receive it.") : audiencia === "detal" ? t("Solo lo recibirán clientes detal.", "Only retail customers will receive it.") : t("Lo recibirá cualquier cliente.", "Any customer will receive it.")}{" "}
            {t("ARIA solo lo usará una vez publicado y vigente.", "ARIA will only use it once published and active.")}
          </p>
        </>
      )}
    </Marco>
  );
}

// ---------------------------------------------------------------------------

export function PanelPrevia({ tipo, borrador }: { tipo: TipoEntidad; borrador: Draft }) {
  switch (tipo) {
    case "home":
      return <PreviaHome borrador={borrador} />;
    case "oferta":
      return <PreviaOfertaUi borrador={borrador} />;
    case "combo":
      return <PreviaComboUi borrador={borrador} />;
    case "campana":
      return <PreviaCampana borrador={borrador} />;
    case "contenido":
      return <PreviaContenidoUi borrador={borrador} />;
  }
}
