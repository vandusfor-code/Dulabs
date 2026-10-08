/**
 * Administración de tienda — helpers PUROS de presentación: etiquetas, chips de estado, fechas en hora de Bogotá y el resumen «antes → después» del historial.
 */
import { ETIQUETAS_TEMA, type AccionAuditoria, type RegistroAuditoria, type SeccionHome, type TipoEntidad } from "@/lib/cms-comercial/contrato";
import type { EntidadResumen } from "@/lib/cms-comercial/servicio";
import { etiquetaDeCampo } from "@/lib/cms-comercial/validacion";
import { formatearPesos } from "@/lib/cms-comercial/variables";

export type TonoChip = "neutral" | "success" | "warning" | "danger" | "info";
export interface Chip {
  texto: string;
  tono: TonoChip;
}

export const NOMBRES_TIPO: Readonly<Record<TipoEntidad, { singular: string; plural: string; nuevo: string; nuevoEn: string; pluralEn: string; singularEn: string }>> = {
  home: { singular: "Página principal", plural: "Página principal", nuevo: "Crear página principal", nuevoEn: "Create home page", singularEn: "Home page", pluralEn: "Home page" },
  oferta: { singular: "Oferta", plural: "Ofertas", nuevo: "Nueva oferta", nuevoEn: "New offer", singularEn: "Offer", pluralEn: "Offers" },
  combo: { singular: "Combo", plural: "Combos", nuevo: "Nuevo combo", nuevoEn: "New combo", singularEn: "Combo", pluralEn: "Combos" },
  campana: { singular: "Campaña", plural: "Campañas", nuevo: "Nueva campaña", nuevoEn: "New campaign", singularEn: "Campaign", pluralEn: "Campaigns" },
  contenido: { singular: "Contenido", plural: "Contenido", nuevo: "Nuevo contenido", nuevoEn: "New content", singularEn: "Content", pluralEn: "Content" },
};

/** El texto de cada chip en inglés (los chips nacen en español, que es lo que prueba la lógica). */
export const TEXTO_CHIP_EN: Readonly<Record<string, string>> = {
  Borrador: "Draft",
  Publicada: "Published",
  Pausada: "Paused",
  Vencida: "Expired",
  Programada: "Scheduled",
  "Cambios sin publicar": "Unpublished changes",
  Archivada: "Archived",
};

/** Chips que describen un elemento en la lista y en el editor. */
export function chipsDe(r: Pick<EntidadResumen, "estado" | "estadoVigencia" | "archivada" | "tieneCambios">): Chip[] {
  if (r.archivada) return [{ texto: "Archivada", tono: "neutral" }];
  const chips: Chip[] = [];
  if (r.estado === "borrador") chips.push({ texto: "Borrador", tono: "neutral" });
  if (r.estado === "pausada") chips.push({ texto: "Pausada", tono: "warning" });
  if (r.estado === "publicada") chips.push({ texto: "Publicada", tono: "success" });
  // La vigencia solo importa si está en vivo (publicada o pausada): una oferta vencida o programada se avisa aparte.
  if (r.estado !== "borrador") {
    if (r.estadoVigencia === "vencida") chips.push({ texto: "Vencida", tono: "danger" });
    if (r.estadoVigencia === "programada") chips.push({ texto: "Programada", tono: "info" });
  }
  if (r.tieneCambios && r.estado !== "borrador") chips.push({ texto: "Cambios sin publicar", tono: "info" });
  return chips;
}

/** Qué hizo la persona, para cada registro del historial («Publicó · v3»). */
export const ACCION_CORTA: Readonly<Record<AccionAuditoria, string>> = {
  crear: "Creó",
  editar_borrador: "Guardó el borrador",
  publicar: "Publicó",
  restaurar: "Restauró una versión",
  pausar: "Pausó",
  reanudar: "Reanudó",
  despublicar: "Despublicó",
  archivar: "Archivó",
  desarchivar: "Desarchivó",
  subir_imagen: "Subió una imagen",
};

export const ACCION_CORTA_EN: Readonly<Record<AccionAuditoria, string>> = {
  crear: "Created",
  editar_borrador: "Saved the draft",
  publicar: "Published",
  restaurar: "Restored a version",
  pausar: "Paused",
  reanudar: "Resumed",
  despublicar: "Unpublished",
  archivar: "Archived",
  desarchivar: "Unarchived",
  subir_imagen: "Uploaded an image",
};

/** A qué se refiere un registro del historial general: «Oferta: Amor y amistad», «Página principal»… (vacío para las imágenes). */
export function objetoDeAuditoria(r: Pick<RegistroAuditoria, "entidadTipo" | "antes" | "despues">): string {
  if (r.entidadTipo === "imagen") return "";
  const tipo = NOMBRES_TIPO[r.entidadTipo].singular;
  if (r.entidadTipo === "home") return tipo;
  const contenido = [r.despues, r.antes].find((c): c is Record<string, unknown> => typeof c === "object" && c !== null && !Array.isArray(c));
  const nombre = contenido ? (r.entidadTipo === "contenido" ? contenido.titulo : contenido.nombre) : undefined;
  return typeof nombre === "string" && nombre.trim() ? `${tipo}: ${nombre.trim()}` : tipo;
}

const FORMATO = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** «28 oct 2026, 5:00 p. m.» en hora de Bogotá. */
export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? FORMATO.format(new Date(ms)) : "—";
}

// ---------------------------------------------------------------------------
// Resumen de cambios (historial): «Porcentaje de descuento: 20% → 25%»
// ---------------------------------------------------------------------------

export interface CambioResumido {
  campo: string;
  antes: string;
  despues: string;
}

export interface OpcionesResumen {
  /** Las categorías del negocio: así se muestra su nombre y no su identificador interno. */
  categorias?: ReadonlyArray<{ id: string; nombre: string }>;
}

/** Nombre de cada sección de la página principal. */
export const NOMBRES_SECCION: Readonly<Record<SeccionHome, { es: string; en: string }>> = {
  portada: { es: "Portada", en: "Cover" },
  categorias: { es: "Categorías destacadas", en: "Featured categories" },
  destacados: { es: "Productos destacados", en: "Featured products" },
  banner: { es: "Banner", en: "Banner" },
  ofertas: { es: "Ofertas vigentes", en: "Current offers" },
  combos: { es: "Combos", en: "Combos" },
  campana: { es: "Campaña activa", en: "Active campaign" },
};

type Hoja = string | number | boolean | null;
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Antes de comparar, las listas de objetos se vuelven texto legible: las secciones (solo las que se muestran, en orden) y los productos de un combo
 * («2 × DL-000001»). Así el historial dice «Secciones: Portada, Destacados → Portada, Banner, Destacados» y no una fila por cada clave interna.
 */
function simplificar(contenido: unknown): unknown {
  if (!esObjeto(contenido)) return contenido;
  const copia: Record<string, unknown> = { ...contenido };
  if (Array.isArray(contenido.secciones)) {
    copia.secciones = contenido.secciones.filter((s) => esObjeto(s) && s.visible === true).map((s) => NOMBRES_SECCION[(s as { tipo: SeccionHome }).tipo]?.es ?? String((s as { tipo: unknown }).tipo));
  }
  if (Array.isArray(contenido.componentes)) {
    copia.componentes = contenido.componentes.map((c) => (esObjeto(c) ? `${c.cantidad ?? 1} × ${c.referencia}` : String(c)));
  }
  return copia;
}

function aplanar(valor: unknown, ruta: string, salida: Map<string, Hoja>) {
  if (Array.isArray(valor)) {
    if (valor.every((v) => v === null || ["string", "number", "boolean"].includes(typeof v))) salida.set(ruta, valor.length === 0 ? "" : valor.join(", "));
    else valor.forEach((v, i) => aplanar(v, `${ruta}.${i}`, salida));
    return;
  }
  if (typeof valor === "object" && valor !== null) {
    for (const [k, v] of Object.entries(valor)) aplanar(v, ruta ? `${ruta}.${k}` : k, salida);
    return;
  }
  salida.set(ruta, (valor ?? null) as Hoja);
}

const CAMPOS_PESOS = /(^|\.)(precio|detal|mayorista)$|^beneficio\.(detal|mayorista)$|^precio\.(detal|mayorista)$/;
/** Datos técnicos de una imagen que a la administradora no le dicen nada (solo importa SI cambió la imagen y su descripción). */
const RUIDO = /(^|\.)imagen\.(origen|src|ancho|alto)$/;

const VALORES: ReadonlyArray<[RegExp, Readonly<Record<string, string>>]> = [
  [/(^|\.)modalidad$/, { detal: "Detal", mayorista: "Mayorista", ambas: "Ambas" }],
  [/(^|\.)audiencia$/, { todos: "Todos", detal: "Solo detal", mayorista: "Solo mayorista" }],
  [/^beneficio\.tipo$/, { porcentaje: "Porcentaje", monto_fijo: "Descuento en pesos", precio_especial: "Precio especial" }],
  [/(^|\.)destino\.tipo$/, { catalogo: "Todo el catálogo", categoria: "Una categoría", busqueda: "Una búsqueda", oferta: "Una oferta", combo: "Un combo", campana: "Una campaña", whatsapp: "WhatsApp" }],
  [/^tema$/, ETIQUETAS_TEMA],
  [/(^|\.)foco$/, { "50% 50%": "Centro", "50% 0%": "Arriba", "50% 100%": "Abajo", "0% 50%": "Izquierda", "100% 50%": "Derecha", "72% 50%": "Derecha (suave)" }],
];

/** El nombre de un campo para la persona que edita (los de adentro de una imagen o de un destino se explican por el campo que los contiene). */
function etiquetaCampo(ruta: string): string {
  const pasos = ruta.split(".").filter((s) => !/^\d+$/.test(s));
  const ultimo = pasos[pasos.length - 1];
  const padre = pasos.slice(0, -1).join(".");
  if (ruta === "secciones") return "Secciones que se muestran";
  if (ultimo === "asset") return etiquetaDeCampo(padre);
  if (ultimo === "alt") return `Descripción de «${etiquetaDeCampo(padre)}»`;
  if (ultimo === "foco") return `Parte visible de «${etiquetaDeCampo(padre)}»`;
  if (pasos[pasos.length - 2] === "destino") {
    const destino = etiquetaDeCampo(padre);
    if (ultimo === "tipo") return destino;
    if (ultimo === "categoria_id") return `${destino} · categoría`;
    if (ultimo === "consulta") return `${destino} · búsqueda`;
    if (ultimo === "clave") return `${destino} · elemento`;
  }
  return etiquetaDeCampo(ruta);
}

function formatoValor(ruta: string, v: Hoja | undefined, categorias: ReadonlyMap<string, string>): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "number") {
    if (ruta === "beneficio.valor") return `${v}%`;
    if (CAMPOS_PESOS.test(ruta) && !/(^|\.)cantidad$/.test(ruta)) return formatearPesos(v);
    return String(v);
  }
  const conocido = VALORES.find(([re]) => re.test(ruta))?.[1][v];
  const legible = conocido ?? v.split(", ").map((x) => categorias.get(x) ?? x).join(", ");
  return legible.length > 90 ? `${legible.slice(0, 87)}…` : legible;
}

/** Los campos que cambiaron entre dos contenidos, con su nombre legible y el valor ya formateado (máximo `max`). */
export function resumirCambios(antes: unknown, despues: unknown, max = 6, opciones: OpcionesResumen = {}): CambioResumido[] {
  const categorias = new Map((opciones.categorias ?? []).map((c) => [c.id, c.nombre] as const));
  const a = new Map<string, Hoja>();
  const d = new Map<string, Hoja>();
  aplanar(simplificar(antes ?? {}), "", a);
  aplanar(simplificar(despues ?? {}), "", d);
  const rutas = [...new Set([...a.keys(), ...d.keys()])].filter((r) => r !== "" && !RUIDO.test(r));
  const cambios: CambioResumido[] = [];
  for (const ruta of rutas) {
    const va = a.get(ruta);
    const vd = d.get(ruta);
    if (va === vd || (va === undefined && vd === "") || (va === "" && vd === undefined)) continue;
    // Una imagen recién puesta trae el punto focal por defecto (el centro): no es una decisión de la persona, no se cuenta.
    if (ruta.endsWith(".foco") && ((va === undefined && vd === "50% 50%") || (vd === undefined && va === "50% 50%"))) continue;
    // Una imagen se identifica por un código interno: se dice «imagen anterior → imagen nueva», no el código.
    const esImagen = ruta.endsWith(".asset");
    cambios.push({
      campo: etiquetaCampo(ruta),
      antes: esImagen ? (va ? "imagen anterior" : "—") : formatoValor(ruta, va, categorias),
      despues: esImagen ? (vd ? "imagen nueva" : "—") : formatoValor(ruta, vd, categorias),
    });
  }
  return cambios.slice(0, max);
}
