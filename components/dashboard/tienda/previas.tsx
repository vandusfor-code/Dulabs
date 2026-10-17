"use client";

/**
 * Administración de tienda — VISTA PREVIA de lo que verá el cliente. Los números (precio con oferta, ahorro, precio normal del combo, disponibilidad) salen de las
 * MISMAS funciones que usan la tienda, el pedido y ARIA (lib/cms-comercial/previa.ts → evaluacion.ts): aquí no hay ninguna regla propia.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { CAMPOS_TEXTO_MAYORISTAS, ETIQUETAS_RED, REDES_SOCIALES, type Canal, type RedSocial, type TipoEntidad } from "@/lib/cms-comercial/contrato";
import { usuarioDeRed } from "@/lib/cms-comercial/enlaces";
import { bloquesDeBorrador } from "@/lib/cms-comercial/pagina";
import { textoDerechos } from "@/lib/cms-comercial/pie";
import type { Destino, Imagen } from "@/lib/cms-comercial/esquemas";
import type { MotivoComboNoDisponible } from "@/lib/cms-comercial/evaluacion";
import { previaCombo, previaContenido, previaOferta, textoAlcance, type ProductoPrevia } from "@/lib/cms-comercial/previa";
import { ESPACIOS_VIDEO, type EspacioVideo } from "@/lib/cms-comercial/video-requisitos";
import type { EstadoVigencia } from "@/lib/cms-comercial/tiempo";
import { formatearPesos, type ValoresVariables, type VariableId } from "@/lib/cms-comercial/variables";
import { Pill } from "@/components/dashboard/shell/ui";
import { leer, type Draft } from "@/components/dashboard/tienda/borrador";
import { useProductosDe, useTienda } from "@/components/dashboard/tienda/contexto";
import { NOMBRES_SECCION } from "@/components/dashboard/tienda/formato";
import { seccionesCompletas } from "@/components/dashboard/tienda/formularios";
import { usePaginas } from "@/components/dashboard/tienda/usar-paginas";
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
  const tema = texto(borrador, "tema");
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
          {tema === "mayoristas" && audiencia !== "mayorista" && (
            <p className="text-[11px] text-mist/80">{t("Una vez publicado, también aparece como pregunta en la página «Mayoristas» de tu tienda.", "Once published, it also shows as a question on the “Wholesale” page of your store.")}</p>
          )}
        </>
      )}
    </Marco>
  );
}

// ---------------------------------------------------------------------------
// Pie de página
// ---------------------------------------------------------------------------

type EnlacePrevia = { texto?: string; destino?: { tipo?: string; categoria_id?: string; url?: string; clave?: string } };
type ColumnaPrevia = { titulo?: string; enlaces?: EnlacePrevia[] };

const objetosPrevia = <T,>(v: unknown): T[] => (Array.isArray(v) ? v.filter((x) => typeof x === "object" && x !== null && !Array.isArray(x)) : []) as T[];

/** El dominio de una dirección escrita (para decir «lleva a delacour.co» sin enseñar toda la dirección). */
function dominioDe(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function PreviaPie({ borrador }: { borrador: Draft }) {
  const { t } = useI18n();
  const { contexto } = useTienda();
  const paginas = usePaginas();
  const descripcion = texto(borrador, "descripcion");
  const columnas = objetosPrevia<ColumnaPrevia>(leer(borrador, "columnas"));
  const mostrarCategorias = leer(borrador, "mostrar_categorias") !== false;
  const contacto = leer(borrador, "contacto") as { titulo?: string; whatsapp?: boolean; email?: string; telefono?: string; direccion?: string; horario?: string } | undefined;
  const redes = objetosPrevia<{ red?: string; url?: string }>(leer(borrador, "redes"));
  const derechos = texto(borrador, "derechos");
  const marca = contexto?.tienda?.nombre ?? t("Tu marca", "Your brand");

  const destino = (d: EnlacePrevia["destino"]): string => {
    switch (d?.tipo) {
      case "inicio":
        return t("el inicio", "the home page");
      case "catalogo":
        return t("todo el catálogo", "the whole catalog");
      case "mayoristas":
        return t("Mayoristas", "Wholesale");
      case "categoria":
        return contexto?.categorias.find((c) => c.id === d.categoria_id)?.nombre ?? "—";
      case "whatsapp":
        return "WhatsApp";
      case "pagina":
        return paginas?.find((x) => x.clave === d.clave)?.nombre ?? d.clave ?? "—";
      case "externo":
        return dominioDe(d.url) ?? t("(falta la dirección)", "(address missing)");
      default:
        return "—";
    }
  };
  const lineasContacto = [contacto?.whatsapp !== false && contacto ? t("Escríbenos por WhatsApp", "Write to us on WhatsApp") : null, contacto?.email, contacto?.telefono, ...(contacto?.direccion ? contacto.direccion.split("\n") : []), contacto?.horario].filter((x): x is string => Boolean(x && x.trim()));
  const hayAlgo = Boolean(descripcion) || columnas.length > 0 || mostrarCategorias || lineasContacto.length > 0 || redes.length > 0;

  return (
    <Marco titulo={t("Así se vería el pie de tu tienda", "How your store's footer would look")}>
      <div className="space-y-4 rounded-lg border border-edge bg-ink p-3 text-sm">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fg">{marca}</p>
          {descripcion && <p className="mt-1.5 text-xs text-mist">{descripcion}</p>}
        </div>
        {!hayAlgo && <p className="text-center text-xs text-mist">{t("Todavía no hay nada más que mostrar.", "There is nothing else to show yet.")}</p>}
        <div className="grid grid-cols-2 gap-3 border-t border-edge pt-3">
          {columnas.map((c, i) => (
            <div key={i}>
              <p className="text-[10.5px] font-medium uppercase tracking-widest text-lime">{c.titulo?.trim() || t("(sin título)", "(no title)")}</p>
              <ul className="mt-1.5 space-y-1">
                {objetosPrevia<EnlacePrevia>(c.enlaces).map((e, j) => (
                  <li key={j} className="text-xs text-fg">
                    {e.texto?.trim() || t("(sin texto)", "(no text)")}
                    <span className="block text-[10.5px] text-mist">→ {destino(e.destino)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {mostrarCategorias && (
            <div>
              <p className="text-[10.5px] font-medium uppercase tracking-widest text-lime">{t("Categorías", "Categories")}</p>
              <ul className="mt-1.5 space-y-1">
                {(contexto?.categorias ?? []).slice(0, 3).map((c) => (
                  <li key={c.id} className="text-xs text-fg">
                    {c.nombre}
                  </li>
                ))}
                <li className="text-[10.5px] text-mist">{t("…las de tu catálogo", "…those in your catalog")}</li>
              </ul>
            </div>
          )}
          {lineasContacto.length > 0 && (
            <div>
              <p className="text-[10.5px] font-medium uppercase tracking-widest text-lime">{contacto?.titulo?.trim() || t("Contacto", "Contact")}</p>
              <ul className="mt-1.5 space-y-1">
                {lineasContacto.map((l, i) => (
                  <li key={i} className="break-words text-xs text-fg">
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {redes.length > 0 && (
            <div>
              <p className="text-[10.5px] font-medium uppercase tracking-widest text-lime">{t("Síguenos", "Follow us")}</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {redes.map((r, i) => {
                  const red = r.red && (REDES_SOCIALES as readonly string[]).includes(r.red) ? (r.red as RedSocial) : null;
                  const usuario = red && r.url ? usuarioDeRed(red, r.url) : null;
                  return (
                    <li key={i} className="rounded-full border border-edge px-2 py-0.5 text-[11px] text-fg">
                      {red ? ETIQUETAS_RED[red] : "—"}
                      {usuario && <span className="text-mist"> {usuario}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
        <p className="border-t border-edge pt-2 text-[10.5px] text-mist">{textoDerechos(marca, derechos || null, new Date().getFullYear())}</p>
      </div>
      <p className="text-[11px] text-mist/80">
        {t("Un enlace a una página que hoy no existe en tu tienda (por ejemplo, una categoría que borraste) no aparece. Cuando lo publiques, míralo con «Ver mi tienda».", "A link to a page that doesn't exist in your store today (for example, a category you deleted) isn't shown. Once you publish it, check it with “View my store”.")}
      </p>
    </Marco>
  );
}

// ---------------------------------------------------------------------------
// Página propia de la tienda
// ---------------------------------------------------------------------------

function PreviaPagina({ borrador }: { borrador: Draft }) {
  const { t } = useI18n();
  const { contexto } = useTienda();
  const titulo = texto(borrador, "titulo");
  const bloques = bloquesDeBorrador(leer(borrador, "bloques"));
  const marca = contexto?.tienda?.nombre ?? t("Tu marca", "Your brand");
  const enMenu = leer(borrador, "en_menu") === true;
  const nombreEnMenu = texto(borrador, "texto_menu") || titulo;
  return (
    <Marco titulo={t("Así se vería tu página", "How your page would look")}>
      {enMenu && (
        <p data-testid="previa-menu-pagina" className="flex flex-wrap items-center gap-2 text-[11px] text-fg">
          {t("En el menú de arriba de tu tienda se verá así:", "In your store's top menu it will look like this:")}
          <span className="rounded-full border border-edge px-3 py-1 text-[12px] text-fg">{nombreEnMenu || t("(sin título)", "(no title)")}</span>
        </p>
      )}
      <article className="space-y-3 rounded-lg border border-edge bg-ink p-3 text-sm">
        <header className="space-y-1 text-center">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-mist">{marca}</p>
          <h4 className="break-words text-base font-semibold text-fg">{titulo || t("(sin título)", "(no title)")}</h4>
        </header>
        {bloques.length === 0 ? (
          <p className="text-center text-xs text-mist">{t("Todavía no hay texto.", "There is no text yet.")}</p>
        ) : (
          <div className="space-y-2.5 border-t border-edge pt-3 text-xs leading-relaxed text-fg">
            {bloques.map((b, i) =>
              b.tipo === "subtitulo" ? (
                <h5 key={i} className="break-words pt-1 text-[13px] font-semibold">
                  {b.texto}
                </h5>
              ) : b.tipo === "lista" ? (
                <ul key={i} className="list-disc space-y-1 pl-4">
                  {b.items.map((item, j) => (
                    <li key={j} className="whitespace-pre-line break-words">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p key={i} className="whitespace-pre-line break-words">
                  {b.texto}
                </p>
              ),
            )}
          </div>
        )}
      </article>
      <p className="text-[11px] text-mist/80">
        {t("Solo texto: no se pueden poner enlaces, imágenes ni formato especial dentro de la página. Cuando la publiques, míralo con «Ver la página en mi tienda».", "Text only: you can't put links, images or special formatting inside the page. Once you publish it, check it with “View the page in my store”.")}
      </p>
    </Marco>
  );
}

// ---------------------------------------------------------------------------
// Fotos y videos del inicio
// ---------------------------------------------------------------------------

function PreviaMultimedia({ borrador }: { borrador: Draft }) {
  const { t } = useI18n();
  const { contexto } = useTienda();
  const siempre = contexto?.tienda?.videosDeSiempre ?? {};
  const espacios = ESPACIOS_VIDEO.filter((e) => siempre[e]);
  const refDe = (e: EspacioVideo): { video: string; poster: string } | undefined => {
    const v = leer(borrador, `videos.${e}.horizontal`);
    return typeof v === "object" && v !== null && typeof (v as { poster?: unknown }).poster === "string" ? (v as { video: string; poster: string }) : undefined;
  };
  const eligidas = lista2(leer(borrador, "categorias")).length;
  const total = contexto?.categorias.length ?? 0;
  const textosCambiados = CAMPOS_TEXTO_MAYORISTAS.filter((c) => {
    const v = leer(borrador, `mayoristas.${c}`);
    return typeof v === "string" && v.trim() !== "";
  }).length;
  return (
    <Marco titulo={t("Así quedaría tu inicio", "How your home page would look")}>
      {espacios.length === 0 && eligidas === 0 ? <NoLista motivo={t("Todavía no elegiste nada: tu tienda se ve como siempre.", "You haven't picked anything yet: your store looks as usual.")} /> : null}
      <ul className="space-y-2">
        {espacios.map((e) => {
          const propio = refDe(e);
          const usual = siempre[e]?.horizontal;
          return (
            <li key={e} className="flex items-center gap-3" data-testid={`previa-${e}`}>
              <div className="h-12 w-20 shrink-0 overflow-hidden rounded-md border border-edge bg-ink">
                {propio ? (
                  <Foto imagen={{ origen: "cms", asset: propio.poster, alt: "" } as Imagen} className="size-full" />
                ) : usual ? (
                  // eslint-disable-next-line @next/next/no-img-element -- imagen fija del video de siempre de la tienda (archivo estático)
                  <img src={usual.poster} alt="" className="size-full object-cover" loading="lazy" />
                ) : null}
              </div>
              <div className="min-w-0 text-sm">
                <p className="font-medium text-fg">{t(TITULOS_PREVIA[e].es, TITULOS_PREVIA[e].en)}</p>
                <p className={cn("text-xs", propio ? "text-lime-text" : "text-mist")}>{propio ? t("Tu video", "Your video") : t("El video de siempre", "The usual video")}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-mist" data-testid="previa-categorias">
        {total > 0 ? t(`Categorías con imagen propia: ${eligidas} de ${total}.`, `Categories with their own image: ${eligidas} of ${total}.`) : t("Tu catálogo todavía no tiene categorías.", "Your catalog has no categories yet.")}
      </p>
      {contexto?.tienda?.textosMayoristas ? (
        <p className="text-xs text-mist" data-testid="previa-textos-mayoristas">
          {textosCambiados > 0
            ? t(`Textos de «Compras por mayor» que cambiaste: ${textosCambiados} de ${CAMPOS_TEXTO_MAYORISTAS.length}.`, `“Buy wholesale” texts you changed: ${textosCambiados} of ${CAMPOS_TEXTO_MAYORISTAS.length}.`)
            : t("Los textos de «Compras por mayor» siguen como siempre.", "The “Buy wholesale” texts stay as usual.")}
        </p>
      ) : null}
      <p className="text-[11px] text-mist/80">{t("Los videos y los textos se ven en la tienda cuando publiques. Mira el resultado con «Ver mi tienda».", "The videos and texts show in the store once you publish. Check the result with “View my store”.")}</p>
    </Marco>
  );
}

const TITULOS_PREVIA: Readonly<Record<EspacioVideo, { es: string; en: string }>> = {
  portada: { es: "Portada", en: "Cover" },
  coleccion: { es: "Colección", en: "Collection" },
  marca: { es: "Marca", en: "Brand" },
  mayoristas: { es: "Mayoristas", en: "Wholesale" },
};
const lista2 = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

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
    case "pie":
      return <PreviaPie borrador={borrador} />;
    case "pagina":
      return <PreviaPagina borrador={borrador} />;
    case "multimedia":
      return <PreviaMultimedia borrador={borrador} />;
  }
}
