/**
 * CMS comercial — EVALUACIÓN DETERMINISTA de lo publicado. PURO: sin I/O, con el reloj y el canal que le pasan.
 *
 * ÚNICO lugar donde se decide qué está activo, qué aplica a un producto y a qué precio. La tienda, el carrito/pedido y las herramientas de ARIA llaman a
 * estas funciones; ninguno repite estas reglas (una sola fuente de verdad: lo que se muestra, lo que se cobra y lo que ARIA dice salen de aquí).
 *
 * Contratos que aplica (cada uno con su prueba y su mutante):
 *   - MODALIDAD: un cliente detal solo ve contenido «detal» o «ambas»; uno mayorista, «mayorista» o «ambas». El canal lo decide el backend, jamás el modelo.
 *   - VIGENCIA: vigente = desde <= ahora < hasta (hora de Bogotá). Una vigencia ilegible o invertida no está vigente (fail-closed).
 *   - CAMPAÑA: un elemento de una campaña solo está activo si la campaña está activa; una campaña inexistente, vencida o de otra modalidad lo apaga.
 *   - OFERTAS: no se acumulan. A un producto le aplica UNA: la de mayor prioridad; en empate, la que deja el mejor precio final; luego la más antigua; luego
 *     el código en orden alfabético (total determinista).
 *   - PRECIO: entero en pesos, redondeo al peso más cercano (mitades hacia arriba). Una oferta nunca sube el precio, ni lo deja en cero o negativo, ni se
 *     inventa un precio donde el producto no tiene precio («a consultar»).
 *   - COMBO: el backend calcula el precio normal (suma de componentes) y la disponibilidad (cada componente debe estar activo y alcanzar). ARIA no calcula nada.
 */
import { audienciaAplica, modalidadAplica, type Canal, type TemaContenido } from "@/lib/cms-comercial/contrato";
import type { Beneficio, Combo, Contenido, Oferta } from "@/lib/cms-comercial/esquemas";
import type { InstantaneaCms, PublicadaCms } from "@/lib/cms-comercial/publicado";
import { describirVigencia, vigenteAhora, type VigenciaLocal } from "@/lib/cms-comercial/tiempo";
import { formatearPesos, resolverVariables, type ValoresVariables } from "@/lib/cms-comercial/variables";

export interface ContextoEvaluacion {
  snap: InstantaneaCms;
  /** Canal del cliente: SIEMPRE lo decide el backend (clasificación del contacto o enlace de la tienda). */
  canal: Canal;
  /** Instante de la evaluación en milisegundos: del reloj inyectado. */
  ahora: number;
}

// ---------------------------------------------------------------------------
// Orden determinista
// ---------------------------------------------------------------------------

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Para ordenar títulos como los lee una persona: sin tildes, sin mayúsculas y sin signos al comienzo («¿Cuál…» va con la C). */
const claveDeOrden = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, "");

/** Prioridad mayor primero; luego el más antiguo; luego el código (orden total, sin depender del orden en que llegaron). */
function porPrioridad<T extends { prioridad: number }>(a: PublicadaCms & { contenido: T }, b: PublicadaCms & { contenido: T }): number {
  return b.contenido.prioridad - a.contenido.prioridad || cmp(a.creadaAt, b.creadaAt) || cmp(a.clave, b.clave);
}

// ---------------------------------------------------------------------------
// Activación: modalidad + vigencia + campaña
// ---------------------------------------------------------------------------

export function campanaActiva(ctx: ContextoEvaluacion, campana: PublicadaCms<"campana">): boolean {
  return modalidadAplica(campana.contenido.modalidad, ctx.canal) && vigenteAhora(campana.contenido.vigencia, ctx.ahora);
}

/** Campañas activas para el canal, la de mayor prioridad primero. */
export function campanasActivas(ctx: ContextoEvaluacion): PublicadaCms<"campana">[] {
  return ctx.snap.campanas.filter((c) => campanaActiva(ctx, c)).sort(porPrioridad);
}

function activosDeCampana(ctx: ContextoEvaluacion): Set<string> {
  return new Set(campanasActivas(ctx).map((c) => c.clave));
}

/** Un elemento con campaña solo vale si esa campaña está ACTIVA (inexistente, vencida o de otra modalidad = apagado). Sin campaña, vale por sí mismo. */
function permiteCampana(campana: string | undefined, activas: ReadonlySet<string>): boolean {
  return campana === undefined || activas.has(campana);
}

/** Ofertas publicadas, de la modalidad del canal, vigentes y con su campaña activa. Orden: prioridad. */
export function ofertasActivas(ctx: ContextoEvaluacion): PublicadaCms<"oferta">[] {
  const campanas = activosDeCampana(ctx);
  return ctx.snap.ofertas
    .filter((o) => modalidadAplica(o.contenido.modalidad, ctx.canal) && vigenteAhora(o.contenido.vigencia, ctx.ahora) && permiteCampana(o.contenido.campana, campanas))
    .sort(porPrioridad);
}

export function combosActivos(ctx: ContextoEvaluacion): PublicadaCms<"combo">[] {
  const campanas = activosDeCampana(ctx);
  return ctx.snap.combos
    .filter((c) => modalidadAplica(c.contenido.modalidad, ctx.canal) && vigenteAhora(c.contenido.vigencia, ctx.ahora) && permiteCampana(c.contenido.campana, campanas))
    .sort(porPrioridad);
}

// ---------------------------------------------------------------------------
// Precio efectivo
// ---------------------------------------------------------------------------

/** Lo mínimo que se necesita de un producto para saber su precio efectivo. `precioLista` es el del CANAL del cliente (null = «a consultar»). */
export interface ProductoParaPrecio {
  referencia: string;
  categoriaId: string | null;
  precioLista: number | null;
}

/** Precio final de aplicar un beneficio a un precio de lista, o null si ese beneficio no sirve para este precio o canal. */
export function precioConBeneficio(precioLista: number, beneficio: Beneficio, canal: Canal): number | null {
  if (!Number.isInteger(precioLista) || precioLista < 1) return null;
  let final: number;
  if (beneficio.tipo === "porcentaje") {
    // Enteros puros: (lista × (100 − %) + 50) / 100 redondea al peso más cercano con las mitades hacia arriba, sin errores de coma flotante.
    final = Math.floor((precioLista * (100 - beneficio.valor) + 50) / 100);
  } else {
    const valor = canal === "retail" ? beneficio.detal : beneficio.mayorista;
    if (valor === undefined || !Number.isInteger(valor) || valor < 1) return null;
    final = beneficio.tipo === "monto_fijo" ? precioLista - valor : valor;
  }
  // Una oferta tiene que BAJAR el precio y dejarlo positivo: si no, no aplica (nunca un descuento que sube o regala).
  if (!Number.isInteger(final) || final < 1 || final >= precioLista) return null;
  return final;
}

/** «15% de descuento», «$5.000 de descuento», «precio especial de $60.000» — la redacta el backend; ARIA la cita tal cual. */
export function textoBeneficio(beneficio: Beneficio, canal: Canal): string {
  if (beneficio.tipo === "porcentaje") return `${beneficio.valor}% de descuento`;
  const valor = canal === "retail" ? beneficio.detal : beneficio.mayorista;
  if (valor === undefined) return "";
  return beneficio.tipo === "monto_fijo" ? `${formatearPesos(valor)} de descuento` : `precio especial de ${formatearPesos(valor)}`;
}

export function ofertaAlcanzaProducto(oferta: Oferta, producto: ProductoParaPrecio): boolean {
  const a = oferta.alcance;
  return a.todos || a.referencias.includes(producto.referencia) || (producto.categoriaId !== null && a.categorias.includes(producto.categoriaId));
}

export interface OfertaAplicada {
  clave: string;
  nombre: string;
  version: number;
  beneficio: Beneficio;
  textoBeneficio: string;
  precioLista: number;
  precioFinal: number;
  ahorro: number;
  vigencia: VigenciaLocal;
  textoVigencia: string | null;
  condiciones: string | null;
}

export interface PrecioEfectivo {
  /** Precio de lista del canal; null = a consultar. */
  precioLista: number | null;
  /** Lo que se cobra: el precio de la oferta aplicada, o el de lista si no hay oferta. null = a consultar. */
  precioFinal: number | null;
  oferta: OfertaAplicada | null;
}

/**
 * Precio efectivo de un producto para el canal y el instante del contexto. `activas` permite reutilizar las ofertas ya filtradas al evaluar varios productos.
 * Sin oferta aplicable, el resultado es EXACTAMENTE el precio de lista (la tienda y el pedido se comportan como antes de existir el CMS).
 */
export function precioEfectivo(ctx: ContextoEvaluacion, producto: ProductoParaPrecio, activas: readonly PublicadaCms<"oferta">[] = ofertasActivas(ctx)): PrecioEfectivo {
  const lista = producto.precioLista;
  if (lista === null || !Number.isInteger(lista) || lista < 1) return { precioLista: null, precioFinal: null, oferta: null };
  let mejor: { o: PublicadaCms<"oferta">; final: number } | null = null;
  for (const o of activas) {
    if (!ofertaAlcanzaProducto(o.contenido, producto)) continue;
    const final = precioConBeneficio(lista, o.contenido.beneficio, ctx.canal);
    if (final === null) continue;
    if (mejor === null || mejorQue(o, final, mejor.o, mejor.final)) mejor = { o, final };
  }
  if (mejor === null) return { precioLista: lista, precioFinal: lista, oferta: null };
  const c = mejor.o.contenido;
  return {
    precioLista: lista,
    precioFinal: mejor.final,
    oferta: {
      clave: mejor.o.clave,
      nombre: c.nombre,
      version: mejor.o.version,
      beneficio: c.beneficio,
      textoBeneficio: textoBeneficio(c.beneficio, ctx.canal),
      precioLista: lista,
      precioFinal: mejor.final,
      ahorro: lista - mejor.final,
      vigencia: c.vigencia,
      textoVigencia: describirVigencia(c.vigencia),
      condiciones: c.condiciones ?? null,
    },
  };
}

/** ¿La oferta `a` (con su precio final) le gana a `b`? Prioridad mayor; luego mejor precio para el cliente; luego la más antigua; luego el código. */
function mejorQue(a: PublicadaCms<"oferta">, finalA: number, b: PublicadaCms<"oferta">, finalB: number): boolean {
  if (a.contenido.prioridad !== b.contenido.prioridad) return a.contenido.prioridad > b.contenido.prioridad;
  if (finalA !== finalB) return finalA < finalB;
  if (a.creadaAt !== b.creadaAt) return a.creadaAt < b.creadaAt;
  return a.clave < b.clave;
}

/** Precio efectivo de varios productos con una sola pasada de filtrado de ofertas. Clave del mapa: la referencia. */
export function preciosEfectivos(ctx: ContextoEvaluacion, productos: readonly ProductoParaPrecio[]): Map<string, PrecioEfectivo> {
  const activas = ofertasActivas(ctx);
  const salida = new Map<string, PrecioEfectivo>();
  for (const p of productos) salida.set(p.referencia, precioEfectivo(ctx, p, activas));
  return salida;
}

// ---------------------------------------------------------------------------
// Vista pública de una oferta (lo que ven la tienda y ARIA, sin ids internos)
// ---------------------------------------------------------------------------

export interface VistaOferta {
  clave: string;
  nombre: string;
  descripcion: string | null;
  textoBeneficio: string;
  vigencia: VigenciaLocal;
  textoVigencia: string | null;
  condiciones: string | null;
  /** Alcance en resumen: «toda la tienda» o cuántos productos y categorías cubre. */
  alcance: { todos: boolean; productos: number; categorias: number };
  prioridad: number;
  version: number;
}

export function vistaOferta(ctx: ContextoEvaluacion, oferta: PublicadaCms<"oferta">): VistaOferta {
  const c = oferta.contenido;
  return {
    clave: oferta.clave,
    nombre: c.nombre,
    descripcion: c.descripcion ?? null,
    textoBeneficio: textoBeneficio(c.beneficio, ctx.canal),
    vigencia: c.vigencia,
    textoVigencia: describirVigencia(c.vigencia),
    condiciones: c.condiciones ?? null,
    alcance: { todos: c.alcance.todos, productos: c.alcance.referencias.length, categorias: c.alcance.categorias.length },
    prioridad: c.prioridad,
    version: oferta.version,
  };
}

// ---------------------------------------------------------------------------
// Combos
// ---------------------------------------------------------------------------

/**
 * Lo que se necesita de un producto componente. `precioLista` es lo que el cliente paga por ese producto por separado HOY en su canal (null = a consultar):
 * quien arma el combo para la tienda o para ARIA pasa el precio EFECTIVO (con la oferta vigente, si la hay), así el «precio normal» y el ahorro del combo
 * nunca prometen un descuento que ya no existe.
 */
export interface ProductoParaCombo {
  referencia: string;
  nombre: string;
  activo: boolean;
  /** Misma disponibilidad que usa la tienda (availabilityOf). */
  disponibilidad: "available" | "low" | "sold_out";
  /** Máximo que se puede pedir (stock si se controla; null = sin límite de inventario). */
  maxCantidad: number | null;
  precioLista: number | null;
}

export type MotivoComboNoDisponible = "componente_inexistente" | "componente_inactivo" | "componente_agotado" | "stock_insuficiente";

export interface VistaCombo {
  clave: string;
  nombre: string;
  descripcion: string | null;
  componentes: Array<{ referencia: string; nombre: string | null; cantidad: number; precioUnitario: number | null; disponible: boolean }>;
  /** Suma de los precios de lista de los componentes; null si algún componente no tiene precio. */
  precioNormal: number | null;
  precioCombo: number;
  /** precioNormal − precioCombo cuando es positivo; null si no hay ahorro o no se puede calcular. */
  ahorro: number | null;
  disponible: boolean;
  /** Cuántos combos se pueden armar con el stock; null = sin límite de inventario. 0 si no está disponible. */
  unidadesDisponibles: number | null;
  motivoNoDisponible: MotivoComboNoDisponible | null;
  vigencia: VigenciaLocal;
  textoVigencia: string | null;
  condiciones: string | null;
  version: number;
}

/**
 * Vista de un combo ACTIVO para el canal del contexto (usa `combosActivos`). El backend calcula precio normal y disponibilidad; nadie más.
 * Devuelve null si el combo no está activo para este canal/instante o no tiene precio para el canal.
 */
export function vistaCombo(ctx: ContextoEvaluacion, combo: PublicadaCms<"combo">, productos: ReadonlyMap<string, ProductoParaCombo>, activos: readonly PublicadaCms<"combo">[] = combosActivos(ctx)): VistaCombo | null {
  if (!activos.some((a) => a.id === combo.id && a.version === combo.version)) return null;
  const c: Combo = combo.contenido;
  const precioCombo = ctx.canal === "retail" ? c.precio.detal : c.precio.mayorista;
  if (precioCombo === undefined) return null;

  let motivo: MotivoComboNoDisponible | null = null;
  let normal: number | null = 0;
  let unidades: number | null = null;
  const componentes = c.componentes.map((comp) => {
    const p = productos.get(comp.referencia);
    let problema: MotivoComboNoDisponible | null = null;
    if (p === undefined) problema = "componente_inexistente";
    else if (!p.activo) problema = "componente_inactivo";
    else if (p.disponibilidad === "sold_out") problema = "componente_agotado";
    else if (p.maxCantidad !== null && p.maxCantidad < comp.cantidad) problema = "stock_insuficiente";
    if (problema !== null && motivo === null) motivo = problema;
    if (p === undefined || p.precioLista === null) normal = null;
    else if (normal !== null) normal += p.precioLista * comp.cantidad;
    if (problema === null && p !== undefined && p.maxCantidad !== null) {
      const alcanza = Math.floor(p.maxCantidad / comp.cantidad);
      unidades = unidades === null ? alcanza : Math.min(unidades, alcanza);
    }
    return { referencia: comp.referencia, nombre: p?.nombre ?? null, cantidad: comp.cantidad, precioUnitario: p?.precioLista ?? null, disponible: problema === null };
  });
  const disponible = motivo === null;
  return {
    clave: combo.clave,
    nombre: c.nombre,
    descripcion: c.descripcion ?? null,
    componentes,
    precioNormal: normal,
    precioCombo,
    ahorro: normal !== null && normal > precioCombo ? normal - precioCombo : null,
    disponible,
    unidadesDisponibles: disponible ? unidades : 0,
    motivoNoDisponible: motivo,
    vigencia: c.vigencia,
    textoVigencia: describirVigencia(c.vigencia),
    condiciones: c.condiciones ?? null,
    version: combo.version,
  };
}

// ---------------------------------------------------------------------------
// Contenido comercial
// ---------------------------------------------------------------------------

export interface VistaContenido {
  clave: string;
  tema: TemaContenido;
  titulo: string;
  /** Texto ya con las variables reemplazadas. */
  texto: string;
  version: number;
}

export interface ContenidoDescartado {
  clave: string;
  motivo: "variable_desconocida" | "variable_sin_valor";
  variables: string[];
}

/**
 * Contenido activo para el canal: la audiencia del texto debe incluir al cliente (un texto «mayorista» jamás llega a un cliente detal), debe estar vigente
 * y todas sus variables deben poder resolverse (si no, NO se entrega, y se informa). Orden: `orden`, luego título.
 */
export function contenidosPara(ctx: ContextoEvaluacion, valores: ValoresVariables, filtro: { tema?: TemaContenido } = {}): { items: VistaContenido[]; descartados: ContenidoDescartado[] } {
  const items: VistaContenido[] = [];
  const descartados: ContenidoDescartado[] = [];
  const candidatos = ctx.snap.contenidos
    .filter((e) => audienciaAplica(e.contenido.audiencia, ctx.canal) && vigenteAhora(e.contenido.vigencia, ctx.ahora) && (filtro.tema === undefined || e.contenido.tema === filtro.tema))
    .sort((a, b) => a.contenido.orden - b.contenido.orden || cmp(claveDeOrden(a.contenido.titulo), claveDeOrden(b.contenido.titulo)) || cmp(a.clave, b.clave));
  for (const e of candidatos) {
    const c: Contenido = e.contenido;
    const titulo = resolverVariables(c.titulo, valores);
    const texto = resolverVariables(c.texto, valores);
    if (!titulo.ok || !texto.ok) {
      const desconocidas = [...(!titulo.ok ? titulo.desconocidas : []), ...(!texto.ok ? texto.desconocidas : [])];
      const sinValor = [...(!titulo.ok ? titulo.sinValor : []), ...(!texto.ok ? texto.sinValor : [])];
      descartados.push({ clave: e.clave, motivo: desconocidas.length > 0 ? "variable_desconocida" : "variable_sin_valor", variables: [...new Set([...desconocidas, ...sinValor])] });
      continue;
    }
    items.push({ clave: e.clave, tema: c.tema, titulo: titulo.texto, texto: texto.texto, version: e.version });
  }
  return { items, descartados };
}
