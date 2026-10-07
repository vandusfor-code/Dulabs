"use client";

/**
 * Administración de tienda — los formularios de cada tipo de contenido: página principal, oferta, combo, campaña y contenido comercial.
 * Todos editan un BORRADOR (un objeto JSON, posiblemente incompleto) con `poner(ruta, valor)`; ninguno guarda ni valida por su cuenta: lo hace el editor.
 * `poner` compone cambios seguidos (cada llamada parte del resultado de la anterior), así que un campo puede cambiar varias rutas a la vez.
 */
import { useEffect, useId, useState } from "react";
import { ArrowDown, ArrowUp, Minus, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ETIQUETAS_TEMA, SECCIONES_HOME, TEMAS_CONTENIDO, type Modalidad, type Problema, type SeccionHome, type TemaContenido } from "@/lib/cms-comercial/contrato";
import { MAX_PORCENTAJE, type Destino, type Imagen } from "@/lib/cms-comercial/esquemas";
import { SECCIONES_POR_DEFECTO, aNumero, leer, mover, type Draft } from "@/components/dashboard/tienda/borrador";
import { useProductosDe, useTienda } from "@/components/dashboard/tienda/contexto";
import { NOMBRES_SECCION } from "@/components/dashboard/tienda/formato";
import { BuscadorProductos, CamposVigencia, SelectorCategorias, SelectorDestino, SelectorImagen, SelectorProductos, type Vigencia } from "@/components/dashboard/tienda/selectores";
import { Campo, CampoArea, CampoSelect, CampoTexto, Interruptor, Segmentado, Tarjeta, actionBtn, cn, inputCls } from "@/components/dashboard/tienda/ui";

export interface FormProps {
  borrador: Draft;
  poner: (ruta: string, valor: unknown) => void;
  disabled: boolean;
  /** Problemas de la última revisión (errores y advertencias): los errores se muestran junto a su campo. */
  problemas: readonly Problema[];
}

const errorEn = (problemas: readonly Problema[], campo: string): string | null => problemas.find((p) => p.severidad === "error" && p.campo === campo)?.mensaje ?? null;
const texto = (b: Draft, ruta: string): string => {
  const v = leer(b, ruta);
  return typeof v === "string" ? v : "";
};
const lista = (b: Draft, ruta: string): string[] => {
  const v = leer(b, ruta);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};
const vigenciaDe = (b: Draft): Vigencia | undefined => {
  const v = leer(b, "vigencia");
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Vigencia) : undefined;
};
const canalesDe = (m: unknown): Array<"detal" | "mayorista"> => (m === "detal" ? ["detal"] : m === "mayorista" ? ["mayorista"] : ["detal", "mayorista"]);

/** Número escrito por la administradora; el vacío QUITA el valor. Los pesos se muestran con puntos de miles. */
function CampoNumero({ etiqueta, ayuda, valor, onCambio, sufijo, pesos = false, error, disabled, requerido }: { etiqueta: string; ayuda?: string; valor: unknown; onCambio: (n: number | undefined) => void; sufijo?: string; pesos?: boolean; error?: string | null; disabled?: boolean; requerido?: boolean }) {
  const id = useId();
  const mostrado = typeof valor === "number" && Number.isFinite(valor) ? (pesos ? valor.toLocaleString("es-CO") : String(valor)) : "";
  return (
    <Campo id={id} etiqueta={etiqueta} ayuda={ayuda} error={error} requerido={requerido}>
      <div className="relative">
        {pesos && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-mist">$</span>}
        <input id={id} type="text" inputMode="numeric" value={mostrado} onChange={(e) => onCambio(aNumero(e.target.value))} disabled={disabled} aria-invalid={error ? true : undefined} className={cn(inputCls, sufijo && "pr-9", pesos && "pl-7", error && "border-red-500/60")} />
        {sufijo && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-mist">{sufijo}</span>}
      </div>
    </Campo>
  );
}

function SelectorModalidad({ valor, onCambio, disabled }: { valor: Modalidad | ""; onCambio: (m: Modalidad) => void; disabled: boolean }) {
  const { t } = useI18n();
  return (
    <Segmentado
      etiqueta={t("¿A qué clientes les sirve?", "Which customers is it for?")}
      ayuda={t("Detal: clientes del catálogo normal. Mayorista: clientes con acceso al catálogo mayorista. Un cliente detal nunca ve lo mayorista.", "Retail: regular catalog customers. Wholesale: customers with wholesale access. Retail customers never see wholesale content.")}
      valor={valor}
      onCambio={onCambio}
      disabled={disabled}
      opciones={[
        { valor: "detal", etiqueta: t("Detal", "Retail") },
        { valor: "mayorista", etiqueta: t("Mayorista", "Wholesale") },
        { valor: "ambas", etiqueta: t("Ambas", "Both") },
      ]}
    />
  );
}

/** Cambia la modalidad y quita los valores de un canal que ya no aplica (si no, quedarían ocultos y la revisión pediría quitarlos sin que se vea dónde). */
function cambiarModalidad(poner: FormProps["poner"], modalidad: Modalidad, rutaValores: "beneficio" | "precio") {
  poner("modalidad", modalidad);
  if (modalidad === "detal") poner(`${rutaValores}.mayorista`, undefined);
  if (modalidad === "mayorista") poner(`${rutaValores}.detal`, undefined);
}

const SIN_CAMPANA = "__sin_campana__";

function SelectorCampana({ valor, onCambio, disabled }: { valor: string; onCambio: (clave: string) => void; disabled: boolean }) {
  const { t } = useI18n();
  const { client } = useTienda();
  const [campanas, setCampanas] = useState<Array<{ clave: string; nombre: string; estado: string }> | null>(null);
  useEffect(() => {
    let vivo = true;
    void client.listar({ tipo: "campana" }).then((r) => {
      if (vivo && r.ok) setCampanas(r.data.items.map((c) => ({ clave: c.clave, nombre: c.nombre, estado: c.estado })));
    });
    return () => {
      vivo = false;
    };
  }, [client]);
  const opciones = [{ valor: SIN_CAMPANA, etiqueta: t("Ninguna (vale por sí sola)", "None (stands on its own)") }, ...(campanas ?? []).map((c) => ({ valor: c.clave, etiqueta: c.estado === "publicada" ? c.nombre : `${c.nombre} (${c.estado})` }))];
  if (valor && !opciones.some((o) => o.valor === valor)) opciones.push({ valor, etiqueta: valor });
  return (
    <CampoSelect
      etiqueta={t("Campaña", "Campaign")}
      ayuda={t("Si pertenece a una campaña, solo vale mientras la campaña esté activa.", "If it belongs to a campaign, it only applies while the campaign is active.")}
      valor={valor || SIN_CAMPANA}
      onCambio={(v) => onCambio(v === SIN_CAMPANA ? "" : v)}
      opciones={opciones}
      disabled={disabled || campanas === null}
    />
  );
}

/** Texto y destino de un botón (portada o campaña). Sin texto no hay botón; con texto, el destino arranca en «Todo el catálogo». */
function FilaBoton({ prefijo, borrador, poner, disabled, problemas }: FormProps & { prefijo: string }) {
  const { t } = useI18n();
  const actual = leer(borrador, prefijo) as { texto?: string; destino?: Destino } | undefined;
  const cambiarTexto = (v: string) => {
    if (v === "") poner(prefijo, undefined);
    else poner(prefijo, { ...(actual ?? {}), texto: v, destino: actual?.destino ?? { tipo: "catalogo" } });
  };
  return (
    <div className="space-y-4">
      <CampoTexto etiqueta={t("Texto del botón", "Button text")} ayuda={t("Déjalo vacío si no quieres botón.", "Leave empty for no button.")} valor={actual?.texto ?? ""} onCambio={cambiarTexto} maxLength={30} disabled={disabled} error={errorEn(problemas, `${prefijo}.texto`)} />
      {actual?.texto && <SelectorDestino etiqueta={t("¿A dónde lleva?", "Where does it lead?")} destino={actual.destino} onCambio={(d) => poner(`${prefijo}.destino`, d)} disabled={disabled} />}
      {errorEn(problemas, `${prefijo}.destino`) && (
        <p role="alert" className="text-[12px] text-red-400">
          {errorEn(problemas, `${prefijo}.destino`)}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

type SeccionBorrador = { tipo: SeccionHome; visible: boolean };

/** Las secciones guardadas (en su orden) y, al final y ocultas, las que todavía no están en la lista. */
export function seccionesCompletas(borrador: Draft): SeccionBorrador[] {
  const guardadas = leer(borrador, "secciones");
  const base = (Array.isArray(guardadas) ? (guardadas as SeccionBorrador[]) : SECCIONES_POR_DEFECTO).filter((s) => (SECCIONES_HOME as readonly string[]).includes(s.tipo));
  const faltantes = SECCIONES_HOME.filter((tipo) => !base.some((s) => s.tipo === tipo));
  return [...base.map((s) => ({ tipo: s.tipo, visible: s.visible === true })), ...faltantes.map((tipo) => ({ tipo, visible: false }))];
}

export function FormHome(p: FormProps) {
  const { t } = useI18n();
  const { borrador, poner, disabled, problemas } = p;
  const banner = leer(borrador, "banner") as { visible?: boolean; imagen?: Imagen; destino?: Destino } | undefined;
  const bannerVisible = banner !== undefined && banner.visible !== false;
  const secciones = seccionesCompletas(borrador);
  const nombre = (tipo: SeccionHome) => t(NOMBRES_SECCION[tipo].es, NOMBRES_SECCION[tipo].en);

  return (
    <div className="space-y-5">
      <Tarjeta titulo={t("Portada", "Cover")} descripcion={t("Lo primero que ve el cliente al entrar a tu tienda.", "The first thing customers see when they open your store.")}>
        <Interruptor etiqueta={t("Mostrar la portada", "Show the cover")} valor={leer(borrador, "portada.visible") !== false} onCambio={(v) => poner("portada.visible", v)} disabled={disabled} />
        <SelectorImagen
          etiqueta={t("Imagen de la portada", "Cover image")}
          ayuda={t("Una foto horizontal. El texto va aparte (no lo escribas dentro de la imagen).", "A landscape photo. Text goes separately (don't write it inside the image).")}
          imagen={leer(borrador, "portada.imagen") as Imagen | undefined}
          onCambio={(i) => poner("portada.imagen", i)}
          disabled={disabled}
          conFoco
          problema={errorEn(problemas, "portada.imagen")}
        />
        <CampoTexto etiqueta={t("Frase pequeña sobre el título", "Small line above the title")} valor={texto(borrador, "portada.etiqueta")} onCambio={(v) => poner("portada.etiqueta", v)} maxLength={40} disabled={disabled} error={errorEn(problemas, "portada.etiqueta")} />
        <CampoTexto etiqueta={t("Título", "Title")} valor={texto(borrador, "portada.titulo")} onCambio={(v) => poner("portada.titulo", v)} maxLength={90} disabled={disabled} requerido error={errorEn(problemas, "portada.titulo")} />
        <CampoTexto etiqueta={t("Subtítulo", "Subtitle")} valor={texto(borrador, "portada.subtitulo")} onCambio={(v) => poner("portada.subtitulo", v)} maxLength={200} disabled={disabled} error={errorEn(problemas, "portada.subtitulo")} />
        <FilaBoton prefijo="portada.boton" {...p} />
      </Tarjeta>

      <Tarjeta titulo={t("Banner", "Banner")} descripcion={t("Una imagen ancha que invita a una oferta, una categoría o un regalo.", "A wide image inviting to an offer, a category or a gift.")}>
        <Interruptor
          etiqueta={t("Mostrar un banner", "Show a banner")}
          valor={bannerVisible}
          onCambio={(v) => {
            if (v) poner("banner", { ...(banner ?? {}), visible: true });
            else if (banner?.imagen) poner("banner.visible", false); // se conserva la imagen por si lo vuelve a activar
            else poner("banner", undefined);
          }}
          disabled={disabled}
        />
        {banner !== undefined && (
          <>
            <SelectorImagen etiqueta={t("Imagen del banner", "Banner image")} imagen={banner.imagen} onCambio={(i) => poner("banner.imagen", i)} disabled={disabled} requerida problema={errorEn(problemas, "banner.imagen")} />
            <SelectorDestino etiqueta={t("Al tocarlo lleva a…", "Tapping it leads to…")} destino={banner.destino} onCambio={(d) => poner("banner.destino", d)} disabled={disabled} opcional />
          </>
        )}
      </Tarjeta>

      <Tarjeta titulo={t("Orden de las secciones", "Section order")} descripcion={t("Elige qué se muestra y en qué orden aparece en la página principal.", "Choose what is shown and in what order on the home page.")}>
        <ul className="divide-y divide-edge rounded-lg border border-edge">
          {secciones.map((s, i) => (
            <li key={s.tipo} className="flex items-center gap-3 px-3 py-2">
              <span className={cn("min-w-0 flex-1 text-sm", s.visible ? "text-fg" : "text-mist")}>{nombre(s.tipo)}</span>
              {!disabled && (
                <>
                  <button type="button" aria-label={`${t("Subir", "Move up")} ${nombre(s.tipo)}`} disabled={i === 0} onClick={() => poner("secciones", mover(secciones, i, -1))} className="rounded p-1.5 text-mist hover:text-fg disabled:opacity-30">
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" aria-label={`${t("Bajar", "Move down")} ${nombre(s.tipo)}`} disabled={i === secciones.length - 1} onClick={() => poner("secciones", mover(secciones, i, 1))} className="rounded p-1.5 text-mist hover:text-fg disabled:opacity-30">
                    <ArrowDown className="size-4" />
                  </button>
                </>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={s.visible}
                aria-label={`${t("Mostrar", "Show")} ${nombre(s.tipo)}`}
                disabled={disabled}
                onClick={() =>
                  poner(
                    "secciones",
                    secciones.map((x) => (x.tipo === s.tipo ? { ...x, visible: !x.visible } : x)),
                  )
                }
                className={cn("relative h-6 w-11 shrink-0 rounded-full border border-edge transition-colors disabled:opacity-60", s.visible ? "bg-lime" : "bg-ink")}
              >
                <span className={cn("absolute top-0.5 size-4.5 rounded-full transition-all", s.visible ? "left-[1.375rem] bg-lime-fg" : "left-0.5 bg-mist")} />
              </button>
            </li>
          ))}
        </ul>
      </Tarjeta>

      <Tarjeta titulo={t("Categorías destacadas", "Featured categories")} descripcion={t("Si no eliges ninguna, se muestran todas.", "If you pick none, all are shown.")}>
        <SelectorCategorias etiqueta={t("Categorías", "Categories")} ids={lista(borrador, "categorias_destacadas")} onCambio={(ids) => poner("categorias_destacadas", ids)} max={12} disabled={disabled} ordenable />
      </Tarjeta>

      <Tarjeta titulo={t("Productos destacados", "Featured products")} descripcion={t("Si no eliges ninguno, se muestran los más recientes con foto.", "If you pick none, the most recent with a photo are shown.")}>
        <SelectorProductos etiqueta={t("Productos", "Products")} referencias={lista(borrador, "productos_destacados")} onCambio={(refs) => poner("productos_destacados", refs)} max={24} disabled={disabled} />
      </Tarjeta>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Oferta
// ---------------------------------------------------------------------------

export function FormOferta(p: FormProps) {
  const { t } = useI18n();
  const { borrador, poner, disabled, problemas } = p;
  const modalidad = (leer(borrador, "modalidad") as Modalidad | undefined) ?? "ambas";
  const tipoBeneficio = (leer(borrador, "beneficio.tipo") as string | undefined) ?? "porcentaje";
  const todos = leer(borrador, "alcance.todos") === true;
  const nombreCanal = (canal: "detal" | "mayorista") => (canal === "detal" ? t("clientes detal", "retail customers") : t("clientes mayoristas", "wholesale customers"));
  return (
    <div className="space-y-5">
      <Tarjeta titulo={t("Datos de la oferta", "Offer details")}>
        <CampoTexto etiqueta={t("Nombre", "Name")} ayuda={t("Así la verán tus clientes, por ejemplo «Amor y Amistad».", "How customers will see it, e.g. “Valentine's”.")} valor={texto(borrador, "nombre")} onCambio={(v) => poner("nombre", v)} maxLength={80} disabled={disabled} requerido error={errorEn(problemas, "nombre")} />
        <CampoArea etiqueta={t("Descripción", "Description")} valor={texto(borrador, "descripcion")} onCambio={(v) => poner("descripcion", v)} maxLength={600} filas={3} disabled={disabled} error={errorEn(problemas, "descripcion")} />
        <SelectorImagen etiqueta={t("Imagen (opcional)", "Image (optional)")} imagen={leer(borrador, "imagen") as Imagen | undefined} onCambio={(i) => poner("imagen", i)} disabled={disabled} problema={errorEn(problemas, "imagen")} />
      </Tarjeta>

      <Tarjeta titulo={t("Para quién", "Who is it for")}>
        <SelectorModalidad valor={modalidad} onCambio={(m) => cambiarModalidad(poner, m, "beneficio")} disabled={disabled} />
        {errorEn(problemas, "modalidad") && (
          <p role="alert" className="text-[12px] text-red-400">
            {errorEn(problemas, "modalidad")}
          </p>
        )}
      </Tarjeta>

      <Tarjeta titulo={t("Beneficio", "Benefit")} descripcion={t("El precio con la oferta es el que verá y pagará el cliente, y el que dirá ARIA.", "The offer price is what the customer will see and pay, and what ARIA will say.")}>
        <Segmentado
          etiqueta={t("Tipo de beneficio", "Benefit type")}
          valor={tipoBeneficio as "porcentaje" | "monto_fijo" | "precio_especial"}
          onCambio={(v) => poner("beneficio", { tipo: v })}
          disabled={disabled}
          opciones={[
            { valor: "porcentaje", etiqueta: t("Porcentaje", "Percentage") },
            { valor: "monto_fijo", etiqueta: t("Descuento en pesos", "Amount off") },
            { valor: "precio_especial", etiqueta: t("Precio especial", "Special price") },
          ]}
        />
        {tipoBeneficio === "porcentaje" ? (
          <CampoNumero
            etiqueta={t("Porcentaje de descuento", "Discount percentage")}
            ayuda={t(`Entre 1 y ${MAX_PORCENTAJE}. El mismo para detal y mayorista.`, `Between 1 and ${MAX_PORCENTAJE}. Same for retail and wholesale.`)}
            valor={leer(borrador, "beneficio.valor")}
            onCambio={(n) => poner("beneficio.valor", n)}
            sufijo="%"
            disabled={disabled}
            error={errorEn(problemas, "beneficio.valor") ?? errorEn(problemas, "beneficio")}
            requerido
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {canalesDe(modalidad).map((canal) => (
              <CampoNumero
                key={canal}
                etiqueta={`${tipoBeneficio === "monto_fijo" ? t("Descuento", "Amount off") : t("Precio especial", "Special price")} · ${nombreCanal(canal)}`}
                ayuda={tipoBeneficio === "monto_fijo" ? t("Pesos que se restan al precio de cada producto.", "Pesos taken off each product's price.") : t("El precio final de cada producto, en pesos.", "The final price of each product, in pesos.")}
                valor={leer(borrador, `beneficio.${canal}`)}
                onCambio={(n) => poner(`beneficio.${canal}`, n)}
                pesos
                disabled={disabled}
                error={errorEn(problemas, `beneficio.${canal}`)}
                requerido
              />
            ))}
          </div>
        )}
      </Tarjeta>

      <Tarjeta titulo={t("¿A qué productos aplica?", "Which products does it apply to?")}>
        <Interruptor etiqueta={t("Toda la tienda", "Whole store")} ayuda={t("Aplica a todos los productos que tengan precio.", "Applies to every product that has a price.")} valor={todos} onCambio={(v) => poner("alcance.todos", v)} disabled={disabled} />
        {errorEn(problemas, "alcance") && (
          <p role="alert" className="text-[12px] text-red-400">
            {errorEn(problemas, "alcance")}
          </p>
        )}
        {!todos && (
          <>
            <SelectorProductos etiqueta={t("Productos", "Products")} referencias={lista(borrador, "alcance.referencias")} onCambio={(r) => poner("alcance.referencias", r)} max={300} disabled={disabled} ordenable={false} />
            <SelectorCategorias etiqueta={t("O categorías completas", "Or whole categories")} ids={lista(borrador, "alcance.categorias")} onCambio={(c) => poner("alcance.categorias", c)} disabled={disabled} />
          </>
        )}
      </Tarjeta>

      <Tarjeta titulo={t("Vigencia", "Validity")} descripcion={t("Obligatoria: así ninguna oferta queda activa por olvido.", "Required: so no offer stays active by accident.")}>
        <CamposVigencia valor={vigenciaDe(borrador)} onCambio={(v) => poner("vigencia", v)} disabled={disabled} obligatoria errorDesde={errorEn(problemas, "vigencia.desde") ?? errorEn(problemas, "vigencia")} errorHasta={errorEn(problemas, "vigencia.hasta")} />
      </Tarjeta>

      <Tarjeta titulo={t("Más opciones", "More options")}>
        <CampoNumero
          etiqueta={t("Prioridad", "Priority")}
          ayuda={t("Las ofertas NO se acumulan: si dos aplican al mismo producto, gana la de mayor prioridad (0 a 1000). Si empatan, la que deja el mejor precio al cliente.", "Offers do NOT stack: if two apply to the same product, the higher priority wins (0–1000). On a tie, the better price for the customer.")}
          valor={leer(borrador, "prioridad")}
          onCambio={(n) => poner("prioridad", n)}
          disabled={disabled}
          error={errorEn(problemas, "prioridad")}
        />
        <SelectorCampana valor={texto(borrador, "campana")} onCambio={(c) => poner("campana", c)} disabled={disabled} />
        <CampoArea etiqueta={t("Condiciones", "Conditions")} ayuda={t("Se muestran tal cual a tus clientes (por ejemplo «hasta agotar existencias»).", "Shown as written to customers (e.g. “while supplies last”).")} valor={texto(borrador, "condiciones")} onCambio={(v) => poner("condiciones", v)} maxLength={800} filas={3} disabled={disabled} error={errorEn(problemas, "condiciones")} />
      </Tarjeta>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Combo
// ---------------------------------------------------------------------------

type Componente = { referencia: string; cantidad?: number };

function ComponentesCombo({ borrador, poner, disabled, problemas }: FormProps) {
  const { t } = useI18n();
  const componentes = (Array.isArray(leer(borrador, "componentes")) ? (leer(borrador, "componentes") as unknown[]) : []).filter((c): c is Componente => typeof (c as Componente)?.referencia === "string");
  const elegidos = useProductosDe(componentes.map((c) => c.referencia));
  const lleno = componentes.length >= 12;
  const cambiarCantidad = (i: number, n: number) =>
    poner(
      "componentes",
      componentes.map((c, j) => (j === i ? { ...c, cantidad: Math.min(50, Math.max(1, n)) } : c)),
    );
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-mist">
        {t("Productos del combo", "Combo products")} <span className="text-mist/70">({componentes.length}/12)</span>
      </p>
      {errorEn(problemas, "componentes") && (
        <p role="alert" className="mb-2 text-[12px] text-red-400">
          {errorEn(problemas, "componentes")}
        </p>
      )}
      {componentes.length > 0 ? (
        <ul className="mb-3 divide-y divide-edge rounded-lg border border-edge">
          {componentes.map((c, i) => {
            const producto = elegidos[i]?.producto;
            return (
              <li key={c.referencia} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">{producto ? producto.nombre : c.referencia}</p>
                  <p className="truncate font-mono text-[11px] text-mist">{c.referencia}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`${t("Cantidad de", "Quantity of")} ${c.referencia}`}>
                  <button type="button" aria-label={`${t("Una menos de", "One less of")} ${c.referencia}`} disabled={disabled || (c.cantidad ?? 1) <= 1} onClick={() => cambiarCantidad(i, (c.cantidad ?? 1) - 1)} className="rounded border border-edge p-1.5 text-mist hover:text-fg disabled:opacity-30">
                    <Minus className="size-3.5" />
                  </button>
                  <span className="w-8 text-center text-sm tabular-nums text-fg" aria-live="polite">
                    {c.cantidad ?? 1}
                  </span>
                  <button type="button" aria-label={`${t("Una más de", "One more of")} ${c.referencia}`} disabled={disabled || (c.cantidad ?? 1) >= 50} onClick={() => cambiarCantidad(i, (c.cantidad ?? 1) + 1)} className="rounded border border-edge p-1.5 text-mist hover:text-fg disabled:opacity-30">
                    <Plus className="size-3.5" />
                  </button>
                </div>
                {!disabled && (
                  <button
                    type="button"
                    aria-label={`${t("Quitar", "Remove")} ${c.referencia}`}
                    onClick={() =>
                      poner(
                        "componentes",
                        componentes.filter((_, j) => j !== i),
                      )
                    }
                    className="rounded p-1.5 text-mist hover:text-red-400"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mb-3 rounded-lg border border-dashed border-edge px-3 py-4 text-center text-sm text-mist">{t("Agrega los productos que forman el combo.", "Add the products that make up the combo.")}</p>
      )}
      {!disabled && (
        <BuscadorProductos
          yaElegidos={componentes.map((c) => c.referencia)}
          onElegir={(ref) => !lleno && poner("componentes", [...componentes, { referencia: ref, cantidad: 1 }])}
          deshabilitarAgregar={lleno}
          mensajeLleno={t("Un combo admite máximo 12 productos distintos.", "A combo allows at most 12 different products.")}
        />
      )}
    </div>
  );
}

export function FormCombo(p: FormProps) {
  const { t } = useI18n();
  const { borrador, poner, disabled, problemas } = p;
  const modalidad = (leer(borrador, "modalidad") as Modalidad | undefined) ?? "ambas";
  return (
    <div className="space-y-5">
      <Tarjeta titulo={t("Datos del combo", "Combo details")}>
        <CampoTexto etiqueta={t("Nombre", "Name")} valor={texto(borrador, "nombre")} onCambio={(v) => poner("nombre", v)} maxLength={80} disabled={disabled} requerido error={errorEn(problemas, "nombre")} />
        <CampoArea etiqueta={t("Descripción", "Description")} valor={texto(borrador, "descripcion")} onCambio={(v) => poner("descripcion", v)} maxLength={600} filas={3} disabled={disabled} error={errorEn(problemas, "descripcion")} />
        <SelectorImagen etiqueta={t("Imagen (opcional)", "Image (optional)")} imagen={leer(borrador, "imagen") as Imagen | undefined} onCambio={(i) => poner("imagen", i)} disabled={disabled} problema={errorEn(problemas, "imagen")} />
      </Tarjeta>
      <Tarjeta titulo={t("Para quién", "Who is it for")}>
        <SelectorModalidad valor={modalidad} onCambio={(m) => cambiarModalidad(poner, m, "precio")} disabled={disabled} />
      </Tarjeta>
      <Tarjeta titulo={t("Productos y precio", "Products and price")} descripcion={t("El precio «normal» (la suma de los productos) y la disponibilidad los calcula el sistema; tú solo defines el precio del combo.", "The “regular” price (sum of the products) and availability are calculated by the system; you only set the combo price.")}>
        <ComponentesCombo {...p} />
        <div className="grid gap-4 sm:grid-cols-2">
          {canalesDe(modalidad).map((canal) => (
            <CampoNumero
              key={canal}
              etiqueta={`${t("Precio del combo", "Combo price")} · ${canal === "detal" ? t("clientes detal", "retail customers") : t("clientes mayoristas", "wholesale customers")}`}
              ayuda={t("Debe ser menor que comprar los productos por separado.", "Must be lower than buying the products separately.")}
              valor={leer(borrador, `precio.${canal}`)}
              onCambio={(n) => poner(`precio.${canal}`, n)}
              pesos
              disabled={disabled}
              error={errorEn(problemas, `precio.${canal}`)}
              requerido
            />
          ))}
        </div>
      </Tarjeta>
      <Tarjeta titulo={t("Vigencia", "Validity")}>
        <CamposVigencia valor={vigenciaDe(borrador)} onCambio={(v) => poner("vigencia", v)} disabled={disabled} obligatoria errorDesde={errorEn(problemas, "vigencia.desde") ?? errorEn(problemas, "vigencia")} errorHasta={errorEn(problemas, "vigencia.hasta")} />
      </Tarjeta>
      <Tarjeta titulo={t("Más opciones", "More options")}>
        <CampoNumero etiqueta={t("Prioridad", "Priority")} valor={leer(borrador, "prioridad")} onCambio={(n) => poner("prioridad", n)} disabled={disabled} error={errorEn(problemas, "prioridad")} />
        <SelectorCampana valor={texto(borrador, "campana")} onCambio={(c) => poner("campana", c)} disabled={disabled} />
        <CampoArea etiqueta={t("Condiciones", "Conditions")} valor={texto(borrador, "condiciones")} onCambio={(v) => poner("condiciones", v)} maxLength={800} filas={3} disabled={disabled} error={errorEn(problemas, "condiciones")} />
      </Tarjeta>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campaña
// ---------------------------------------------------------------------------

export function FormCampana(p: FormProps) {
  const { t } = useI18n();
  const { borrador, poner, disabled, problemas } = p;
  const modalidad = (leer(borrador, "modalidad") as Modalidad | undefined) ?? "ambas";
  // Mientras se escribe, el bloque puede quedar sin ningún dato (y el borrador no guarda objetos vacíos): el interruptor recuerda que está activado.
  const [bloqueAbierto, setBloqueAbierto] = useState(false);
  const conBloque = bloqueAbierto || leer(borrador, "portada") !== undefined;
  return (
    <div className="space-y-5">
      <Tarjeta titulo={t("Datos de la campaña", "Campaign details")} descripcion={t("Una campaña agrupa ofertas, combos y destacados de una temporada (Navidad, Amor y Amistad…). Si la campaña no está activa, sus ofertas y combos tampoco.", "A campaign groups offers, combos and highlights for a season. If the campaign is not active, neither are its offers and combos.")}>
        <CampoTexto etiqueta={t("Nombre", "Name")} valor={texto(borrador, "nombre")} onCambio={(v) => poner("nombre", v)} maxLength={80} disabled={disabled} requerido error={errorEn(problemas, "nombre")} />
        <CampoArea etiqueta={t("Descripción", "Description")} valor={texto(borrador, "descripcion")} onCambio={(v) => poner("descripcion", v)} maxLength={600} filas={3} disabled={disabled} error={errorEn(problemas, "descripcion")} />
        <SelectorImagen etiqueta={t("Imagen (opcional)", "Image (optional)")} imagen={leer(borrador, "imagen") as Imagen | undefined} onCambio={(i) => poner("imagen", i)} disabled={disabled} problema={errorEn(problemas, "imagen")} />
      </Tarjeta>
      <Tarjeta titulo={t("Para quién", "Who is it for")}>
        <SelectorModalidad valor={modalidad} onCambio={(m) => poner("modalidad", m)} disabled={disabled} />
      </Tarjeta>
      <Tarjeta titulo={t("Vigencia", "Validity")}>
        <CamposVigencia valor={vigenciaDe(borrador)} onCambio={(v) => poner("vigencia", v)} disabled={disabled} obligatoria errorDesde={errorEn(problemas, "vigencia.desde") ?? errorEn(problemas, "vigencia")} errorHasta={errorEn(problemas, "vigencia.hasta")} />
        <CampoNumero
          etiqueta={t("Prioridad", "Priority")}
          ayuda={t("Si hay varias campañas activas, en la página principal se muestra la de mayor prioridad.", "If several campaigns are active, the home page shows the highest priority.")}
          valor={leer(borrador, "prioridad")}
          onCambio={(n) => poner("prioridad", n)}
          disabled={disabled}
          error={errorEn(problemas, "prioridad")}
        />
      </Tarjeta>
      <Tarjeta titulo={t("Bloque de la campaña en la página principal", "Campaign block on the home page")} descripcion={t("Un bloque propio (título, imagen y botón) que se muestra mientras la campaña esté activa.", "Its own block (title, image and button) shown while the campaign is active.")}>
        <Interruptor
          etiqueta={t("Mostrar un bloque de esta campaña", "Show a block for this campaign")}
          valor={conBloque}
          onCambio={(v) => {
            setBloqueAbierto(v);
            if (!v) poner("portada", undefined);
          }}
          disabled={disabled}
        />
        {conBloque && (
          <>
            <CampoTexto etiqueta={t("Frase pequeña sobre el título", "Small line above the title")} valor={texto(borrador, "portada.etiqueta")} onCambio={(v) => poner("portada.etiqueta", v)} maxLength={40} disabled={disabled} error={errorEn(problemas, "portada.etiqueta")} />
            <CampoTexto etiqueta={t("Título", "Title")} valor={texto(borrador, "portada.titulo")} onCambio={(v) => poner("portada.titulo", v)} maxLength={90} disabled={disabled} requerido error={errorEn(problemas, "portada.titulo")} />
            <CampoTexto etiqueta={t("Subtítulo", "Subtitle")} valor={texto(borrador, "portada.subtitulo")} onCambio={(v) => poner("portada.subtitulo", v)} maxLength={200} disabled={disabled} error={errorEn(problemas, "portada.subtitulo")} />
            <SelectorImagen etiqueta={t("Imagen del bloque", "Block image")} imagen={leer(borrador, "portada.imagen") as Imagen | undefined} onCambio={(i) => poner("portada.imagen", i)} disabled={disabled} problema={errorEn(problemas, "portada.imagen")} />
            <FilaBoton prefijo="portada.boton" {...p} />
          </>
        )}
      </Tarjeta>
      <Tarjeta titulo={t("Productos destacados de la campaña", "Campaign featured products")}>
        <SelectorProductos etiqueta={t("Productos", "Products")} referencias={lista(borrador, "productos_destacados")} onCambio={(r) => poner("productos_destacados", r)} max={12} disabled={disabled} />
      </Tarjeta>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contenido comercial
// ---------------------------------------------------------------------------

export function FormContenido(p: FormProps) {
  const { t } = useI18n();
  const { borrador, poner, disabled, problemas } = p;
  const { contexto } = useTienda();
  const tema = (texto(borrador, "tema") || "faq") as TemaContenido;
  const cuerpo = texto(borrador, "texto");
  const claves = lista(borrador, "palabras_clave");
  // Lo escrito en «palabras clave» se conserva tal cual mientras se teclea (la coma final no se debe perder al convertir a lista).
  const [escritas, setEscritas] = useState(claves.join(", "));
  const insertar = (id: string) => poner("texto", `${cuerpo}${cuerpo && !/\s$/.test(cuerpo) ? " " : ""}{{${id}}}`);
  return (
    <div className="space-y-5">
      <Tarjeta titulo={t("Qué es", "What it is")}>
        <CampoSelect etiqueta={t("Tema", "Topic")} valor={tema} onCambio={(v) => poner("tema", v)} opciones={TEMAS_CONTENIDO.map((x) => ({ valor: x, etiqueta: ETIQUETAS_TEMA[x] }))} disabled={disabled} error={errorEn(problemas, "tema")} />
        <Segmentado
          etiqueta={t("¿Quién lo puede recibir?", "Who can receive it?")}
          ayuda={t("«Mayorista» solo lo recibe un cliente mayorista. Lo que escribas en «Todos» o «Detal» lo puede leer cualquier cliente detal: no pongas ahí precios ni enlaces mayoristas.", "“Wholesale” is only for wholesale customers. Anything in “Everyone” or “Retail” can be read by any retail customer: don't put wholesale prices or links there.")}
          valor={(texto(borrador, "audiencia") || "todos") as "todos" | "detal" | "mayorista"}
          onCambio={(v) => poner("audiencia", v)}
          disabled={disabled}
          opciones={[
            { valor: "todos", etiqueta: t("Todos", "Everyone") },
            { valor: "detal", etiqueta: t("Solo detal", "Retail only") },
            { valor: "mayorista", etiqueta: t("Solo mayorista", "Wholesale only") },
          ]}
        />
      </Tarjeta>
      <Tarjeta titulo={t("Contenido", "Content")} descripcion={t("Es información para tus clientes: ARIA la usa tal cual para responder. No escribas instrucciones.", "This is information for your customers: ARIA uses it as written to answer. Don't write instructions.")}>
        <CampoTexto etiqueta={tema === "faq" ? t("Pregunta", "Question") : t("Título", "Title")} valor={texto(borrador, "titulo")} onCambio={(v) => poner("titulo", v)} maxLength={160} disabled={disabled} requerido error={errorEn(problemas, "titulo")} />
        <CampoArea etiqueta={tema === "faq" ? t("Respuesta", "Answer") : t("Texto", "Text")} valor={cuerpo} onCambio={(v) => poner("texto", v)} maxLength={1500} filas={6} disabled={disabled} requerido error={errorEn(problemas, "texto")} />
        {!disabled && contexto && contexto.variables.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] text-mist/80">{t("Datos del negocio que se completan solos (así nunca quedan desactualizados):", "Business data filled in automatically (so they never go stale):")}</p>
            <ul className="flex flex-wrap gap-2">
              {contexto.variables.map((v) => (
                <li key={v.id}>
                  <button type="button" onClick={() => insertar(v.id)} disabled={v.valor === null} title={v.valor === null ? t("Todavía no está configurado para tu negocio", "Not configured for your business yet") : v.valor} className={cn(actionBtn, "px-2.5 py-1.5 text-[12px]")}>
                    <Plus className="size-3.5" aria-hidden /> {v.etiqueta}
                    {v.valor !== null && <span className="text-mist"> · {v.valor}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <CampoTexto
          etiqueta={t("Palabras clave (opcional)", "Keywords (optional)")}
          ayuda={t("Separadas por coma. Ayudan a encontrar esta respuesta cuando un cliente pregunta con otras palabras.", "Comma-separated. They help find this answer when a customer asks in other words.")}
          valor={escritas}
          onCambio={(v) => {
            setEscritas(v);
            poner(
              "palabras_clave",
              v
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            );
          }}
          disabled={disabled}
          error={errorEn(problemas, "palabras_clave")}
        />
      </Tarjeta>
      <Tarjeta titulo={t("Orden y vigencia", "Order and validity")}>
        <CampoNumero etiqueta={t("Orden", "Order")} ayuda={t("Los números menores aparecen primero.", "Lower numbers come first.")} valor={leer(borrador, "orden")} onCambio={(n) => poner("orden", n)} disabled={disabled} error={errorEn(problemas, "orden")} />
        <CamposVigencia valor={vigenciaDe(borrador)} onCambio={(v) => poner("vigencia", v)} disabled={disabled} errorDesde={errorEn(problemas, "vigencia.desde") ?? errorEn(problemas, "vigencia")} errorHasta={errorEn(problemas, "vigencia.hasta")} />
        <p className="text-[11px] text-mist/80">{t("Opcional: sin fechas, el contenido vale siempre.", "Optional: without dates the content always applies.")}</p>
      </Tarjeta>
    </div>
  );
}
