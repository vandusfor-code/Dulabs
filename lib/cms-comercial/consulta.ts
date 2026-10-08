/**
 * CMS comercial — LO QUE ARIA PUEDE SABER de lo publicado. PURO: sin I/O, con el reloj, el canal y los valores que le pasan.
 *
 * Cada función arma la RESPUESTA de una herramienta de ARIA (consultar_ofertas, consultar_combos, consultar_campanas, consultar_contenido_comercial) a partir de la
 * instantánea PUBLICADA del negocio y de las funciones de evaluación (evaluacion.ts: el único lugar donde se decide qué está activo, aplicable y a qué precio).
 * Nada de esto lo decide el modelo: el negocio, el canal y el reloj salen del turno (backend).
 *
 * Contrato de toda respuesta (estricto; lo verifica la prueba de contratos con los esquemas de este archivo):
 *   - solo lo PUBLICADO + VIGENTE + APLICABLE al canal del cliente (borrador, pausado, vencido, de otra modalidad o de otra audiencia NO existe aquí);
 *   - `empty: true` cuando no hay nada: es la ÚNICA base para decir «por ahora no hay» (la guarda de anclaje lo exige);
 *   - precios, ahorros, disponibilidad, vigencia en palabras y condiciones ya calculados o redactados por el backend: ARIA los cita tal cual y no calcula nada;
 *   - sin ids internos, sin versiones y sin el stock exacto (un combo solo dice si está disponible y, si no, por qué en palabras).
 */
import { z } from "zod";
import type { ProductoResuelto } from "@/lib/catalogo/resolucion";
import type { Canal, TemaContenido } from "@/lib/cms-comercial/contrato";
import {
  campanasActivas,
  combosActivos,
  contenidosPara,
  ofertasActivas,
  precioEfectivo,
  vistaCombo,
  vistaOferta,
  type ContextoEvaluacion,
  type MotivoComboNoDisponible,
  type ProductoParaCombo,
  type VistaOferta,
} from "@/lib/cms-comercial/evaluacion";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { describirVigencia, fechaLocalDeMs, formatearFechaLocal } from "@/lib/cms-comercial/tiempo";
import type { ValoresVariables } from "@/lib/cms-comercial/variables";

export interface ContextoConsulta {
  snap: InstantaneaCms;
  /** SIEMPRE lo decide el backend (clasificación del contacto o enlace de la solicitud). */
  canal: Canal;
  /** Reloj del backend (ms). */
  ahora: number;
  /** Valores de las variables de los textos ({{minimo_mayorista}}, …) tomados de la configuración del negocio. */
  valores: ValoresVariables;
}

const canalTexto = z.enum(["retail", "wholesale"]);

// ---------------------------------------------------------------------------
// Esquemas de salida (el contrato de cada herramienta)
// ---------------------------------------------------------------------------

export const ofertaConsultaSchema = z
  .object({
    name: z.string(),
    /** «20% de descuento», «$5.000 de descuento», «precio especial de $60.000». */
    benefit: z.string(),
    description: z.string().nullable(),
    /** «del 25 de octubre de 2026 al 31 de octubre de 2026», «hasta el …». */
    validity: z.string().nullable(),
    conditions: z.string().nullable(),
    /** «toda la tienda», «3 productos seleccionados», «2 categorías»… */
    applies_to: z.string(),
    /** Solo cuando se consultó un producto: su precio de lista y el que paga con esta oferta. */
    list_price: z.number().int().optional(),
    price: z.number().int().optional(),
  })
  .strict();

export const consultaOfertasSchema = z
  .object({
    channel: canalTexto,
    today: z.string(),
    empty: z.boolean(),
    offers: z.array(ofertaConsultaSchema),
    /** Solo al consultar un producto: nunca el stock ni ids; `price` es el que paga HOY (con la oferta, si la hay). */
    product: z.object({ reference: z.string(), name: z.string(), price: z.number().int().nullable(), list_price: z.number().int().nullable() }).strict().optional(),
    /** Solo al consultar una categoría: si el negocio tiene una categoría con ese nombre. */
    category: z.object({ name: z.string(), found: z.boolean() }).strict().optional(),
    note: z.string(),
  })
  .strict();
export type ConsultaOfertas = z.infer<typeof consultaOfertasSchema>;

export const comboConsultaSchema = z
  .object({
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    components: z.array(z.object({ reference: z.string(), name: z.string().nullable(), quantity: z.number().int(), unit_price: z.number().int().nullable(), available: z.boolean() }).strict()),
    /** Suma de lo que cuesta cada producto por separado HOY (con sus ofertas); null si algún producto no tiene precio. */
    normal_price: z.number().int().nullable(),
    combo_price: z.number().int(),
    savings: z.number().int().nullable(),
    available: z.boolean(),
    /** Por qué no está disponible, en palabras (nunca cantidades de inventario). null si está disponible. */
    unavailable_reason: z.string().nullable(),
    validity: z.string().nullable(),
    conditions: z.string().nullable(),
    how_to_buy: z.string(),
  })
  .strict();

export const consultaCombosSchema = z
  .object({ channel: canalTexto, today: z.string(), empty: z.boolean(), combos: z.array(comboConsultaSchema), note: z.string() })
  .strict();
export type ConsultaCombos = z.infer<typeof consultaCombosSchema>;

export const campanaConsultaSchema = z
  .object({
    name: z.string(),
    description: z.string().nullable(),
    validity: z.string().nullable(),
    /** Ofertas vigentes de la campaña («Amor y Amistad: 20% de descuento»). */
    offers: z.array(z.string()),
    combos: z.array(z.string()),
  })
  .strict();

export const consultaCampanasSchema = z
  .object({ channel: canalTexto, today: z.string(), empty: z.boolean(), campaigns: z.array(campanaConsultaSchema), note: z.string() })
  .strict();
export type ConsultaCampanas = z.infer<typeof consultaCampanasSchema>;

export const consultaContenidoSchema = z
  .object({
    channel: canalTexto,
    topic: z.string(),
    empty: z.boolean(),
    items: z.array(z.object({ title: z.string(), text: z.string() }).strict()),
    /** true si hay información de este tema que no se pudo mostrar (p. ej. un dato del negocio sin configurar): ofrece una asesora. */
    incomplete: z.boolean(),
    note: z.string(),
  })
  .strict();
export type ConsultaContenido = z.infer<typeof consultaContenidoSchema>;

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

const evaluacionDe = (c: ContextoConsulta): ContextoEvaluacion => ({ snap: c.snap, canal: c.canal, ahora: c.ahora });
const hoy = (ahora: number): string => formatearFechaLocal(fechaLocalDeMs(ahora)) ?? fechaLocalDeMs(ahora);

function aplicaA(a: VistaOferta["alcance"]): string {
  if (a.todos) return "toda la tienda";
  const partes = [
    ...(a.productos > 0 ? [`${a.productos} ${a.productos === 1 ? "producto seleccionado" : "productos seleccionados"}`] : []),
    ...(a.categorias > 0 ? [`${a.categorias} ${a.categorias === 1 ? "categoría" : "categorías"}`] : []),
  ];
  return partes.join(" y ");
}

function ofertaConsulta(v: VistaOferta): z.infer<typeof ofertaConsultaSchema> {
  return { name: v.nombre, benefit: v.textoBeneficio, description: v.descripcion, validity: v.textoVigencia, conditions: v.condiciones, applies_to: aplicaA(v.alcance) };
}

const MOTIVO: Readonly<Record<MotivoComboNoDisponible, string>> = {
  componente_inexistente: "uno de los productos del combo ya no está en el catálogo",
  componente_inactivo: "uno de los productos del combo ya no está disponible",
  componente_agotado: "uno de los productos del combo está agotado por ahora",
  stock_insuficiente: "no hay existencias suficientes de uno de los productos del combo por ahora",
};

const CANAL_TEXTO = (canal: Canal) => (canal === "retail" ? ("retail" as const) : ("wholesale" as const));

// ---------------------------------------------------------------------------
// Ofertas
// ---------------------------------------------------------------------------

const NOTA_OFERTAS_CON =
  "Estas son las ofertas vigentes que aplican a este cliente. Cita el beneficio, la vigencia y las condiciones tal cual; no calcules porcentajes ni precios (el precio final de cada producto ya viene en las herramientas de catálogo) y no menciones ninguna oferta que no esté aquí.";
const NOTA_OFERTAS_SIN =
  "No hay ofertas vigentes para este cliente en este momento. Puedes decirlo con naturalidad (sin inventar alternativas, fechas ni porcentajes) y ofrecer ver los productos o pasar con una asesora.";

/** Ofertas vigentes para el canal (mayor prioridad primero), opcionalmente solo las que cubren una categoría completa. */
export function ofertasVigentes(c: ContextoConsulta, filtro: { categoria?: { id: string | null; nombre: string } } = {}): ConsultaOfertas {
  const ev = evaluacionDe(c);
  let activas = ofertasActivas(ev);
  const base = { channel: CANAL_TEXTO(c.canal), today: hoy(c.ahora) };
  if (filtro.categoria) {
    const id = filtro.categoria.id;
    if (id === null) {
      return { ...base, empty: true, offers: [], category: { name: filtro.categoria.nombre, found: false }, note: "El negocio no tiene una categoría con ese nombre. Pídele al cliente que la precise o ofrece ver el catálogo." };
    }
    activas = activas.filter((o) => o.contenido.alcance.todos || o.contenido.alcance.categorias.includes(id));
  }
  const offers = activas.map((o) => ofertaConsulta(vistaOferta(ev, o)));
  return {
    ...base,
    empty: offers.length === 0,
    offers,
    ...(filtro.categoria ? { category: { name: filtro.categoria.nombre, found: true } } : {}),
    note: offers.length > 0 ? NOTA_OFERTAS_CON : NOTA_OFERTAS_SIN,
  };
}

/** La oferta que aplica a UN producto (una sola: las ofertas no se acumulan) con su precio de lista y el que paga hoy. Sin oferta: `empty: true` y su precio de lista. */
export function ofertaDeProducto(c: ContextoConsulta, producto: { referencia: string; nombre: string; categoriaId: string | null; precioLista: number | null }): ConsultaOfertas {
  const ev = evaluacionDe(c);
  const precio = precioEfectivo(ev, { referencia: producto.referencia, categoriaId: producto.categoriaId, precioLista: producto.precioLista });
  const base = { channel: CANAL_TEXTO(c.canal), today: hoy(c.ahora) };
  const product = { reference: producto.referencia, name: producto.nombre, price: precio.precioFinal, list_price: precio.precioLista };
  if (precio.oferta === null) {
    return { ...base, empty: true, offers: [], product, note: "Este producto no tiene ninguna oferta vigente: su precio es el de lista. No digas que tiene descuento ni menciones otras ofertas como si le aplicaran." };
  }
  const o = ev.snap.ofertas.find((x) => x.clave === precio.oferta?.clave);
  if (!o) return { ...base, empty: true, offers: [], product, note: NOTA_OFERTAS_SIN };
  return {
    ...base,
    empty: false,
    offers: [{ ...ofertaConsulta(vistaOferta(ev, o)), list_price: precio.oferta.precioLista, price: precio.oferta.precioFinal }],
    product,
    note: "Esta es la ÚNICA oferta que aplica a este producto (las ofertas no se acumulan). Cita el beneficio, la vigencia y las condiciones tal cual, y el precio que aquí aparece: no calcules nada.",
  };
}

// ---------------------------------------------------------------------------
// Combos
// ---------------------------------------------------------------------------

/**
 * Lo que un combo necesita saber de un producto: si está activo, su disponibilidad (discreta: nunca el stock exacto), cuántas unidades se pueden pedir como máximo y el
 * precio EFECTIVO del canal (lo que el cliente pagaría hoy por separado: así «precio normal» y «ahorro» nunca prometen un descuento que ya no existe).
 */
export function productoParaCombo(p: ProductoResuelto, canal: Canal = "retail"): ProductoParaCombo {
  return { referencia: p.reference, nombre: p.name, activo: p.status === "ACTIVE", disponibilidad: p.availability, maxCantidad: p.maxQuantity, precioLista: canal === "wholesale" ? p.prices.wholesale : p.prices.retail };
}

const COMO_COMPRAR = "Los combos no se compran desde el carrito: los cierra una asesora. Si el cliente lo quiere, ofrécele pasar con una asesora.";

/** Referencias de los componentes de los combos vigentes para el canal (lo que hay que consultar al catálogo para armarlos). Sin repetir. */
export function referenciasDeCombosVigentes(c: ContextoConsulta, filtro: { code?: string } = {}): string[] {
  const activos = combosActivos(evaluacionDe(c)).filter((x) => filtro.code === undefined || x.clave === filtro.code);
  return [...new Set(activos.flatMap((x) => x.contenido.componentes.map((k) => k.referencia)))];
}

/** Combos vigentes para el canal con su disponibilidad y precios calculados por el backend con los datos REALES de los productos. */
export function combosVigentes(c: ContextoConsulta, productos: ReadonlyMap<string, ProductoParaCombo>, filtro: { code?: string } = {}): ConsultaCombos {
  const ev = evaluacionDe(c);
  const activos = combosActivos(ev);
  const combos: z.infer<typeof comboConsultaSchema>[] = [];
  for (const combo of activos) {
    if (filtro.code !== undefined && combo.clave !== filtro.code) continue;
    const v = vistaCombo(ev, combo, productos, activos);
    if (!v) continue;
    combos.push({
      code: v.clave,
      name: v.nombre,
      description: v.descripcion,
      components: v.componentes.map((k) => ({ reference: k.referencia, name: k.nombre, quantity: k.cantidad, unit_price: k.precioUnitario, available: k.disponible })),
      normal_price: v.precioNormal,
      combo_price: v.precioCombo,
      savings: v.ahorro,
      available: v.disponible,
      unavailable_reason: v.motivoNoDisponible ? MOTIVO[v.motivoNoDisponible] : null,
      validity: v.textoVigencia,
      conditions: v.condiciones,
      how_to_buy: COMO_COMPRAR,
    });
  }
  // Los disponibles primero (como en la tienda).
  const ordenados = [...combos.filter((x) => x.available), ...combos.filter((x) => !x.available)];
  return {
    channel: CANAL_TEXTO(c.canal),
    today: hoy(c.ahora),
    empty: ordenados.length === 0,
    combos: ordenados,
    note:
      ordenados.length > 0
        ? "Estos son los combos vigentes para este cliente. Cita sus productos, cantidades, precio y condiciones tal cual; no calcules precios ni ahorros ni ofrezcas un combo marcado como no disponible."
        : "No hay combos vigentes para este cliente en este momento. Puedes decirlo con naturalidad (sin inventar combos) y ofrecer ver los productos o pasar con una asesora.",
  };
}

// ---------------------------------------------------------------------------
// Campañas
// ---------------------------------------------------------------------------

export function campanasVigentes(c: ContextoConsulta): ConsultaCampanas {
  const ev = evaluacionDe(c);
  const ofertas = ofertasActivas(ev);
  const combos = combosActivos(ev);
  const campaigns = campanasActivas(ev).map((k) => ({
    name: k.contenido.nombre,
    description: k.contenido.descripcion ?? null,
    validity: describirVigencia(k.contenido.vigencia),
    offers: ofertas.filter((o) => o.contenido.campana === k.clave).map((o) => `${o.contenido.nombre}: ${vistaOferta(ev, o).textoBeneficio}`),
    combos: combos.filter((x) => x.contenido.campana === k.clave).map((x) => x.contenido.nombre),
  }));
  return {
    channel: CANAL_TEXTO(c.canal),
    today: hoy(c.ahora),
    empty: campaigns.length === 0,
    campaigns,
    note:
      campaigns.length > 0
        ? "Estas son las campañas vigentes para este cliente. Puedes hablar de ellas con sus nombres, vigencia y lo que incluyen; no inventes ofertas, combos ni fechas que no estén aquí."
        : "No hay campañas vigentes para este cliente en este momento. Puedes decirlo con naturalidad (sin inventar campañas de temporada) y ofrecer ver los productos.",
  };
}

// ---------------------------------------------------------------------------
// Contenido comercial
// ---------------------------------------------------------------------------

export function contenidoComercial(c: ContextoConsulta, tema: TemaContenido): ConsultaContenido {
  const { items, descartados } = contenidosPara(evaluacionDe(c), c.valores, { tema });
  const incomplete = descartados.length > 0;
  return {
    channel: CANAL_TEXTO(c.canal),
    topic: tema,
    empty: items.length === 0,
    items: items.map((i) => ({ title: i.titulo, text: i.texto })),
    incomplete,
    note:
      items.length > 0
        ? "Esta es la información OFICIAL del negocio sobre el tema. Cítala tal cual, con sus cifras, plazos y condiciones; no agregues ni cambies ningún dato, plazo, monto ni condición." + (incomplete ? " Hay más información de este tema que no se pudo mostrar por ahora: si el cliente necesita más, ofrece una asesora." : "")
        : incomplete
          ? "La información de este tema no se puede mostrar por ahora. No inventes ni recuerdes datos de memoria: ofrece que una asesora lo confirme."
          : "El negocio no tiene información publicada sobre este tema. Dilo con naturalidad (sin inventar datos) y ofrece que una asesora lo confirme.",
  };
}
