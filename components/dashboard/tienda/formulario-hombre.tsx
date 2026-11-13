"use client";

/**
 * El LADO DE HOMBRE en el panel de la Tienda (Delacour · Vértice): un interruptor «Mujer | Hombre» sobre los formularios de «Página principal» y «Fotos y videos». Con «Hombre» la administradora
 * edita lo MISMO que en el lado de mujer (videos de portada, colección y marca, imagen de cada categoría, categorías y productos destacados) con los mismos formularios y las mismas reglas; lo que
 * guarda va dentro del mismo contenido (clave «hombre») y se publica con el mismo botón: un borrador, un «Publicar». El pie, las páginas y las preguntas frecuentes son de toda la tienda.
 *
 * La adaptación es una sola: los formularios hablan por rutas («videos.portada.horizontal»); para el lado de hombre se les entrega el contenido de `hombre` y cada cambio se escribe bajo
 * `hombre.…`, y los problemas de la revisión que son de ese lado llegan sin el prefijo. Así no se duplica ninguna regla ni ningún formulario.
 */
import { Mars, Venus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Draft } from "@/components/dashboard/tienda/borrador";
import { leer } from "@/components/dashboard/tienda/borrador";
import type { FormProps } from "@/components/dashboard/tienda/formularios";
import { SelectorCategorias, SelectorProductos } from "@/components/dashboard/tienda/selectores";
import { Aviso, Tarjeta, cn } from "@/components/dashboard/tienda/ui";

export type LadoDeLaTienda = "mujer" | "hombre";

/** Los espacios de video del lado de hombre (los mayoristas son de toda la tienda). */
export const ESPACIOS_DE_HOMBRE = ["portada", "coleccion", "marca"] as const;

const PREFIJO = "hombre";
const esObjeto = (v: unknown): v is Draft => typeof v === "object" && v !== null && !Array.isArray(v);

/** Los formularios del lado de hombre: el contenido de `hombre` (vacío si todavía no hay), cada cambio bajo `hombre.…` y solo los problemas de ese lado, sin el prefijo. */
export function propsDeHombre(p: FormProps): FormProps {
  const contenido = leer(p.borrador, PREFIJO);
  return {
    borrador: esObjeto(contenido) ? contenido : {},
    poner: (ruta, valor) => p.poner(`${PREFIJO}.${ruta}`, valor),
    disabled: p.disabled,
    problemas: p.problemas.filter((x) => x.campo === PREFIJO || x.campo.startsWith(`${PREFIJO}.`)).map((x) => ({ ...x, campo: x.campo === PREFIJO ? "" : x.campo.slice(PREFIJO.length + 1) })),
  };
}

/** ¿Hay algo del lado de hombre con problemas? Para avisarlo en el interruptor aunque la administradora esté viendo el otro lado. */
export function problemasDeHombre(p: FormProps): number {
  return p.problemas.filter((x) => x.severidad === "error" && (x.campo === PREFIJO || x.campo.startsWith(`${PREFIJO}.`))).length;
}

/** ¿Hay algo elegido del lado de hombre en este contenido? Sirve para marcar el interruptor con un punto («ya tiene contenido»). */
export function tieneContenidoDeHombre(borrador: Draft): boolean {
  const h = leer(borrador, PREFIJO);
  if (!esObjeto(h)) return false;
  const hay = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : esObjeto(v) ? Object.values(v).some(hay) : v !== undefined && v !== null && v !== "");
  return Object.values(h).some(hay);
}

/** El interruptor «Mujer | Hombre» de la parte de arriba del formulario. */
export function InterruptorDeLado({ lado, onCambio, conContenidoDeHombre, problemasEnHombre }: { lado: LadoDeLaTienda; onCambio: (l: LadoDeLaTienda) => void; conContenidoDeHombre: boolean; problemasEnHombre: number }) {
  const { t } = useI18n();
  const opciones: ReadonlyArray<{ valor: LadoDeLaTienda; etiqueta: string; icono: React.ReactNode }> = [
    { valor: "mujer", etiqueta: t("Mujer", "Women"), icono: <Venus className="size-4" aria-hidden /> },
    { valor: "hombre", etiqueta: t("Hombre", "Men"), icono: <Mars className="size-4" aria-hidden /> },
  ];
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3" data-testid="interruptor-de-lado">
      <div role="radiogroup" aria-label={t("Qué lado de la tienda editas", "Which side of the store you edit")} className="inline-flex rounded-lg border border-edge bg-ink p-1">
        {opciones.map((o) => {
          const activa = lado === o.valor;
          return (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={activa}
              onClick={() => onCambio(o.valor)}
              className={cn("flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm transition-colors", activa ? "bg-card font-medium text-fg shadow-sm" : "text-mist hover:text-fg")}
            >
              {o.icono}
              {o.etiqueta}
              {o.valor === "hombre" && conContenidoDeHombre && !activa && <span aria-label={t("ya tiene contenido", "already has content")} className="size-1.5 rounded-full bg-lime" />}
              {o.valor === "hombre" && problemasEnHombre > 0 && (
                <span role="status" className="rounded-full bg-red-500/15 px-1.5 text-[11px] font-medium text-red-400">
                  {problemasEnHombre}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[13px] text-mist" data-testid="aviso-de-lado">
        {lado === "hombre"
          ? t("Estás editando el lado de HOMBRE (Vértice). Se publica con el mismo botón «Publicar».", "You are editing the MEN's side (Vértice). It is published with the same “Publish” button.")
          : t("Estás editando el lado de MUJER (la tienda de siempre).", "You are editing the WOMEN's side (the usual store).")}
      </p>
    </div>
  );
}

/** «Página principal» del lado de hombre: sus categorías y productos destacados (la portada de Vértice y el orden de sus bloques los pone el diseño de hombre). */
export function FormHomeHombre(p: FormProps) {
  const { t } = useI18n();
  const { borrador, poner, disabled } = p;
  const lista = (ruta: string) => {
    const v = leer(borrador, ruta);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  };
  return (
    <div className="space-y-5">
      <Aviso tono="info" titulo={t("El inicio del lado de hombre", "The men's side home page")}>
        {t(
          "Es la portada de la colección Vértice, sus categorías, sus productos destacados y, si subes videos en «Fotos y videos» (pestaña Hombre), su video de colección y de marca. Aquí eliges las categorías y los productos destacados; nada cambia en tu tienda hasta que publiques.",
          "It is the Vértice collection cover, its categories, its featured products and, if you upload videos in “Photos and videos” (Men tab), its collection and brand videos. Here you choose the categories and featured products; nothing changes in your store until you publish.",
        )}
      </Aviso>

      <Tarjeta titulo={t("Categorías destacadas", "Featured categories")} descripcion={t("Si no eliges ninguna, se muestran las que tienen piezas de hombre.", "If you pick none, the ones that have men's pieces are shown.")}>
        <SelectorCategorias etiqueta={t("Categorías", "Categories")} ids={lista("categorias_destacadas")} onCambio={(ids) => poner("categorias_destacadas", ids)} max={12} disabled={disabled} ordenable />
      </Tarjeta>

      <Tarjeta titulo={t("Productos destacados", "Featured products")} descripcion={t("Si no eliges ninguno, se muestran las piezas de hombre más recientes con foto.", "If you pick none, the most recent men's pieces with a photo are shown.")}>
        <SelectorProductos etiqueta={t("Productos", "Products")} referencias={lista("productos_destacados")} onCambio={(refs) => poner("productos_destacados", refs)} max={24} disabled={disabled} />
      </Tarjeta>
    </div>
  );
}
